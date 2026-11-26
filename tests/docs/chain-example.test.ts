import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import chainExample from "../../examples/08-chain-native";

const event = { waitUntil() {} } as never;

describe("documentation example: chain()", () => {
  it("redirects the root path with a native handler", async () => {
    const res = await chainExample(new NextRequest("http://localhost/"), event);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/en");
  });

  it("sends a dashboard visitor without a user cookie to login", async () => {
    const res = await chainExample(new NextRequest("http://localhost/dashboard/home"), event);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("lets a signed-in visitor through the scoped rule", async () => {
    const req = new NextRequest("http://localhost/dashboard/home", {
      headers: { cookie: "user=ada" },
    });
    const res = await chainExample(req, event);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not apply the dashboard rule outside its scope", async () => {
    const res = await chainExample(new NextRequest("http://localhost/about"), event);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
