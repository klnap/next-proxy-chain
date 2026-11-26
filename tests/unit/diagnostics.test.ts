import { describe, expect, it } from "bun:test";
import { NextRequest, NextResponse } from "next/server";
import { formatTrace, shouldUseColor, supportsUnicode } from "../../src/core/diagnostics/formatter";
import { safeDestination, safeDiagnosticText } from "../../src/core/diagnostics/sanitize";
import type { ChainTrace } from "../../src/core/diagnostics/types";
import { chain as composeChain, defineHandler, next } from "../../src/index";

describe("diagnostic formatting", () => {
  it("formats compact traces as one readable line", () => {
    const trace: ChainTrace = {
      method: "GET",
      pathname: "/work",
      durationMs: 1.48,
      outcome: { type: "next" },
      handlers: [
        {
          name: "security",
          outcome: "continue",
          source: "undefined",
          durationMs: 0.09,
        },
        { name: "auth", outcome: "skipped", reason: "include-mismatch" },
      ],
    };
    const output = formatTrace(trace, "compact", false, true);
    expect(output).toBe("proxy-chain GET /work → NEXT · 1 executed · 1 skipped · 1.48ms");
    expect(output).not.toContain("\n");
  });

  it("sanitizes terminal controls and hides destination query values", () => {
    expect(safeDiagnosticText("name\u001b[31m\r\n\u202e")).toBe("name�[31m���");
    expect(safeDestination("https://example.com/login?token=secret#hash")).toBe("/login?[query]");
  });

  it("formats rule skips separately from handlers that were not reached", () => {
    const trace: ChainTrace = {
      method: "GET",
      pathname: "/dashboard",
      durationMs: 2,
      outcome: { type: "redirect", status: 307, destination: "/login" },
      handlers: [
        {
          name: "security",
          outcome: "continue",
          source: "undefined",
          durationMs: 0.1,
        },
        { name: "auth", outcome: "skipped", reason: "include-mismatch" },
        { name: "intl", outcome: "not-reached" },
      ],
    };
    const output = formatTrace(trace, "verbose", false, false);
    expect(output).toContain("reason: include-mismatch");
    expect(output).toContain("not reached");
    expect(output).toContain("REDIRECT 307 /login");
  });

  it("shows handler match results and effective timeout in verbose output", () => {
    const trace: ChainTrace = {
      method: "GET",
      durationMs: 2,
      outcome: { type: "next" },
      handlers: [
        {
          name: "auth",
          outcome: "continue",
          source: "undefined",
          durationMs: 1,
          details: {
            include: ["/account/**"],
            includeResult: "matched",
            exclude: ["/account/login"],
            excludeResult: "not-matched",
            when: "matched",
            timeoutMs: 2000,
            timeoutSource: "handler",
          },
        },
      ],
    };
    const output = formatTrace(trace, "verbose", false, false);
    expect(output).toContain("include: /account/** (matched)");
    expect(output).toContain("exclude: /account/login (not-matched)");
    expect(output).toContain("when: true");
    expect(output).toContain("timeout: 2000ms (handler)");
  });

  it("gives NO_COLOR precedence over FORCE_COLOR", () => {
    const oldNoColor = process.env.NO_COLOR;
    const oldForceColor = process.env.FORCE_COLOR;
    process.env.NO_COLOR = "1";
    process.env.FORCE_COLOR = "1";
    expect(shouldUseColor()).toBe(false);
    if (oldNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = oldNoColor;
    if (oldForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = oldForceColor;
  });

  it("honors FORCE_COLOR and uses plain output in CI without it", () => {
    const oldNoColor = process.env.NO_COLOR;
    const oldForceColor = process.env.FORCE_COLOR;
    const oldCi = process.env.CI;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    process.env.CI = "true";
    expect(shouldUseColor()).toBe(true);
    delete process.env.FORCE_COLOR;
    expect(shouldUseColor()).toBe(false);
    if (oldNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = oldNoColor;
    if (oldForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = oldForceColor;
    if (oldCi === undefined) delete process.env.CI;
    else process.env.CI = oldCi;
  });

  it("uses ASCII symbols for C locales and bounds formatted output", () => {
    const oldLang = process.env.LANG;
    process.env.LANG = "C";
    expect(supportsUnicode()).toBe(false);
    if (oldLang === undefined) delete process.env.LANG;
    else process.env.LANG = oldLang;

    const trace: ChainTrace = {
      method: "GET",
      pathname: "/work",
      durationMs: 1,
      outcome: { type: "next" },
      handlers: Array.from({ length: 1000 }, (_, index) => ({
        name: `handler-${index}`,
        outcome: "continue" as const,
        source: "undefined" as const,
        durationMs: 0.01,
      })),
    };
    const output = formatTrace(trace, "detailed", false, false);
    expect(output).toContain("proxy-chain GET /work");
    expect(output).toContain("diagnostics truncated");
    expect(output.length).toBeLessThan(16_500);
    expect(output).not.toContain("│");
  });
});

describe("chain structured diagnostics", () => {
  it("traces execution, rule skips, redirects, and handlers not reached", async () => {
    let trace: ChainTrace | undefined;
    const redirect = () => NextResponse.redirect("https://example.com/login?token=secret");
    const proxy = composeChain(
      [
        () => next(),
        defineHandler({
          name: "auth",
          rules: { include: "/private/**" },
          handler: () => NextResponse.next(),
        }),
        redirect,
        () => new Response("unreachable"),
      ],
      {
        debug: false,
        onTrace: (value) => {
          trace = value;
        },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
    );

    const response = await proxy(new NextRequest("https://example.com/public"), {} as never);
    expect(response.status).toBe(307);
    expect(trace?.outcome).toEqual({
      type: "redirect",
      status: 307,
      destination: "/login?[query]",
    });
    expect(trace?.handlers.map((handler) => handler.outcome)).toEqual([
      "continue",
      "skipped",
      "redirect",
      "not-reached",
    ]);
    expect(trace?.handlers[0]).toMatchObject({
      outcome: "continue",
      source: "next()",
    });
  });

  it("distinguishes implicit continuation from NextResponse.next()", async () => {
    let trace: ChainTrace | undefined;
    const proxy = composeChain([() => undefined, () => NextResponse.next()], {
      onTrace: (value) => {
        trace = value;
      },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    await proxy(new NextRequest("https://example.com/work"), {} as never);
    expect(trace?.handlers).toMatchObject([
      { outcome: "continue", source: "undefined" },
      { outcome: "continue", source: "NextResponse.next()" },
    ]);
  });

  it("emits built-in details for a handler override when global debug is disabled", async () => {
    const messages: string[] = [];
    const proxy = composeChain(
      [
        defineHandler({
          name: "local-debug",
          debug: "verbose",
          handler: () => NextResponse.next(),
        }),
      ],
      {
        debug: false,
        logger: {
          debug() {},
          info(message) {
            messages.push(String(message));
          },
          warn() {},
          error() {},
        },
      },
    );

    await proxy(new NextRequest("https://example.com/work"), {} as never);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("local-debug");
    expect(messages[0]).toContain("NEXT");
  });

  it("keeps compact request counts when a handler suppresses its detail", async () => {
    const messages: string[] = [];
    const proxy = composeChain(
      [
        defineHandler({
          name: "hidden",
          debug: false,
          handler: () => undefined,
        }),
        () => NextResponse.next(),
      ],
      {
        debug: "compact",
        logger: {
          debug() {},
          info(message) {
            messages.push(String(message));
          },
          warn() {},
          error() {},
        },
      },
    );
    await proxy(new NextRequest("https://example.com/work"), {} as never);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("2 executed");
  });

  it("normalizes debug true to detailed output", async () => {
    const messages: string[] = [];
    const proxy = composeChain([() => NextResponse.next()], {
      debug: true,
      logger: {
        debug() {},
        info(message) {
          messages.push(String(message));
        },
        warn() {},
        error() {},
      },
    });
    await proxy(new NextRequest("https://example.com/work"), {} as never);
    expect(messages[0]).toContain("continue");
    expect(messages[0]).toContain("NEXT");
    expect(messages[0]).toContain("\n");
  });

  it("honors explicit false handler debugging and reports when-false skips", async () => {
    const messages: string[] = [];
    let trace: ChainTrace | undefined;
    const proxy = composeChain(
      [
        defineHandler({
          name: "hidden",
          debug: false,
          handler: () => NextResponse.next(),
        }),
        defineHandler({
          name: "conditional",
          debug: false,
          rules: { when: () => false },
          handler: () => NextResponse.next(),
        }),
      ],
      {
        debug: "verbose",
        onTrace: (value) => {
          trace = value;
        },
        logger: {
          debug() {},
          info(message) {
            messages.push(String(message));
          },
          warn() {},
          error() {},
        },
      },
    );

    await proxy(new NextRequest("https://example.com/work"), {} as never);
    expect(trace?.handlers.map((handler) => handler.outcome)).toEqual(["continue", "skipped"]);
    expect(trace?.handlers[1]).toMatchObject({
      outcome: "skipped",
      reason: "when-false",
      details: { when: "false" },
    });
    expect(messages[0]).not.toContain("hidden");
    expect(messages[0]).not.toContain("conditional");
  });

  it("ignores synchronous logger failures and rejected async trace callbacks", async () => {
    const proxy = composeChain([() => NextResponse.next()], {
      debug: "compact",
      logger: {
        debug() {},
        async info() {
          throw new Error("sink failure");
        },
        warn() {},
        error() {},
      },
      onTrace: () => Promise.reject(new Error("trace sink failure")),
    });
    expect(
      (await proxy(new NextRequest("https://example.com/work"), {} as never)).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
  });

  it("records recovered failures and the response the chain ultimately returns", async () => {
    let trace: ChainTrace | undefined;
    const proxy = composeChain(
      [
        defineHandler({
          name: "analytics",
          handler: () => {
            throw new Error("must not leak");
          },
        }),
        () => NextResponse.redirect("https://example.com/login"),
      ],
      {
        debug: false,
        onError: () => NextResponse.next(),
        onTrace: (value) => {
          trace = value;
        },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
    );
    const response = await proxy(new NextRequest("https://example.com/work"), {} as never);
    expect(response.status).toBe(307);
    expect(trace?.outcome.type).toBe("redirect");
    expect(trace?.handlers.map((handler) => handler.outcome)).toEqual(["recovered", "redirect"]);
    expect(JSON.stringify(trace)).not.toContain("must not leak");
    expect(trace?.handlers[0]).toMatchObject({
      outcome: "recovered",
      policy: "chain",
    });
  });

  it("uses a handler error policy before the chain policy", async () => {
    let trace: ChainTrace | undefined;
    let globalRecoveryCalled = false;
    const proxy = composeChain(
      [
        defineHandler({
          name: "analytics",
          handler: () => {
            throw new Error("private error");
          },
          onError: () => NextResponse.next(),
        }),
        () => NextResponse.next(),
      ],
      {
        debug: false,
        onError: () => {
          globalRecoveryCalled = true;
          return new Response(null, { status: 500 });
        },
        onTrace: (value) => {
          trace = value;
        },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
    );
    expect(
      (await proxy(new NextRequest("https://example.com/work"), {} as never)).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
    expect(globalRecoveryCalled).toBe(false);
    expect(trace?.handlers[0]).toMatchObject({
      outcome: "recovered",
      policy: "handler",
    });
    expect(JSON.stringify(trace)).not.toContain("private error");
  });

  it("includes asynchronous error recovery in handler duration", async () => {
    let trace: ChainTrace | undefined;
    const proxy = composeChain(
      [
        () => {
          throw new Error("failure");
        },
      ],
      {
        onError: async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return NextResponse.next();
        },
        onTrace: (value) => {
          trace = value;
        },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
    );
    await proxy(new NextRequest("https://example.com/work"), {} as never);
    const handlerTrace = trace?.handlers[0];
    expect(handlerTrace?.outcome).toBe("recovered");
    if (handlerTrace?.outcome === "recovered") {
      expect(handlerTrace.durationMs).toBeGreaterThanOrEqual(20);
    }
  });

  it("reports timeout without claiming the handler was cancelled", async () => {
    let trace: ChainTrace | undefined;
    const proxy = composeChain(
      [
        defineHandler({
          name: "session",
          timeout: 2,
          handler: () => new Promise<Response>(() => {}),
        }),
      ],
      {
        debug: false,
        onTrace: (value) => {
          trace = value;
        },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
    );
    expect((await proxy(new NextRequest("https://example.com/account"), {} as never)).status).toBe(
      500,
    );
    expect(trace?.outcome.type).toBe("timeout");
    expect(trace?.handlers[0]?.outcome).toBe("timeout");
  });

  it("keeps concurrent request traces isolated and can omit paths", async () => {
    const traces: ChainTrace[] = [];
    const proxy = composeChain(
      [
        (request) =>
          request.nextUrl.pathname === "/one" ? new Response(null, { status: 403 }) : undefined,
      ],
      {
        tracePath: false,
        onTrace: (trace) => {
          traces.push(trace);
        },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
    );
    await Promise.all([
      proxy(new NextRequest("https://example.com/one"), {} as never),
      proxy(new NextRequest("https://example.com/two"), {} as never),
    ]);
    expect(traces).toHaveLength(2);
    expect(traces.map((trace) => trace.pathname)).toEqual([undefined, undefined]);
    expect(new Set(traces.map((trace) => trace.outcome.type))).toEqual(
      new Set(["response", "next"]),
    );
  });

  it("reports the actual redirect when a pending rewrite is superseded", async () => {
    let trace: ChainTrace | undefined;
    const proxy = composeChain(
      [
        () => NextResponse.rewrite("https://example.com/rewritten"),
        () => NextResponse.redirect("https://example.com/login"),
      ],
      {
        onTrace: (value) => {
          trace = value;
        },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
    );
    const response = await proxy(new NextRequest("https://example.com/work"), {} as never);
    expect(response.status).toBe(307);
    expect(trace?.outcome).toEqual({
      type: "redirect",
      status: 307,
      destination: "/login",
    });
    expect(trace?.handlers.map((handler) => handler.outcome)).toEqual(["rewrite", "redirect"]);
  });
});
