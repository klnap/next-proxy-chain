import { describe, expect, it } from "bun:test";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { chain, defineHandler } from "../../src/index";

// Invariant: a response handed to Next.js as terminal must not keep routing control headers.
// Next.js applies x-middleware-rewrite regardless of the HTTP status, so a 403 rewrite routes.

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const fakeEvent = {} as NextFetchEvent;
const dest = "http://localhost/target";
const routingHeaders = [
  "x-middleware-rewrite",
  "x-middleware-next",
  "x-middleware-override-headers",
];

type Outcome = { res: Response; ran: boolean };
type Kind = "ordinary-return" | "ordinary-error" | "timeout" | "cancellation" | "engine";
type Factory = () => NextResponse | Response | undefined;

/** Later handler: proves whether routing continued past the outcome under test. */
function trailing(ran: { value: boolean }) {
  return defineHandler({
    name: "after",
    handle: () => {
      ran.value = true;
      return new Response("after", { status: 418 });
    },
  });
}

async function run(kind: Kind, make: Factory, prior?: NextResponse): Promise<Outcome> {
  const ran = { value: false };
  const priorHandler = prior ? defineHandler({ name: "prior", handle: () => prior }) : undefined;
  const pre = priorHandler ? [priorHandler] : [];
  const req = () => new NextRequest("http://localhost/source");

  if (kind === "ordinary-return") {
    const handler = chain([...pre, defineHandler({ name: "ret", handle: make }), trailing(ran)], {
      logger: silent,
    });
    return { res: (await handler(req(), fakeEvent)) as Response, ran: ran.value };
  }
  if (kind === "ordinary-error") {
    const boom = defineHandler({
      name: "boom",
      handle: () => {
        throw new Error("upstream down");
      },
    });
    const handler = chain([...pre, boom, trailing(ran)], {
      logger: silent,
      onError: () => make(),
    });
    return { res: (await handler(req(), fakeEvent)) as Response, ran: ran.value };
  }
  if (kind === "timeout") {
    const slow = defineHandler({
      name: "slow",
      timeout: 5,
      handle: () => new Promise<never>(() => {}),
      onError: () => make(),
    });
    const handler = chain([...pre, slow, trailing(ran)], { logger: silent });
    return { res: (await handler(req(), fakeEvent)) as Response, ran: ran.value };
  }
  if (kind === "cancellation") {
    const controller = new AbortController();
    const slow = defineHandler({
      name: "slow",
      handle: async () => {
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 10));
        return undefined;
      },
      onError: () => make(),
    });
    const handler = chain([...pre, slow, trailing(ran)], { logger: silent });
    const cancelled = new NextRequest("http://localhost/source", { signal: controller.signal });
    return { res: (await handler(cancelled, fakeEvent)) as Response, ran: ran.value };
  }
  // engine: a malformed rewrite header makes the final NextResponse.rewrite URL parse throw.
  const bad = defineHandler({
    name: "bad-rewrite",
    handle: () => new NextResponse(null, { headers: { "x-middleware-rewrite": "http://[bad" } }),
  });
  // The malformed rewrite is the last handler: the engine error surfaces at finalization.
  const handler = chain([...pre, bad], { logger: silent, onError: () => make() });
  return { res: (await handler(req(), fakeEvent)) as Response, ran: ran.value };
}

const terminalKinds: Kind[] = [
  "ordinary-return",
  "ordinary-error",
  "timeout",
  "cancellation",
  "engine",
];
const recoveryKinds: Kind[] = ["timeout", "cancellation", "engine"];

