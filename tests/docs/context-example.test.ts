import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import contextExample from "../../examples/09-context";

describe("README context example", () => {
  it("uses the incoming request id", async () => {
    const res = await contextExample(
      new NextRequest("http://localhost/", { headers: { "x-request-id": "abc" } }),
      {} as never,
    );
    expect(res.headers.get("x-request-id")).toBe("abc");
  });

  it("generates a request id when none is sent, and does not reuse it across requests", async () => {
    const a = await contextExample(new NextRequest("http://localhost/a"), {} as never);
    const b = await contextExample(new NextRequest("http://localhost/b"), {} as never);
    expect(a.headers.get("x-request-id")).toBeTruthy();
    expect(a.headers.get("x-request-id")).not.toBe(b.headers.get("x-request-id"));
  });
});
