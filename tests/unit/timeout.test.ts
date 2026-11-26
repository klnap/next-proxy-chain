import { describe, expect, it } from "bun:test";
import type { NextFetchEvent } from "next/server";
import { NextRequest } from "next/server";
import { assertValidTimeout, RuleTimeoutError, runInExecutionScope } from "../../src/core/timeout";
import { chain as composeChain, defineHandler, next } from "../../src/index";

describe("Timeout Enforcement", () => {
  it("resolves quickly when execution is within budget", async () => {
    const result = await runInExecutionScope(
      new AbortController().signal,
      100,
      "fastRule",
      () => "fast-result",
    );
    expect(result).toBe("fast-result");
  });

  it("rejects with RuleTimeoutError when operation exceeds timeout budget", async () => {
    let signal: AbortSignal | undefined;
    await expect(
      runInExecutionScope(new AbortController().signal, 10, "slowRule", (scopeSignal) => {
        signal = scopeSignal;
        return new Promise((resolve) => setTimeout(resolve, 50));
      }),
    ).rejects.toThrow(RuleTimeoutError);
    expect(signal?.aborted).toBe(true);
  });

  it("passes through without timeout when timeoutMs is zero", async () => {
    const result = await runInExecutionScope(
      new AbortController().signal,
      0,
      "unlimitedRule",
      () => "unlimited",
    );
    expect(result).toBe("unlimited");
  });

  it("classifies synchronous work that exceeds its deadline as a timeout", async () => {
    let signal: AbortSignal | undefined;
    await expect(
      runInExecutionScope(new AbortController().signal, 2, "syncRule", (scopeSignal) => {
        signal = scopeSignal;
        const until = performance.now() + 8;
        while (performance.now() < until) {
          // Keep the event loop busy to prove elapsed-time enforcement catches delayed timers.
        }
        throw new Error("late synchronous failure");
      }),
    ).rejects.toThrow(RuleTimeoutError);
    expect(signal?.aborted).toBe(true);
  });

  it("throws RangeError synchronously for non-finite timeoutMs", () => {
    for (const timeout of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      1.5,
      2_147_483_648,
    ]) {
      expect(() => assertValidTimeout(timeout)).toThrow(RangeError);
    }
    expect(() => assertValidTimeout(0)).not.toThrow();
    expect(() => assertValidTimeout(2_147_483_647)).not.toThrow();
  });
});

