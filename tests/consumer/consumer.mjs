import assert from "node:assert/strict";
import * as api from "@klnap/next-proxy-chain";
import { NextRequest, NextResponse } from "next/server.js";

assert.deepEqual(Object.keys(api).sort(), ["chain", "defineHandler"]);
assert.equal("defineProxy" in api, false);
assert.equal("proxyChain" in api, false);

const proxy = api.chain([
  api.defineHandler({
    name: "release-check",
    handle: (request) => {
      if (request.nextUrl.pathname !== "/release-check") {
        return new Response("unexpected route", { status: 500 });
      }
      const response = NextResponse.next();
      response.headers.set("x-package-check", "native");
      return response;
    },
  }),
]);
const response = await proxy(new NextRequest("https://example.com/release-check"), {
  waitUntil() {},
});

assert.equal(response.headers.get("x-middleware-next"), "1");
assert.equal(response.headers.get("x-package-check"), "native");

let requestId;
let signal;
const contextProxy = api.chain([
  api.defineHandler({
    name: "request-context",
    handle: (_request, _event, context) => {
      requestId = context.requestId;
      signal = context.signal;
      const response = NextResponse.next();
      response.headers.set("x-package-request-id", context.requestId);
      response.headers.set("x-original-path", context.originalPathname);
      return response;
    },
  }),
]);
const contextResponse = await contextProxy(
  new NextRequest("https://example.com/context?private=1", {
    headers: { "x-request-id": "client-value" },
  }),
  { waitUntil() {} },
);
assert.match(requestId, /^req_[0-9a-f-]{36}$/i);
assert.equal(contextResponse.headers.get("x-package-request-id"), requestId);
assert.equal(contextResponse.headers.get("x-original-path"), "/context");
assert.equal(contextResponse.headers.get("x-request-id"), null);
assert.equal(signal.aborted, false);

const controller = new AbortController();
const originalRequest = new NextRequest("https://example.com/reconstructed", {
  signal: controller.signal,
});
const reconstructedRequest = new NextRequest(originalRequest, {
  headers: new Headers(originalRequest.headers),
});
controller.abort();
assert.equal(reconstructedRequest.signal.aborted, true);
