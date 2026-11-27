import { describe, expect, it } from "bun:test";
import {
  createApplicationState,
  createHandlerContext,
  createRequestMetadata,
} from "../../src/core/context";
import { NextRequest, NextResponse } from "next/server";

describe("Context primitives", () => {
  it("encodes native request header replacements on NextResponse.next()", () => {
    const continuation = NextResponse.next({
      request: { headers: new Headers({ "x-user": "test" }) },
    });

    expect(continuation.headers.get("x-middleware-next")).toBe("1");
    expect(continuation.headers.get("x-middleware-request-x-user")).toBe("test");
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
