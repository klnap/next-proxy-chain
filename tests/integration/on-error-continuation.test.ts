import { describe, expect, it } from "bun:test";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { chain as composeChain, defineHandler, next } from "../../src/index";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const fakeEvent = {} as NextFetchEvent;

describe("onError recovery semantics", () => {
  it("treats NextResponse.next() from a rule-level onError as continuation", async () => {
    const boom = defineHandler({
      name: "boom",
      handler: () => {
        throw new Error("upstream down");
      },
    });
    const auth = defineHandler({
      name: "auth",
      handler: () => new Response("denied", { status: 403 }),
    });
    const handler = composeChain([boom, auth], {
      logger: silent,
      onError: () => NextResponse.next(),
    });

    const res = await handler(new NextRequest("http://localhost/admin"), fakeEvent);
    expect(res.status).toBe(403);
  });

  it("still stops on a terminal Response from onError", async () => {
    const boom = defineHandler({
      name: "boom",
      handler: () => {
        throw new Error("upstream down");
      },
    });
    const auth = defineHandler({
      name: "auth",
      handler: () => new Response("unreachable", { status: 200 }),
    });
    const handler = composeChain([boom, auth], {
      logger: silent,
      onError: () => new Response("blocked", { status: 503 }),
    });

    const res = await handler(new NextRequest("http://localhost/admin"), fakeEvent);
    expect(res.status).toBe(503);
  });

  it("strips Next.js request-override headers from a terminal rule Response", async () => {
    const stop = defineHandler({
      name: "stop",
      handler: () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "/login",
            "x-middleware-override-headers": "cookie",
            "x-middleware-request-cookie": "session=evil",
          },
        }),
    });
    const handler = composeChain([stop], { logger: silent });

    const res = await handler(new NextRequest("http://localhost/x"), fakeEvent);
    expect(res.status).toBe(302);
    expect(res.headers.get("x-middleware-override-headers")).toBeNull();
    expect(res.headers.get("x-middleware-request-cookie")).toBeNull();
  });

  it("merges earlier rule headers and cookies into an engine-level onError Response", async () => {
    const setHeaders = defineHandler({
      name: "headers",
      handler: () =>
        next({ headers: { "x-csp": "default-src 'self'", "set-cookie": "sid=1; Path=/" } }),
    });
    const badRewrite = defineHandler({
      name: "bad-rewrite",
      handler: () =>
        new Response(null, {
          status: 200,
          headers: { "x-middleware-rewrite": "http://[::bad" },
        }),
    });
    const handler = composeChain([setHeaders, badRewrite], {
      logger: silent,
      onError: () => new Response("recovered", { status: 503 }),
    });

    const res = await handler(new NextRequest("http://localhost/x"), fakeEvent);
    expect(res.headers.get("x-csp")).toBe("default-src 'self'");
    expect(res.headers.get("set-cookie")).toContain("sid=1");
  });

  it("fails closed when an engine-level onError returns NextResponse.next()", async () => {
    // Continues with an invalid rewrite target, so the failure happens after all rules ran.
    const badRewrite = defineHandler({
      name: "bad-rewrite",
      handler: () => {
        const res = NextResponse.rewrite(new URL("http://localhost/ok"));
        res.headers.set("x-middleware-rewrite", "http://[::bad");
        return res;
      },
    });
    // No later rule may stop the chain, so the final rewrite is the failing step.
    const handler = composeChain([badRewrite], {
      logger: silent,
      onError: () => NextResponse.next(),
    });

    const res = await handler(new NextRequest("http://localhost/admin"), fakeEvent);
    expect(res.status).toBe(500);
  });

  it("strips routing override headers from an onError-recovered Response", async () => {
    const boom = defineHandler({
      name: "boom",
      handler: () => {
        throw new Error("upstream down");
      },
    });
    const handler = composeChain([boom], {
      logger: silent,
      onError: () =>
        new Response("Service unavailable", {
          status: 503,
          headers: {
            "x-middleware-override-headers": "cookie",
            "x-middleware-request-cookie": "session=evil",
          },
        }),
    });

    const res = await handler(new NextRequest("http://localhost/x"), fakeEvent);
    expect(res.status).toBe(503);
    expect(res.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(res.headers.get("x-middleware-override-headers")).toBeNull();
  });

  it("does not honor x-middleware-rewrite from a relayed plain Response", async () => {
    const upstream = defineHandler({
      name: "upstream",
      handler: () =>
        new Response("upstream body", {
          status: 200,
          headers: { "x-middleware-rewrite": "/internal/admin" },
        }),
    });
    const auth = defineHandler({
      name: "auth",
      handler: () => new Response("denied", { status: 403 }),
    });
    const handler = composeChain([upstream, auth], { logger: silent });

    const res = await handler(new NextRequest("http://localhost/x"), fakeEvent);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("upstream body");
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("reports a malformed rule return with that rule index, not -1", async () => {
    const malformed = defineHandler({ name: "malformed", handler: () => "continue" as never });
    const auth = defineHandler({
      name: "auth",
      handler: () => new Response("denied", { status: 403 }),
    });
    const seen: number[] = [];
    const handler = composeChain([malformed, auth], {
      logger: silent,
      onError: (_err, index) => {
        seen.push(index);
        return new Response("recovered", { status: 503 });
      },
    });

    const res = await handler(new NextRequest("http://localhost/admin"), fakeEvent);
    expect(seen).toEqual([0]);
    expect(res.status).toBe(503);
  });
});
