import { describe, expect, it } from "bun:test";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import type { ChainTrace } from "../../src/core/diagnostics/types";
import { chain, defineHandler, next } from "../../src/index";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const event = { waitUntil() {} } as unknown as NextFetchEvent;

describe("request context", () => {
  it("creates one private request identity and preserves original metadata across rewrites", async () => {
    const seen: Array<{
      requestId: string;
      pathname: string;
      originalUrl: string;
      originalPathname: string;
      originalHostname: string;
    }> = [];
    let trace: ChainTrace | undefined;
    const rewrite = defineHandler({
      name: "rewrite",
      handler: (_request, _event, context) => {
        expect(context.requestId).toMatch(
          /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        return NextResponse.rewrite(new URL("/pl/about?secret=hidden", "https://example.com"));
      },
    });
    const inspect = defineHandler({
      name: "inspect",
      handler: (request, _event, context) => {
        seen.push({
          requestId: context.requestId,
          pathname: request.nextUrl.pathname,
          originalUrl: context.originalUrl,
          originalPathname: context.originalPathname,
          originalHostname: context.originalHostname,
        });
        return next();
      },
    });
    const proxy = chain([rewrite, inspect], {
      debug: false,
      tracePath: false,
      onTrace: (value) => {
        trace = value;
      },
      logger: silent,
    });
    const request = new NextRequest("https://example.com/about?token=private");
    const response = await proxy(request, event);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      pathname: "/pl/about",
      originalUrl: "https://example.com/about?token=private",
      originalPathname: "/about",
      originalHostname: "example.com",
    });
    expect(seen[0]?.requestId).toMatch(/^req_[0-9a-f-]{36}$/i);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/pl/about?secret=hidden");
    expect(response.headers.has("x-request-id")).toBe(false);
    expect(trace?.requestId).toBe(seen[0]?.requestId);
    expect(trace?.startedAt).toEqual(expect.any(Number));
    expect(trace?.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(trace)).not.toContain("token=private");
    expect(JSON.stringify(trace)).not.toContain("secret=hidden");
  });

  it("shares custom state but gives each handler a stable, independent context and signal", async () => {
    type AppContext = { userId: string };
    let firstContext: object | undefined;
    let firstSignal: AbortSignal | undefined;
    let predicateContext: object | undefined;
    let predicateSignal: AbortSignal | undefined;
    const first = defineHandler<AppContext>({
      name: "first",
      handler: (_request, _event, context) => {
        expect(context.userId).toBeUndefined();
        context.userId = "user-123";
        firstContext = context;
        firstSignal = context.signal;
        return next();
      },
    });
    const second = defineHandler<AppContext>({
      name: "second",
      timeout: 0,
      rules: {
        when: (_request, _event, context) => {
          predicateContext = context;
          predicateSignal = context.signal;
          return context.userId === "user-123";
        },
      },
      handler: (_request, _event, context) => {
        expect(context.userId).toBe("user-123");
        expect(context === predicateContext).toBe(true);
        expect(context.signal === predicateSignal).toBe(true);
        expect(context === firstContext).toBe(false);
        expect(context.signal === firstSignal).toBe(false);
        return next();
      },
    });

    const response = await chain<AppContext>([first, second], { timeout: 0, logger: silent })(
      new NextRequest("https://example.com/"),
      event,
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(firstSignal?.aborted).toBe(false);
    expect(predicateSignal?.aborted).toBe(false);
  });

  it("protects every reserved property while keeping application state mutable", async () => {
    let context: Record<string, unknown> | undefined;
    type Context = { applicationState?: string };
    const capture = defineHandler<Context>({
      handler: (_request, _event, value) => {
        context = value as unknown as Record<string, unknown>;
        value.applicationState = "mutable";
        return next();
      },
    });
    await chain<Context>([capture], { logger: silent })(
      new NextRequest("https://example.com/"),
      event,
    );

    expect(Object.getPrototypeOf(context)).toBeNull();
    expect(context?.applicationState).toBe("mutable");
    for (const key of [
      "requestId",
      "startedAt",
      "elapsedMs",
      "originalUrl",
      "originalPathname",
      "originalHostname",
      "signal",
    ]) {
      expect(Reflect.set(context!, key, "changed")).toBe(false);
      expect(Reflect.deleteProperty(context!, key)).toBe(false);
      expect(Reflect.defineProperty(context!, key, { value: "changed" })).toBe(false);
    }
    expect(Reflect.setPrototypeOf(context!, {})).toBe(false);
    expect(() => Object.assign(context!, { requestId: "spoofed" })).toThrow();
    expect(context?.requestId).toMatch(/^req_[0-9a-f-]{36}$/i);
    expect(context?.applicationState).toBe("mutable");
  });

  it("isolates application state between concurrent requests", async () => {
    type AppContext = { userId: string };
    const setThenRead = defineHandler<AppContext>({
      handler: async (request, _event, context) => {
        context.userId = request.headers.get("x-user") ?? "missing";
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(context.userId);
      },
    });
    const proxy = chain<AppContext>([setThenRead], { logger: silent });
    const [ada, lin] = await Promise.all([
      proxy(new NextRequest("https://example.com/", { headers: { "x-user": "ada" } }), event),
      proxy(new NextRequest("https://example.com/", { headers: { "x-user": "lin" } }), event),
    ]);

    expect(await ada.text()).toBe("ada");
    expect(await lin.text()).toBe("lin");
  });

  it("preserves native cancellation on a request reconstructed after header overrides", async () => {
    const controller = new AbortController();
    let markEntered!: () => void;
    let release!: () => void;
    let reconstructedSignal: AbortSignal | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const completed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setHeader = defineHandler({ handler: () => next({ request: { "x-chain": "1" } }) });
    const waitForAbort = defineHandler({
      handler: async (request) => {
        reconstructedSignal = request.signal;
        markEntered();
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) resolve();
          else request.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        release();
      },
    });
    const pending = chain([setHeader, waitForAbort], { logger: silent })(
      new NextRequest("https://example.com/", { signal: controller.signal }),
      event,
    );
    await entered;
    controller.abort();
    await pending;
    expect(reconstructedSignal?.aborted).toBe(true);
    await completed;
  });

  it("keeps elapsed time monotonic when the wall clock changes", async () => {
    const wallClock = Date.now;
    let startedAt = 0;
    let elapsedMs = 0;
    const capture = defineHandler({
      handler: async (_request, _event, context) => {
        startedAt = context.startedAt;
        Date.now = () => startedAt - 60_000;
        await new Promise((resolve) => setTimeout(resolve, 10));
        elapsedMs = context.elapsedMs;
        return next();
      },
    });
    try {
      const response = await chain([capture], { logger: silent })(
        new NextRequest("https://example.com/"),
        event,
      );
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(startedAt).toEqual(expect.any(Number));
      expect(elapsedMs).toBeGreaterThanOrEqual(5);
    } finally {
      Date.now = wallClock;
    }
  });
});
