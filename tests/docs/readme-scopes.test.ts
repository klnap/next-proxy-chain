import { describe, expect, it } from "bun:test";
import { NextRequest, NextResponse } from "next/server";
import { chain as composeChain } from "../../src/index";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const deny = () => new Response("denied", { status: 403 });
const ev = {} as never;

describe("README scope examples", () => {
  it("path patterns: * is one segment, ** is any depth, /docs/** includes /docs", async () => {
    const h = composeChain([{ name: "api", handle: deny, rules: { include: "/api/*" } }], {
      logger: silent,
    });
    expect((await h(new NextRequest("http://x/api/users"), ev)).status).toBe(403);
    expect((await h(new NextRequest("http://x/api/users/123"), ev)).status).toBe(200);
    const d = composeChain([{ name: "docs", handle: deny, rules: { include: "/docs/**" } }], {
      logger: silent,
    });
    expect((await d(new NextRequest("http://x/docs"), ev)).status).toBe(403);
    expect((await d(new NextRequest("http://x/docs/a/b"), ev)).status).toBe(403);
  });

  it("exclude string and RegExp", async () => {
    const e = composeChain([{ name: "admin", handle: deny, rules: { exclude: "/admin/login" } }], {
      logger: silent,
    });
    expect((await e(new NextRequest("http://x/admin/login"), ev)).status).toBe(200);
    expect((await e(new NextRequest("http://x/admin/home"), ev)).status).toBe(403);
    const r = composeChain(
      [{ name: "public", handle: deny, rules: { exclude: /^\/public(\/.*)?$/ } }],
      { logger: silent },
    );
    expect((await r(new NextRequest("http://x/public/a"), ev)).status).toBe(200);
    expect((await r(new NextRequest("http://x/private"), ev)).status).toBe(403);
  });

  it("segments are whole: /tenant does not match /tenant-other", async () => {
    const t = composeChain([{ name: "tenant", handle: deny, rules: { include: "/tenant/**" } }], {
      logger: silent,
    });
    expect((await t(new NextRequest("http://x/tenant-other/page"), ev)).status).toBe(200);
  });

  it("host and path in one include object", async () => {
    const b = composeChain(
      [
        {
          name: "billing",
          handle: deny,
          rules: { include: { host: "app.example.com", path: ["/billing/**", "/invoices/**"] } },
        },
      ],
      { logger: silent },
    );
    expect(
      (
        await b(
          new NextRequest("http://app.example.com/billing/x", {
            headers: { host: "app.example.com" },
          }),
          ev,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await b(
          new NextRequest("http://other.example.com/billing/x", {
            headers: { host: "other.example.com" },
          }),
          ev,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await b(
          new NextRequest("http://app.example.com/home", { headers: { host: "app.example.com" } }),
          ev,
        )
      ).status,
    ).toBe(200);
  });

  it("a native redirect handler stops the chain", async () => {
    const redirect = (req: NextRequest) => NextResponse.redirect(new URL("/login", req.url));
    const h = composeChain([redirect, deny], { logger: silent });
    expect((await h(new NextRequest("http://x/a"), ev)).status).toBe(307);
  });
});