describe("terminal responses never carry routing control headers", () => {
  // Native rewrites with non-200 statuses are terminal in ordinary execution.
  for (const status of [201, 400, 401, 403, 404, 500]) {
    it(`ordinary execution: rewrite with status ${status} is terminal and not routed`, async () => {
      const { res, ran } = await run("ordinary-return", () =>
        NextResponse.rewrite(dest, { status }),
      );
      expect(ran).toBe(false);
      expect(res.status).toBe(status);
      for (const header of routingHeaders) expect(res.headers.get(header)).toBeNull();
    });
  }

  it("ordinary execution: successful rewrite (200) stages and continues", async () => {
    const { res, ran } = await run("ordinary-return", () => NextResponse.rewrite(dest));
    expect(ran).toBe(true);
    expect(res.status).toBe(418);
  });

  // Any native rewrite is routing, whatever its status, so terminal-only recovery rejects it.
  for (const kind of recoveryKinds) {
    for (const status of [200, 201, 400, 401, 403, 404, 500]) {
      it(`${kind} recovery: rewrite with status ${status} is rejected`, async () => {
        const { res, ran } = await run(kind, () => NextResponse.rewrite(dest, { status }));
        expect(ran).toBe(false);
        expect(res.headers.get("x-middleware-rewrite")).toBeNull();
        if (kind !== "cancellation") expect(res.status).toBe(500);
      });
    }
  }

  // Ordinary error recovery: a non-200 rewrite is terminal, like an ordinary return.
  for (const status of [201, 403, 500]) {
    it(`ordinary error recovery: rewrite with status ${status} is terminal and not routed`, async () => {
      const { res, ran } = await run("ordinary-error", () =>
        NextResponse.rewrite(dest, { status }),
      );
      expect(ran).toBe(false);
      expect(res.status).toBe(status);
      for (const header of routingHeaders) expect(res.headers.get(header)).toBeNull();
    });
  }

  // Cancellation keeps its documented fallback (NextResponse.next()), so only the rewrite is checked there.
  for (const kind of terminalKinds) {
    it(`${kind}: native continuation with a custom status never routes out`, async () => {
      const { res, ran } = await run(kind, () => NextResponse.next({ status: 403 }));
      expect(ran).toBe(kind === "ordinary-return" || kind === "ordinary-error");
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      if (kind !== "cancellation") expect(res.headers.get("x-middleware-next")).toBeNull();
    });
  }

  for (const kind of terminalKinds) {
    it(`${kind}: conflicting continuation and rewrite markers never route out`, async () => {
      const make = () =>
        new NextResponse(null, {
          status: 403,
          headers: { "x-middleware-next": "1", "x-middleware-rewrite": dest },
        });
      const { res } = await run(kind, make);
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      if (kind !== "cancellation") expect(res.headers.get("x-middleware-next")).toBeNull();
    });
  }

  it("ordinary execution: unexpected x-middleware-next values are not continuation", async () => {
    const make = () =>
      new NextResponse(null, { status: 403, headers: { "x-middleware-next": "0" } });
    const { res, ran } = await run("ordinary-return", make);
    expect(ran).toBe(false);
    expect(res.status).toBe(403);
    expect(res.headers.get("x-middleware-next")).toBeNull();
  });

  it("ordinary execution: empty rewrite header is terminal and not routed", async () => {
    const make = () =>
      new NextResponse(null, { status: 403, headers: { "x-middleware-rewrite": "" } });
    const { res, ran } = await run("ordinary-return", make);
    expect(ran).toBe(false);
    expect(res.status).toBe(403);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  for (const kind of terminalKinds) {
    it(`${kind}: plain Response carrying routing metadata is stripped`, async () => {
      const make = () =>
        new Response("blocked", {
          status: 403,
          headers: { "x-middleware-rewrite": dest, "x-middleware-next": "1" },
        });
      const { res } = await run(kind, make);
      expect(res.status).toBe(403);
      for (const header of routingHeaders) expect(res.headers.get(header)).toBeNull();
    });
  }

  for (const kind of terminalKinds) {
    it(`${kind}: legitimate redirect is accepted with its location`, async () => {
      const { res, ran } = await run(kind, () =>
        NextResponse.redirect(new URL("/login", "http://localhost"), 307),
      );
      if (kind === "ordinary-return" || kind === "ordinary-error") {
        expect(ran).toBe(false);
        expect(res.status).toBe(307);
        expect(res.headers.get("location")).toBe("http://localhost/login");
      }
      for (const header of routingHeaders) expect(res.headers.get(header)).toBeNull();
    });
  }

  for (const kind of terminalKinds) {
    it(`${kind}: legitimate terminal Web Response is accepted`, async () => {
      const { res, ran } = await run(kind, () => new Response("maintenance", { status: 503 }));
      if (kind === "ordinary-return" || kind === "ordinary-error") {
        expect(ran).toBe(false);
      }
      expect(res.status).toBe(503);
    });
  }

  it("terminal recovery keeps headers composed by earlier handlers", async () => {
    const prior = NextResponse.next();
    prior.headers.set("x-prior", "1");
    const { res } = await run("timeout", () => new Response("slow", { status: 503 }), prior);
    expect(res.status).toBe(503);
    expect(res.headers.get("x-prior")).toBe("1");
  });
});
