import { nextWithResponseHeaders } from "../helpers/native-response";
import { NextResponse } from "next/server";
import { describe, expect, it } from "bun:test";
import type { NextFetchEvent } from "next/server";
import { NextRequest } from "next/server";
import { chain as composeChain, defineHandler } from "../../src";

const mockEvent = {} as NextFetchEvent;

describe("Next.js 16 Integration: proxy.ts cycle", () => {
  it("composes host-based routing rules in Next.js 16 conventions", async () => {
    type Context = { tier?: string };
    const hostRouter = defineHandler<Context>({
      name: "host-router",
      handle: (req, _event, ctx) => {
        const hostname = req.headers.get("host")?.split(":")[0];
        if (hostname === "admin.platform.com") {
          ctx.tier = "unlimited";
          const headers = new Headers(req.headers);
          headers.set("x-host-route", "admin-portal");
          const response = NextResponse.next({ request: { headers } });
          response.headers.set("x-routed-by", "next-proxy-chain");
          return response;
        }
        if (hostname === "store.platform.com") {
          ctx.tier = "standard";
          const headers = new Headers(req.headers);
          headers.set("x-host-route", "ecommerce-store");
          const response = NextResponse.next({ request: { headers } });
          response.headers.set("x-routed-by", "next-proxy-chain");
          return response;
        }
        return NextResponse.next();
      },
    });

    const rateLimitProxy = defineHandler<Context>({
      name: "rate-limit",
      rules: { include: { host: [/^admin\.platform\.com$/, /^store\.platform\.com$/] } },
      handle: (_req, _event, ctx) => {
        return nextWithResponseHeaders({ "x-rate-limit-tier": ctx.tier ?? "standard" });
      },
    });

    const proxy = composeChain<Context>([hostRouter, rateLimitProxy]);

    // Admin host request
    const adminReq = new NextRequest("https://admin.platform.com/overview", {
      headers: { host: "admin.platform.com" },
    });
    const adminRes = await proxy(adminReq, mockEvent);
    expect(adminRes.status).toBe(200);
    expect(adminRes.headers.get("x-routed-by")).toBe("next-proxy-chain");
    expect(adminRes.headers.get("x-rate-limit-tier")).toBe("unlimited");

    // Store host request
    const storeReq = new NextRequest("https://store.platform.com/products", {
      headers: { host: "store.platform.com" },
    });
    const storeRes = await proxy(storeReq, mockEvent);
    expect(storeRes.status).toBe(200);
    expect(storeRes.headers.get("x-rate-limit-tier")).toBe("standard");
  });
});
