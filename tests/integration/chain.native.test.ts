import { nextWithResponseHeaders } from "../helpers/native-response";
import { describe, expect, it } from "bun:test";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { chain as composeChain, defineHandler } from "../../src/index";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const req = (url: string) => new NextRequest(url);

describe("chain() with native Next.js handlers", () => {
  it("passes (request, event) to a native handler, so event.waitUntil works", async () => {
    const calls: string[] = [];
    const analytics = (_req: NextRequest, event: NextFetchEvent) => {
      event.waitUntil(Promise.resolve().then(() => calls.push("waitUntil")));
      return NextResponse.next();
    };
    const handler = composeChain([analytics], { logger: silent });
    const res = await handler(req("http://localhost/x"), { waitUntil() {} } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("awaits an async native handler", async () => {
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return undefined;
    };
    const handler = composeChain([slow], { logger: silent });
    const res = await handler(req("http://localhost/x"), {} as never);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("accepts configured object method syntax without a receiver contract", async () => {
    const configured = defineHandler({
      name: "method",
      handle(request) {
        return new Response(request.nextUrl.pathname);
      },
    });
    const response = await composeChain([configured])(
      new NextRequest("https://example.com/method"),
      {} as never,
    );

    expect(await response.text()).toBe("/method");
  });

  it("runs a scoped native handler only for matching paths", async () => {
    const auth = (_req: NextRequest) => new Response("denied", { status: 403 });
    const handler = composeChain(
      [{ name: "auth", handle: auth, rules: { include: "/dashboard/**" } }],
      { logger: silent },
    );
    expect((await handler(req("http://localhost/dashboard/home"), {} as never)).status).toBe(403);
    expect((await handler(req("http://localhost/about"), {} as never)).status).toBe(200);
  });

  it("accepts an exclude object and a RegExp exclude, Nimpl-style", async () => {
    const auth = () => new Response("denied", { status: 403 });
    const handler = composeChain(
      [{ name: "auth", handle: auth, rules: { exclude: /^\/private(\/.*)?$/ } }],
      { logger: silent },
    );
    expect((await handler(req("http://localhost/private/x"), {} as never)).status).toBe(200);
    expect((await handler(req("http://localhost/public"), {} as never)).status).toBe(403);
  });

  it("stops at a native redirect and keeps earlier headers", async () => {
    const header = (_req: NextRequest) => nextWithResponseHeaders({ "x-frame-options": "DENY" });
    const redirect = (req: NextRequest) => NextResponse.redirect(new URL("/login", req.url));
    const after = () => new Response("unreachable", { status: 200 });
    const handler = composeChain([header, redirect, after], { logger: silent });
    const res = await handler(req("http://localhost/x"), {} as never);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("returns 500 when a native handler throws", async () => {
    const broken = () => {
      throw new Error("boom");
    };
    const handler = composeChain([broken], { logger: silent });
    expect((await handler(req("http://localhost/x"), {} as never)).status).toBe(500);
  });

  it("an empty chain passes every request through", async () => {
    const handler = composeChain([], { logger: silent });
    expect(
      (await handler(req("http://localhost/x"), {} as never)).headers.get("x-middleware-next"),
    ).toBe("1");
  });

  it("keeps defineHandler context isolated per request and shares it between rules", async () => {
    type Ctx = { user?: string };
    const setUser = defineHandler<Ctx>({
      name: "set-user",
      handle: (r, _event, ctx) => {
        ctx.user = r.headers.get("x-user") ?? "anonymous";
        return NextResponse.next();
      },
    });
    const reportUser = defineHandler<Ctx>({
      name: "report-user",
      handle: (_r, _event, ctx) => nextWithResponseHeaders({ "x-seen-user": ctx.user ?? "none" }),
    });
    const handler = composeChain<Ctx>([setUser, reportUser], { logger: silent });
    const a = await handler(
      new NextRequest("http://localhost/a", { headers: { "x-user": "ada" } }),
      {} as never,
    );
    const b = await handler(new NextRequest("http://localhost/b"), {} as never);
    expect(a.headers.get("x-seen-user")).toBe("ada");
    expect(b.headers.get("x-seen-user")).toBe("anonymous");
  });

  it("scopes inline and reusable handler configurations identically", async () => {
    const config = {
      name: "deny",
      rules: { include: "/admin/**" },
      handle: () => new Response("denied", { status: 403 }),
    };
    const inline = composeChain([config], { logger: silent });
    const reusableConfig = defineHandler(config);
    expect(reusableConfig).toBe(config);
    const reusable = composeChain([reusableConfig], { logger: silent });
    for (const handler of [inline, reusable]) {
      expect((await handler(req("http://localhost/admin/x"), {} as never)).status).toBe(403);
      expect((await handler(req("http://localhost/home"), {} as never)).status).toBe(200);
    }
  });

  it("rejects tuple and malformed configured entries with clear errors", () => {
    const auth = () => undefined;
    expect(() => composeChain([[auth, "/admin/**"]] as never)).toThrow(
      /tuple entries are not supported/,
    );
    expect(() => composeChain([{ name: "missing-handler" }] as never)).toThrow(
      /configured handlers require a non-empty name and handle/,
    );
    expect(() => composeChain([{ handle: auth }] as never)).toThrow(
      /configured handlers require a non-empty name and handle/,
    );
    expect(() => composeChain([{ name: "legacy", handler: auth } as never])).toThrow(
      /configured handlers require a non-empty name and handle/,
    );
    expect(() => composeChain([{ name: "both", handle: auth, handler: auth } as never])).toThrow(
      /configured handler property 'handler' is unsupported/,
    );
    expect(() =>
      composeChain([{ name: "nested", handle: auth, config: { timeout: 1 } }] as never),
    ).toThrow(/handler configuration must use top-level options/);
    expect(() => defineHandler({ handle: auth } as never)).toThrow(
      /configured handlers require a non-empty name and handle/,
    );
    expect(() => defineHandler({ name: " ", handle: auth } as never)).toThrow(
      /configured handlers require a non-empty name and handle/,
    );
  });

  it("passes the request context to a native handler as the third argument", async () => {
    type Ctx = { user?: string };
    const tag = defineHandler<Ctx>({
      name: "tag",
      handle: (_r, _event, ctx) => {
        ctx.user = "ada";
        return NextResponse.next();
      },
    });
    const native = (
      _req: NextRequest,
      event: { waitUntil(p: Promise<unknown>): void },
      ctx: { requestId: string; user?: string },
    ) => {
      event.waitUntil(Promise.resolve());
      return nextWithResponseHeaders({ "x-request-id": ctx.requestId, "x-user": ctx.user ?? "" });
    };
    const handler = composeChain<Ctx>([tag, native], { logger: silent });
    const res = await handler(new NextRequest("http://localhost/x"), { waitUntil() {} } as never);
    expect(res.headers.get("x-request-id")).toMatch(/^req_[0-9a-f-]{36}$/i);
    expect(res.headers.get("x-user")).toBe("ada");
  });

  it("generates a request id independent of incoming headers", async () => {
    const rule = defineHandler({
      name: "rule",
      handle: (_r, _event, ctx) => nextWithResponseHeaders({ "x-seen-id": ctx.requestId }),
    });
    const handler = composeChain([rule], { logger: silent });
    const withId = await handler(
      new NextRequest("http://localhost/x", { headers: { "x-request-id": "abc" } }),
      {} as never,
    );
    expect(withId.headers.get("x-request-id")).toBeNull();
    expect(withId.headers.get("x-seen-id")).toMatch(/^req_[0-9a-f-]{36}$/i);
    const generated = await handler(new NextRequest("http://localhost/y"), {} as never);
    expect(generated.headers.get("x-seen-id")).toMatch(/^req_[0-9a-f-]{36}$/i);
    expect(generated.headers.get("x-seen-id")).not.toBe(withId.headers.get("x-seen-id"));
  });
});
