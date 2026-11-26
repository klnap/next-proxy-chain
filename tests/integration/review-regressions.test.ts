import { describe, expect, it } from "bun:test";
import { NextRequest, NextResponse } from "next/server";
import { chain as composeChain, defineHandler, next } from "../../src/index";

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** Node's Response.redirect() and fetch() headers are immutable; Bun's are not. Simulate the Node behavior. */
function immutableResponse(body: BodyInit | null, init: ResponseInit): Response {
  const res = new Response(body, init);
  const frozen = new Proxy(new Headers(res.headers), {
    get(target, prop) {
      if (prop === "set" || prop === "delete" || prop === "append") {
        return () => {
          throw new TypeError("immutable headers");
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.defineProperty(res, "headers", { value: frozen });
  return res;
}
const event = {} as never;

describe("external review regressions", () => {
  it("returns a Response.redirect() (immutable headers) without a 500", async () => {
    const setHeader = defineHandler({
      name: "header",
      handler: () => next({ headers: { "x-frame-options": "DENY" } }),
    });
    const redirect = defineHandler({
      name: "redirect",
      handler: () =>
        immutableResponse(null, { status: 302, headers: { location: "https://example.com/" } }),
    });
    const handler = composeChain([setHeader, redirect], { logger: silent });
    const res = await handler(new NextRequest("http://localhost/x"), event);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("returns a fetch() response with immutable headers without a 500", async () => {
    const fromFetch = defineHandler({
      name: "fetch",
      handler: () =>
        immutableResponse("hello", { status: 200, headers: { "content-type": "text/plain" } }),
    });
    const handler = composeChain([fromFetch], { logger: silent });
    const res = await handler(new NextRequest("http://localhost/x"), event);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("strips routing headers from immutable terminal responses without losing the body", async () => {
    const terminal = defineHandler({
      handler: () =>
        immutableResponse("hello", {
          status: 200,
          headers: { "x-middleware-request-x-secret": "leak" },
        }),
    });
    const res = await composeChain([terminal], { logger: silent })(
      new NextRequest("http://localhost/x"),
      event,
    );
    expect(res.status).toBe(200);
    expect(res.headers.has("x-middleware-request-x-secret")).toBe(false);
    expect(await res.text()).toBe("hello");
  });

  it("preserves rewritten paths when later native request overrides reconstruct the request", async () => {
    let finalPath: string | undefined;
    const rewrite = defineHandler({
      handler: () => NextResponse.rewrite(new URL("http://localhost/new")),
    });
    const override = defineHandler({
      handler: () =>
        NextResponse.next({
          request: { headers: new Headers([["x-next", "1"]]) },
        }),
    });
    const matched = defineHandler({
      rules: { include: "/new" },
      handler: (request) => {
        finalPath = request.nextUrl.pathname;
        return new Response("matched");
      },
    });
    const res = await composeChain([rewrite, override, matched], { logger: silent })(
      new NextRequest("http://localhost/old"),
      event,
    );
    expect(finalPath).toBe("/new");
    expect(await res.text()).toBe("matched");
  });

  it("applies native request header overrides as a replacement, including deletions", async () => {
    let forwarded: Headers | undefined;
    const replaceHeaders = defineHandler({
      handler: () =>
        NextResponse.next({
          request: { headers: new Headers([["x-keep", "yes"]]) },
        }),
    });
    const inspect = defineHandler({
      handler: (request) => {
        forwarded = request.headers;
        return new Response("done");
      },
    });
    await composeChain([replaceHeaders, inspect], { logger: silent })(
      new NextRequest("http://localhost/x", {
        headers: { "x-secret": "remove", "x-old": "remove", "x-keep": "no" },
      }),
      event,
    );
    expect(forwarded?.get("x-secret")).toBe(null);
    expect(forwarded?.get("x-old")).toBe(null);
    expect(forwarded?.get("x-keep")).toBe("yes");
  });

  it("keeps earlier security headers on a 500 from a later rule", async () => {
    const setHeader = defineHandler({
      name: "header",
      handler: () => next({ headers: { "x-frame-options": "DENY" } }),
    });
    const boom = defineHandler({
      name: "boom",
      handler: () => {
        throw new Error("later rule failed");
      },
    });
    const handler = composeChain([setHeader, boom], { logger: silent });
    const res = await handler(new NextRequest("http://localhost/x"), event);
    expect(res.status).toBe(500);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("does not forward request overrides when no rule changed a request header", async () => {
    const pass = defineHandler({ name: "pass", handler: () => next() });
    const handler = composeChain([pass], { logger: silent });
    const req = new NextRequest("http://localhost/x", {
      headers: { accept: "text/html", "user-agent": "ua" },
    });
    const res = await handler(req, event);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect([...res.headers.keys()].filter((k) => k.startsWith("x-middleware-request-"))).toEqual(
      [],
    );
  });
});
