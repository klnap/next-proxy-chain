import { describe, expect, it } from "bun:test";
import type { NextFetchEvent } from "next/server";
import { NextRequest } from "next/server";
import { chain as composeChain, defineHandler, host, next } from "../../src";

const mockEvent = {} as NextFetchEvent;

describe("Next.js 16 Integration: proxy.ts cycle", () => {
  it("composes host-based routing rules in Next.js 16 conventions", async () => {
    type Context = { tier?: string };
    const hostRouter = defineHandler<Context>({
      name: "host-router",
      handler: (req, _event, ctx) => {
        const hostname = req.headers.get("host")?.split(":")[0];
        if (hostname === "admin.platform.com") {
          ctx.tier = "unlimited";
          return next({
            request: { "x-host-route": "admin-portal" },
            headers: { "x-routed-by": "next-proxy-chain" },
          });
        }
        if (hostname === "store.platform.com") {
          ctx.tier = "standard";
          return next({
            request: { "x-host-route": "ecommerce-store" },
            headers: { "x-routed-by": "next-proxy-chain" },
          });
        }
        return next();
      },
    });

    const rateLimitProxy = defineHandler<Context>({
      name: "rate-limit",
      handler: (_req, _event, ctx) => {
        return next({
          headers: { "x-rate-limit-tier": ctx.tier ?? "standard" },
        });
      },
    });

    const proxy = composeChain<Context>([
      hostRouter,
      [
        rateLimitProxy,
        { include: { host: host([/^admin\.platform\.com$/, /^store\.platform\.com$/]) } },
      ],
    ]);

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
