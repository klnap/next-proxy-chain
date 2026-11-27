import { nextWithResponseHeaders } from "../helpers/native-response";
import { describe, expect, it } from "bun:test";
import { NextRequest, NextResponse } from "next/server";
import { chain as composeChain, defineHandler } from "../../src/index";

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
      handle: () => nextWithResponseHeaders({ "x-frame-options": "DENY" }),
    });
    const redirect = defineHandler({
      name: "redirect",
      handle: () =>
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
      handle: () =>
        immutableResponse("hello", { status: 200, headers: { "content-type": "text/plain" } }),
    });
    const handler = composeChain([fromFetch], { logger: silent });
    const res = await handler(new NextRequest("http://localhost/x"), event);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("strips routing headers from immutable terminal responses without losing the body", async () => {
    const terminal = defineHandler({
      name: "terminal",
      handle: () =>
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
    let originalPath: string | undefined;
    const rewrite = defineHandler({
      name: "rewrite",
      handle: () => NextResponse.rewrite(new URL("http://localhost/new")),
    });
    const override = defineHandler({
      name: "override",
      handle: () =>
        NextResponse.next({
          request: { headers: new Headers([["x-next", "1"]]) },
        }),
    });
    const matched = defineHandler({
      name: "matched",
      rules: { include: "/new" },
      handle: (request, _event, context) => {
        finalPath = request.nextUrl.pathname;
        originalPath = context.originalPathname;
        return new Response("matched");
      },
    });
    const res = await composeChain([rewrite, override, matched], { logger: silent })(
      new NextRequest("http://localhost/old"),
      event,
    );
    expect(finalPath).toBe("/new");
    expect(originalPath).toBe("/old");
    expect(await res.text()).toBe("matched");
  });

  it("applies native request header overrides as a replacement, including deletions", async () => {
    let forwarded: Headers | undefined;
    const replaceHeaders = defineHandler({
      name: "replace-headers",
      handle: () =>
        NextResponse.next({
          request: { headers: new Headers([["x-keep", "yes"]]) },
        }),
    });
    const inspect = defineHandler({
      name: "inspect-headers",
      handle: (request) => {
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

  it("preserves native request header changes across successive cloned replacements", async () => {
    let finalHeaders: Headers | undefined;
    const first = defineHandler({
      name: "first",
      handle: (request) => {
        const headers = new Headers(request.headers);
        headers.set("x-added", "first");
        headers.set("x-updated", "first");
        headers.delete("x-deleted");
        return NextResponse.next({ request: { headers } });
      },
    });
    const second = defineHandler({
      name: "second",
      handle: (request) => {
        expect(request.headers.get("x-original")).toBe("kept");
        expect(request.headers.get("x-added")).toBe("first");
        expect(request.headers.get("x-updated")).toBe("first");
        expect(request.headers.get("x-deleted")).toBeNull();
        const headers = new Headers(request.headers);
        headers.set("x-updated", "second");
        headers.set("x-added-later", "second");
        return NextResponse.next({ request: { headers } });
      },
    });
    const inspect = defineHandler({
      name: "inspect",
      handle: (request) => {
        finalHeaders = new Headers(request.headers);
        return new Response("done");
      },
    });
    const response = await composeChain([first, second, inspect], { logger: silent })(
      new NextRequest("http://localhost/x", {
        headers: {
          "x-original": "kept",
          "x-updated": "original",
          "x-deleted": "remove",
        },
      }),
      event,
    );

    expect(finalHeaders?.get("x-original")).toBe("kept");
    expect(finalHeaders?.get("x-added")).toBe("first");
    expect(finalHeaders?.get("x-updated")).toBe("second");
    expect(finalHeaders?.get("x-added-later")).toBe("second");
    expect(finalHeaders?.get("x-deleted")).toBeNull();
    expect(response.headers.get("x-added")).toBeNull();
  });

  it("keeps earlier security headers on a 500 from a later rule", async () => {
    const setHeader = defineHandler({
      name: "header",
      handle: () => nextWithResponseHeaders({ "x-frame-options": "DENY" }),
    });
    const boom = defineHandler({
      name: "boom",
      handle: () => {
        throw new Error("later rule failed");
      },
    });
    const handler = composeChain([setHeader, boom], { logger: silent });
    const res = await handler(new NextRequest("http://localhost/x"), event);
    expect(res.status).toBe(500);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("does not forward request overrides when no rule changed a request header", async () => {
    const pass = defineHandler({ name: "pass", handle: () => NextResponse.next() });
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
