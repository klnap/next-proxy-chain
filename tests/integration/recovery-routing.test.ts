import { describe, expect, it } from "bun:test";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { chain, defineHandler } from "../../src/index";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const fakeEvent = {} as NextFetchEvent;

type Recovery = () => NextResponse | Response | undefined;

/** Terminal sentinel: proves whether the handler after the failing one ran. */
function trailing(ran: { value: boolean }) {
  return defineHandler({
    name: "after",
    handle: () => {
      ran.value = true;
      return new Response("after", { status: 418 });
    },
  });
}

async function runWithOrdinaryError(recover: Recovery) {
  const ran = { value: false };
  const boom = defineHandler({
    name: "boom",
    handle: () => {
      throw new Error("upstream down");
    },
  });
  const handler = chain([boom, trailing(ran)], {
    logger: silent,
    onError: () => recover(),
  });
  const res = await handler(new NextRequest("http://localhost/admin"), fakeEvent);
  return { res, ran: ran.value };
}

async function runWithTimeout(recover: Recovery | undefined, prior?: NextResponse) {
  const ran = { value: false };
  const priorHandler = prior ? defineHandler({ name: "prior", handle: () => prior }) : undefined;
  const slow = defineHandler({
    name: "slow",
    timeout: 5,
    // Ignores its signal on purpose: the engine must stop waiting at the deadline.
    handle: () => new Promise<never>(() => {}),
    onError: recover ? () => recover() : undefined,
  });
  const entries = priorHandler ? [priorHandler, slow, trailing(ran)] : [slow, trailing(ran)];
  const handler = chain(entries, { logger: silent });
  const res = await handler(new NextRequest("http://localhost/admin"), fakeEvent);
  return { res, ran: ran.value };
}

async function runWithCancellation(recover: Recovery) {
  const ran = { value: false };
  const controller = new AbortController();
  const slow = defineHandler({
    name: "slow",
    handle: async () => {
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 10));
      return undefined;
    },
    onError: () => recover(),
  });
  const handler = chain([slow, trailing(ran)], { logger: silent });
  const req = new NextRequest("http://localhost/admin", { signal: controller.signal });
  const res = await handler(req, fakeEvent);
  return { res, ran: ran.value };
}

const dest = "http://localhost/elsewhere";

