import assert from "node:assert/strict";
import * as api from "@klnap/next-proxy-chain";
import { NextRequest } from "next/server";

assert.deepEqual(Object.keys(api).sort(), [
  "RuleTimeoutError",
  "chain",
  "createProxyContext",
  "defineHandler",
  "host",
  "isNextResult",
  "next",
  "path",
]);
assert.equal(api.isNextResult(api.next()), true);
assert.equal("defineProxy" in api, false);
assert.equal("proxyChain" in api, false);

const proxy = api.chain([
  api.defineHandler({
    name: "release-check",
    handler: (request) =>
      request.nextUrl.pathname === "/release-check"
        ? api.next({ headers: { "x-package-check": "next" } })
        : new Response("unexpected route", { status: 500 }),
  }),
]);
const response = await proxy(new NextRequest("https://example.com/release-check"), {
  waitUntil() {},
});

assert.equal(response.headers.get("x-middleware-next"), "1");
assert.equal(response.headers.get("x-package-check"), "next");
