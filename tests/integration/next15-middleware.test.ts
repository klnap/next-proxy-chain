import { describe, expect, it } from "bun:test";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { chain as composeChain, defineHandler } from "../../src";

const mockEvent = {} as NextFetchEvent;

describe("Next.js 15 Integration: middleware.ts cycle", () => {
  it("executes as a standard Next.js 15 middleware export", async () => {
    const requestIdProxy = defineHandler({
      name: "requestId",
      handle: (req) => {
        const id = req.headers.get("x-request-id") ?? "req_test_15";
        const headers = new Headers(req.headers);
        headers.set("x-request-id", id);
        const response = NextResponse.next({ request: { headers } });
        response.headers.set("x-request-id", id);
        return response;
      },
    });

    const authProxy = defineHandler({
      name: "auth",
      rules: { include: "/dashboard/*" },
      handle: (req) => {
        const cookie = req.cookies.get("auth_session")?.value;
        if (!cookie) {
          return NextResponse.redirect(new URL("/login", req.url));
        }
        return NextResponse.next();
      },
    });

    const middleware = composeChain([requestIdProxy, authProxy]);

    // 1. Unauthenticated request to /dashboard -> 307 redirect
    const unauthReq = new NextRequest("https://example.com/dashboard/settings");
    const unauthRes = await middleware(unauthReq, mockEvent);
    expect(unauthRes.status).toBe(307);
    expect(unauthRes.headers.get("location")).toBe("https://example.com/login");
    expect(unauthRes.headers.get("x-request-id")).toBe("req_test_15");

    // 2. Authenticated request to /dashboard -> pass with headers
    const authReq = new NextRequest("https://example.com/dashboard/settings", {
      headers: { cookie: "auth_session=valid_token" },
    });
    const authRes = await middleware(authReq, mockEvent);
    expect(authRes.status).toBe(200);
    expect(authRes.headers.get("x-request-id")).toBe("req_test_15");

    // 3. Public route -> bypasses authProxy
    const publicReq = new NextRequest("https://example.com/about");
    const publicRes = await middleware(publicReq, mockEvent);
    expect(publicRes.status).toBe(200);
  });
});
