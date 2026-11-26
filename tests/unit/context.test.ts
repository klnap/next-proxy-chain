import { describe, expect, it } from "bun:test";
import { isNextResult, next } from "../../src/index";
import {
  createApplicationState,
  createHandlerContext,
  createRequestMetadata,
} from "../../src/core/context";
import { NextRequest } from "next/server";

describe("Context and Action Primitives", () => {
  it("produces branded next continuation tokens", () => {
    const continuation = next({
      request: { "x-user": "test" },
      headers: { "x-res": "value" },
    });

    expect(isNextResult(continuation)).toBe(true);
    expect(continuation.request).toEqual({ "x-user": "test" });
    expect(continuation.headers).toEqual({ "x-res": "value" });
  });

  it("distinguishes next continuation tokens from regular responses and nulls", () => {
    expect(isNextResult(new Response())).toBe(false);
    expect(isNextResult(null)).toBe(false);
    expect(isNextResult(undefined)).toBe(false);
    expect(isNextResult({})).toBe(false);
  });

  it("keeps defined application properties consistent across context views", () => {
    const request = new NextRequest("http://localhost/");
    const metadata = createRequestMetadata(request, "req_test", Date.now(), performance.now());
    const state = createApplicationState();
    const first = createHandlerContext<{ item?: number }>(
      metadata,
      state,
      new AbortController().signal,
    );
    const second = createHandlerContext<{ item?: number }>(
      metadata,
      state,
      new AbortController().signal,
    );

    expect(() =>
      Object.defineProperty(first, "item", { value: 1, enumerable: true }),
    ).not.toThrow();
    expect(first.item).toBe(1);
    expect(Object.keys(first)).toContain("item");
    expect(Object.keys(first)).toContain("requestId");
    expect(Object.getOwnPropertyDescriptor(first, "item")).toMatchObject({
      value: 1,
      configurable: true,
    });
    expect(second.item).toBe(1);

    Object.defineProperty(first, "item", { value: 2, writable: true });
    expect(second.item).toBe(2);
    expect(Reflect.deleteProperty(first, "item")).toBe(true);
    expect(second.item).toBeUndefined();
    expect(Object.keys(second)).not.toContain("item");
    expect(() => Object.defineProperty(first, "requestId", { value: "req_other" })).toThrow();
  });
});
