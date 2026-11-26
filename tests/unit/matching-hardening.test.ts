import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { canonicalPathname, host, normalizeHost } from "../../src/core/matching";
import { chain as composeChain, defineHandler, next, path } from "../../src/index";

const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe("scope matching hardening", () => {
  it("keeps top-level regex alternation inside the anchors", () => {
    const exclude = path(/\/public|\/static/);
    expect(exclude.test("/admin/static")).toBe(false);
    expect(exclude.test("/public")).toBe(true);

    const prefixed = path(/^\/public|^\/static/);
    expect(prefixed.test("/dashboard/static/x")).toBe(false);
    expect(prefixed.test("/static")).toBe(true);
  });

  it("canonicalizes encoded, trailing-slash and double-slash paths", () => {
    expect(canonicalPathname("/%61dmin/users")).toBe("/admin/users");
    expect(canonicalPathname("/admin%2Fusers")).toBe("/admin/users");
    expect(canonicalPathname("/admin/")).toBe("/admin");
    expect(canonicalPathname("/")).toBe("/");
    expect(canonicalPathname("/%E0%A4%A")).toBeNull();
  });

  it("strips a trailing dot from the Host header", () => {
    expect(normalizeHost("admin.example.com.")).toBe("admin.example.com");
    expect(host("admin.example.com").test(normalizeHost("admin.example.com.") ?? "")).toBe(true);
  });

  it("applies an include-scoped auth rule to an encoded admin path", async () => {
    const auth = defineHandler({
      name: "auth",
      handler: () => new Response("denied", { status: 403 }),
    });
    const handler = composeChain([[auth, { include: path("/admin/**") }]], { logger: silent });

    const encoded = await handler(new NextRequest("http://localhost/%61dmin/users"), {} as never);
    expect(encoded.status).toBe(403);

    const trailing = await handler(new NextRequest("http://localhost/admin/"), {} as never);
    expect(trailing.status).toBe(403);
  });

  it("fails closed with 400 on malformed percent-encoding", async () => {
    const pass = defineHandler({ name: "pass", handler: () => next() });
    const handler = composeChain([pass], { logger: silent });
    const res = await handler(new NextRequest("http://localhost/%E0%A4%A"), {} as never);
    expect(res.status).toBe(400);
  });

  it("applies a ** scope to decoded control characters in the path", async () => {
    const auth = defineHandler({
      name: "auth",
      handler: () => new Response("denied", { status: 403 }),
    });
    const handler = composeChain([[auth, { include: path("/admin/**") }]], { logger: silent });
    for (const url of [
      "http://localhost/admin/%0Asecret",
      "http://localhost/admin/%0Dsecret",
      "http://localhost/admin/%E2%80%A8secret",
    ]) {
      const res = await handler(new NextRequest(url), {} as never);
      expect(res.status).toBe(403);
    }
  });

  it("rejects rule objects that are not created by defineHandler", () => {
    const rule = { run: () => next(), include: [path("/x/**")] };
    expect(() => composeChain([rule as never], { logger: silent })).toThrow(/defineHandler/);
  });

  it("rejects a path segment that mixes a wildcard with other characters", () => {
    const auth = defineHandler({
      name: "auth",
      handler: () => new Response("denied", { status: 403 }),
    });
    expect(() => composeChain([[auth, "/files/*.pdf"]])).toThrow(/mixes a wildcard/);
  });
});