describe("Timeout through chain", () => {
  const fakeEvent = {} as NextFetchEvent;
  const silentLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  it("throws RangeError synchronously when timeout is invalid", () => {
    expect(() => composeChain([], { timeout: Number.NaN })).toThrow(RangeError);
    expect(() => composeChain([], { timeout: -1 })).toThrow(RangeError);
    expect(() => defineHandler({ timeout: 1.5, handler: () => undefined })).toThrow(RangeError);
  });

  it("returns 500 when a rule exceeds timeout", async () => {
    const slow = defineHandler({
      name: "slow",
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return undefined;
      },
    });
    const chain = composeChain([slow], { timeout: 15, logger: silentLogger });
    const res = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    expect(res.status).toBe(500);
  });

  it("does not start a handler when its synchronous predicate exceeds the timeout", async () => {
    let handlerRan = false;
    const slowPredicate = defineHandler({
      name: "slow-predicate",
      rules: {
        when: () => {
          const until = performance.now() + 10;
          while (performance.now() < until) {
            // Keep the event loop busy to prove the handler cannot start after its deadline.
          }
          return true;
        },
      },
      handler: () => {
        handlerRan = true;
      },
    });
    const chain = composeChain([slowPredicate], { timeout: 1, logger: silentLogger });
    const response = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    expect(response.status).toBe(500);
    expect(handlerRan).toBe(false);
  });

  it("does not start a handler when an async predicate resolves after timeout", async () => {
    let resolvePredicate!: (matches: boolean) => void;
    let handlerRan = false;
    const slowPredicate = defineHandler({
      name: "late-predicate",
      rules: {
        when: () =>
          new Promise<boolean>((resolve) => {
            resolvePredicate = resolve;
          }),
      },
      handler: () => {
        handlerRan = true;
      },
    });
    const chain = composeChain([slowPredicate], { timeout: 2, logger: silentLogger });
    const response = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    expect(response.status).toBe(500);
    resolvePredicate(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handlerRan).toBe(false);
  });

  it("does not surface an unhandled rejection after timeout", async () => {
    const late = defineHandler({
      name: "late",
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        throw new Error("late rejection");
      },
    });
    const chain = composeChain([late], { timeout: 10, logger: silentLogger });
    const res = await chain(new NextRequest("http://localhost:3000/"), fakeEvent);
    expect(res.status).toBe(500);
    await new Promise((resolve) => setTimeout(resolve, 80));
  });

  it("accepts only terminal responses from timeout recovery", async () => {
    let trace:
      | {
          outcome: { type: string; status?: number; timeoutMs?: number };
          handlers: readonly { outcome: string; recovery?: string }[];
        }
      | undefined;
    const timeoutResponse = defineHandler({
      name: "timeout-response",
      timeout: 2,
      handler: () => new Promise<Response>(() => {}),
    });
    const recovered = composeChain([timeoutResponse], {
      logger: silentLogger,
      onError: (error) => {
        expect(error).toBeInstanceOf(RuleTimeoutError);
        return new Response("recovered", { status: 503 });
      },
      onTrace: (value) => {
        trace = value;
      },
    });
    const response = await recovered(new NextRequest("http://localhost/"), fakeEvent);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("recovered");
    expect(trace?.outcome).toMatchObject({ type: "timeout", status: 503 });
    expect(trace?.handlers[0]).toMatchObject({ outcome: "timeout", recovery: "response" });

    const timeoutContinuation = defineHandler({
      timeout: 2,
      handler: () => new Promise<Response>(() => {}),
    });
    const rejectedContinuation = composeChain([timeoutContinuation], {
      logger: silentLogger,
      onError: () => next(),
    });
    expect(
      (await rejectedContinuation(new NextRequest("http://localhost/"), fakeEvent)).status,
    ).toBe(500);
  });

  it("classifies native request cancellation separately and starts no later handler", async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    let laterRan = false;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const blocking = defineHandler({
      handler: async (_request, _event, context) => {
        signal = context.signal;
        markEntered();
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    });
    const later = defineHandler({
      handler: () => {
        laterRan = true;
      },
    });
    const proxy = composeChain([blocking, later], { logger: silentLogger });
    const request = new NextRequest("http://localhost/", { signal: controller.signal });
    const pending = proxy(request, fakeEvent);
    await entered;
    controller.abort();
    const response = await pending;
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(signal?.aborted).toBe(true);
    expect(laterRan).toBe(false);
  });

  it("runs cancellation recovery for an already-aborted request without starting handlers", async () => {
    const controller = new AbortController();
    controller.abort();
    let handlerRan = false;
    let recoverySignal: AbortSignal | undefined;
    let trace:
      | {
          outcome: { type: string };
          handlers: readonly { outcome: string; phase?: string }[];
        }
      | undefined;
    const handler = defineHandler({
      handler: () => {
        handlerRan = true;
      },
    });
    const proxy = composeChain([handler], {
      logger: silentLogger,
      onError: (_error, index, _request, context) => {
        expect(index).toBe(0);
        recoverySignal = context.signal;
        return new Response("cancelled", { status: 499 });
      },
      onTrace: (value) => {
        trace = value;
      },
    });
    const response = await proxy(
      new NextRequest("http://localhost/", { signal: controller.signal }),
      fakeEvent,
    );
    expect(response.status).toBe(499);
    expect(handlerRan).toBe(false);
    expect(recoverySignal?.aborted).toBe(true);
    expect(trace?.outcome.type).toBe("request-cancelled");
    expect(trace?.handlers[0]).toMatchObject({
      outcome: "request-cancelled",
      phase: "before-handler",
      recovery: "response",
    });
  });

  it("treats ordinary AbortError exceptions as handler failures, not request cancellation", async () => {
    const handler = defineHandler({
      handler: () => {
        throw new DOMException("operation aborted", "AbortError");
      },
    });
    const proxy = composeChain([handler], {
      logger: silentLogger,
      onError: () => new Response("recovered", { status: 503 }),
    });
    expect((await proxy(new NextRequest("http://localhost/"), fakeEvent)).status).toBe(503);
  });
});
