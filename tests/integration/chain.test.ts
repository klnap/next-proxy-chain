import { nextWithResponseHeaders } from "../helpers/native-response";
import { describe, expect, it } from "bun:test";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { assertOverrideMechanismSupported } from "../../src/core/pipeline";
import { chain as composeChain, defineHandler } from "../../src/index";

describe("Proxy Chain Pipeline Integration", () => {
  const fakeEvent = {} as NextFetchEvent;

  it("verifies platform override support without errors", () => {
    expect(() => assertOverrideMechanismSupported()).not.toThrow();
  });

  it("threads context and native request headers between sequential rules", async () => {
    type Context = { userId?: string };
    const authRule = defineHandler<Context>({
      name: "auth",
      handle: (req, _event, ctx) => {
        ctx.userId = "usr_9921";
        const headers = new Headers(req.headers);
        headers.set("x-user-id", "usr_9921");
        const response = NextResponse.next({ request: { headers } });
        response.headers.set("x-auth-applied", "true");
        return response;
      },
    });

    const enrichRule = defineHandler<Context>({
      name: "enrich",
      handle: (req, _event, ctx) => {
        expect(ctx.userId).toBe("usr_9921");
        expect(req.headers.get("x-user-id")).toBe("usr_9921");
        return nextWithResponseHeaders({ "x-enrich-applied": "true" });
      },
    });

    const chain = composeChain<Context>([authRule, enrichRule]);
    const req = new NextRequest("http://localhost:3000/");
    const res = await chain(req, fakeEvent);

    expect(res.headers.get("x-auth-applied")).toBe("true");
    expect(res.headers.get("x-enrich-applied")).toBe("true");
  });

  it("detects NextResponse.next() pass-through with override headers", async () => {
    const externalPassThrough = defineHandler({
      name: "external",
      handle: () => {
        return NextResponse.next({
          request: {
            headers: new Headers({ "x-injected": "true" }),
          },
        });
      },
    });

    const downstream = defineHandler({
      name: "downstream",
      handle: (req) => {
        expect(req.headers.get("x-injected")).toBe("true");
        return new NextResponse("success", { status: 200 });
      },
    });

    const chain = composeChain([externalPassThrough, downstream]);
    const req = new NextRequest("http://localhost:3000/");
    const res = await chain(req, fakeEvent);

    expect(res.status).toBe(200);
    expect(res.headers.has("x-middleware-next")).toBe(false);
  });

  it("handles empty rules array with default pass-through response", async () => {
    const chain = composeChain([]);
    const req = new NextRequest("http://localhost:3000/hello");
    const res = await chain(req, fakeEvent);
    expect(res.status).toBe(200);
  });

  it("handles all rules returning undefined or void cleanly", async () => {
    const noop1 = defineHandler({ name: "noop1", handle: () => undefined });
    const noop2 = defineHandler({ name: "noop2", handle: () => {} });
    const chain = composeChain([noop1, noop2]);
    const req = new NextRequest("http://localhost:3000/hello");
    const res = await chain(req, fakeEvent);
    expect(res.status).toBe(200);
  });

  const silentLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  it("catches unhandled rule errors and returns safe 500 status", async () => {
    const failingRule = defineHandler({
      name: "failing",
      handle: () => {
        throw new Error("unexpected breakdown");
      },
    });

    const chain = composeChain([failingRule], { logger: silentLogger });
    const req = new NextRequest("http://localhost:3000/");
    const res = await chain(req, fakeEvent);
    expect(res.status).toBe(500);
  });

  it("handles onError handler exceptions with safe 500 status", async () => {
    const failingRule = defineHandler({
      name: "failing",
      handle: () => {
        throw new Error("initial error");
      },
    });

    const chain = composeChain([failingRule], {
      logger: silentLogger,
      onError: () => {
        throw new Error("onError failure");
      },
    });

    const req = new NextRequest("http://localhost:3000/");
    const res = await chain(req, fakeEvent);
    expect(res.status).toBe(500);
  });

  it("allows onError handler to recover with custom terminal Response", async () => {
    const failingRule = defineHandler({
      name: "failing",
      handle: () => {
        throw new Error("unauthorized access");
      },
    });

    const chain = composeChain([failingRule], {
      onError: (_err) => new NextResponse("Access Denied", { status: 403 }),
    });

    const req = new NextRequest("http://localhost:3000/");
    const res = await chain(req, fakeEvent);
    expect(res.status).toBe(403);
  });

  it("fails closed when onError returns nothing", async () => {
    const failing = defineHandler({
      name: "auth",
      handle: () => {
        throw new Error("auth failed");
      },
    });
    const downstream = defineHandler({
      name: "downstream",
      handle: () => nextWithResponseHeaders({ "x-leaked": "1" }),
    });
    const chain = composeChain([failing, downstream], {
      logger: silentLogger,
      onError: () => {
        /* logging only */
      },
    });
    const res = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    expect(res.status).toBe(500);
    expect(res.headers.get("x-leaked")).toBeNull();
  });

  it("continues the pipeline when onError returns NextResponse.next()", async () => {
    const failing = defineHandler({
      name: "flaky",
      handle: () => {
        throw new Error("transient");
      },
    });
    const downstream = defineHandler({
      name: "downstream",
      handle: () => nextWithResponseHeaders({ "x-recovered": "1" }),
    });
    const chain = composeChain([failing, downstream], { onError: () => NextResponse.next() });
    const res = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-recovered")).toBe("1");
  });

  it("forwards Set-Cookie from NextResponse.next() onto the final response", async () => {
    const one = defineHandler({
      name: "one",
      handle: () => nextWithResponseHeaders({ "set-cookie": "session=abc; Path=/" }),
    });
    const chain = composeChain([one]);
    const res = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("session=abc"))).toBe(true);
  });

  it("forwards multiple Set-Cookie values from NextResponse.next()", async () => {
    const cookies = defineHandler({
      name: "cookies",
      handle: () =>
        nextWithResponseHeaders([
          ["set-cookie", "a=1; Path=/"],
          ["set-cookie", "b=2; Path=/"],
        ]),
    });
    const chain = composeChain([cookies]);
    const res = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    const listed = res.headers.getSetCookie();
    expect(listed.some((c) => c.startsWith("a=1"))).toBe(true);
    expect(listed.some((c) => c.startsWith("b=2"))).toBe(true);
  });

  it("merges Set-Cookie from NextResponse.next() with NextResponse.next() cookies", async () => {
    const viaNext = defineHandler({
      name: "viaNext",
      handle: () => nextWithResponseHeaders({ "set-cookie": "from-next=1; Path=/" }),
    });
    const viaResponse = defineHandler({
      name: "viaResponse",
      handle: () => {
        const res = NextResponse.next();
        res.cookies.set("from-response", "2", { path: "/" });
        return res;
      },
    });
    const chain = composeChain([viaNext, viaResponse]);
    const res = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    const listed = res.headers.getSetCookie();
    expect(listed.some((c) => c.includes("from-next=1"))).toBe(true);
    expect(listed.some((c) => c.includes("from-response=2"))).toBe(true);
  });

  it("keeps same-name cookies with different Path", async () => {
    const cookies = defineHandler({
      name: "cookies",
      handle: () =>
        nextWithResponseHeaders([
          ["set-cookie", "session=foo; Path=/"],
          ["set-cookie", "session=bar; Path=/admin"],
        ]),
    });
    const chain = composeChain([cookies]);
    const res = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    const listed = res.headers.getSetCookie();
    expect(listed).toHaveLength(2);
    expect(listed.some((c) => c.startsWith("session=foo"))).toBe(true);
    expect(listed.some((c) => c.startsWith("session=bar") && c.includes("Path=/admin"))).toBe(true);
  });

  it("deletes a header from the terminal response when merge returns null", async () => {
    const first = defineHandler({
      name: "first",
      handle: () => nextWithResponseHeaders({ "x-remove": "1", "x-keep": "1" }),
    });
    const terminal = defineHandler({
      name: "terminal",
      handle: () => new NextResponse("ok", { headers: { "x-remove": "2", "x-keep": "2" } }),
    });
    const chain = composeChain([first, terminal], {
      headerMergeStrategy: (key, _existing, incoming) => (key === "x-remove" ? null : incoming),
    });
    const res = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    expect(res.headers.get("x-remove")).toBeNull();
    expect(res.headers.get("x-keep")).toBe("2");
  });

  it("does not mutate the original NextRequest on rewrite continuation", async () => {
    const rewriter = defineHandler({
      name: "rewriter",
      handle: (req) => NextResponse.rewrite(new URL(`/shop${req.nextUrl.pathname}`, req.url)),
    });
    const downstream = defineHandler({
      name: "downstream",
      handle: (req) => {
        expect(req.nextUrl.pathname).toBe("/shop/pl/produkty");
        return NextResponse.next();
      },
    });
    const chain = composeChain([rewriter, downstream]);
    const req = new NextRequest("http://shop.localhost:3000/pl/produkty");
    const originalPath = req.nextUrl.pathname;
    const res = await chain(req, fakeEvent);
    expect(req.nextUrl.pathname).toBe(originalPath);
    expect(res.headers.get("x-middleware-rewrite")).toBe(
      "http://shop.localhost:3000/shop/pl/produkty",
    );
  });

  it("uses isolated mutable application state with a typed context", async () => {
    type Ctx = { user?: string };
    const rule = defineHandler<Ctx>({
      name: "typed",
      handle: (_req, _event, ctx) => {
        ctx.user = "ada";
        return nextWithResponseHeaders({ "x-user": ctx.user });
      },
    });
    const chain = composeChain<Ctx>([rule]);
    const res = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    expect(res.headers.get("x-user")).toBe("ada");
  });
});
