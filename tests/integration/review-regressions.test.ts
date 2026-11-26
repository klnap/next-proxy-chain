import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
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