describe("ordinary error recovery", () => {
  it("continues after NextResponse.next()", async () => {
    const { res, ran } = await runWithOrdinaryError(() => NextResponse.next());
    expect(ran).toBe(true);
    expect(res.status).toBe(418);
  });

  it("stops on a terminal Response", async () => {
    const { res, ran } = await runWithOrdinaryError(() => new Response("blocked", { status: 503 }));
    expect(ran).toBe(false);
    expect(res.status).toBe(503);
  });

  it("continues after a successful rewrite and keeps the staged rewrite", async () => {
    const { res, ran } = await runWithOrdinaryError(() => NextResponse.rewrite(dest));
    expect(ran).toBe(true);
    expect(res.status).toBe(418);
    // The later handler returns a terminal Response, so no staged rewrite survives here.
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("stages a rewrite recovery that a later continuation finalizes", async () => {
    const ran = { value: false };
    const boom = defineHandler({
      name: "boom",
      handle: () => {
        throw new Error("upstream down");
      },
    });
    const later = defineHandler({
      name: "later",
      handle: () => {
        ran.value = true;
        return NextResponse.next();
      },
    });
    const handler = chain([boom, later], {
      logger: silent,
      onError: () => NextResponse.rewrite(dest),
    });
    const res = await handler(new NextRequest("http://localhost/admin"), fakeEvent);
    expect(ran.value).toBe(true);
    expect(res.headers.get("x-middleware-rewrite")).toBe(dest);
  });
});

describe("timeout recovery", () => {
  it("accepts a terminal Response and skips later handlers", async () => {
    const { res, ran } = await runWithTimeout(() => new Response("slow", { status: 503 }));
    expect(ran).toBe(false);
    expect(res.status).toBe(503);
  });

  it("rejects NextResponse.next() and fails closed", async () => {
    const { res, ran } = await runWithTimeout(() => NextResponse.next());
    expect(ran).toBe(false);
    expect(res.status).toBe(500);
    expect(res.headers.get("x-middleware-next")).toBeNull();
  });

  it("rejects NextResponse.rewrite() and fails closed without routing into the destination", async () => {
    const { res, ran } = await runWithTimeout(() => NextResponse.rewrite(dest));
    expect(ran).toBe(false);
    expect(res.status).toBe(500);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("strips routing headers from a plain Response that carries them", async () => {
    const { res, ran } = await runWithTimeout(
      () =>
        new Response("slow", {
          status: 503,
          headers: { "x-middleware-rewrite": dest },
        }),
    );
    expect(ran).toBe(false);
    expect(res.status).toBe(503);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("fails closed without recovery and keeps earlier composed headers", async () => {
    const prior = NextResponse.next();
    prior.headers.set("x-prior", "1");
    const { res, ran } = await runWithTimeout(undefined, prior);
    expect(ran).toBe(false);
    expect(res.status).toBe(500);
    expect(res.headers.get("x-prior")).toBe("1");
  });

  it("keeps earlier composed headers on terminal timeout recovery", async () => {
    const prior = NextResponse.next();
    prior.headers.set("x-prior", "1");
    const { res } = await runWithTimeout(() => new Response("slow", { status: 503 }), prior);
    expect(res.status).toBe(503);
    expect(res.headers.get("x-prior")).toBe("1");
  });
});

describe("request cancellation recovery", () => {
  it("accepts a terminal Response and skips later handlers", async () => {
    const { res, ran } = await runWithCancellation(() => new Response("gone", { status: 499 }));
    expect(ran).toBe(false);
    expect(res.status).toBe(499);
  });

  it("does not resume the chain after NextResponse.next() recovery", async () => {
    const { ran } = await runWithCancellation(() => NextResponse.next());
    expect(ran).toBe(false);
  });

  it("does not resume the chain after NextResponse.rewrite() recovery", async () => {
    const { res, ran } = await runWithCancellation(() => NextResponse.rewrite(dest));
    expect(ran).toBe(false);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("engine-level failure recovery", () => {
  // A malformed rewrite header makes the final NextResponse.rewrite URL parse throw.
  const badRewrite = () =>
    defineHandler({
      name: "bad-rewrite",
      handle: () => new NextResponse(null, { headers: { "x-middleware-rewrite": "http://[bad" } }),
    });

  it("fails closed when engine recovery returns NextResponse.next()", async () => {
    const handler = chain([badRewrite()], {
      logger: silent,
      onError: () => NextResponse.next(),
    });
    const res = await handler(new NextRequest("http://localhost/admin"), fakeEvent);
    expect(res.status).toBe(500);
  });

  it("fails closed when engine recovery returns NextResponse.rewrite()", async () => {
    const handler = chain([badRewrite()], {
      logger: silent,
      onError: () => NextResponse.rewrite(dest),
    });
    const res = await handler(new NextRequest("http://localhost/admin"), fakeEvent);
    expect(res.status).toBe(500);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("accepts a terminal Response from engine recovery", async () => {
    const handler = chain([badRewrite()], {
      logger: silent,
      onError: () => new Response("maintenance", { status: 503 }),
    });
    const res = await handler(new NextRequest("http://localhost/admin"), fakeEvent);
    expect(res.status).toBe(503);
  });
});

describe("recovery precedence", () => {
  it("prefers handler-level onError over chain-level onError", async () => {
    const boom = defineHandler({
      name: "boom",
      handle: () => {
        throw new Error("x");
      },
      onError: () => new Response("handler", { status: 409 }),
    });
    const handler = chain([boom], {
      logger: silent,
      onError: () => new Response("chain", { status: 503 }),
    });
    const res = await handler(new NextRequest("http://localhost/admin"), fakeEvent);
    expect(res.status).toBe(409);
  });
});
