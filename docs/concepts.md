# Concepts

`chain()` composes native handlers. `defineHandler()` defines a reusable configured handler. `handle` contains the handler's native Next.js logic; Next.js owns HTTP responses.

```ts
import { chain } from "@klnap/next-proxy-chain";
import { NextResponse } from "next/server";

export default chain([
  (request, event) => {
    event.waitUntil(writeAuditLog(request));
    if (request.nextUrl.pathname === "/") {
      return NextResponse.redirect(new URL("/home", request.url));
    }
  },
  {
    name: "security",
    handle: () => {
      const response = NextResponse.next();
      response.headers.set("x-content-type-options", "nosniff");
      return response;
    },
  },
]);
```

## Execution

Handlers execute in order. A `NextResponse.next()` or `undefined` continues. A successful `NextResponse.rewrite()` stages a rewrite and continues. A redirect or terminal `Response` stops the chain. If every handler continues, the chain returns a pass-through response or the final staged rewrite.

The original request object is not mutated. When a continued rewrite or native request-header override changes request state, later handlers receive a reconstructed `NextRequest`. Original URL, path, and hostname remain in chain context.

## Matching

Next.js `config.matcher` is the outer filter. It decides whether Middleware or Proxy runs at all.

Configured-handler `rules.include` and `rules.exclude` are inner filters. They accept paths, host/path objects, strings, and regular expressions. Exclusions take precedence. The optional async `when(request, event, context)` predicate runs after scope matching.

```ts
{
  name: "admin-auth",
  rules: {
    include: { host: "admin.example.com", path: "/admin/**" },
    exclude: "/admin/login",
  },
  handle: (request) => {
    if (!hasSession(request)) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  },
}
```

Later matching uses the effective request, including prior rewrite paths and request-header replacements. Rewrites do not change the host used for matching; host scopes read the effective `host` header, falling back to `x-forwarded-host`. A prior header replacement of either value affects later host matching.

## Native HTTP composition

The chain does not wrap responses in another API. Handlers return `NextResponse` or Web `Response` directly.

| Handler returns              | Effect                                                 |
| ---------------------------- | ------------------------------------------------------ |
| `undefined`                  | Continue without adding HTTP effects.                  |
| `NextResponse.next()`        | Continue and compose its response headers and cookies. |
| `NextResponse.rewrite(url)`  | Stage the rewrite; continue through later handlers.    |
| `NextResponse.redirect(url)` | Stop and redirect.                                     |
| Terminal `Response`          | Stop and return it.                                    |

Request headers passed in `NextResponse.next({ request: { headers } })` replace the forwarded request-header set. Clone `request.headers` to preserve existing values. The engine decodes Next.js's internal override metadata so later handlers see the same effective headers. Request headers do not become response headers.

Response headers and cookies from continuing handlers are collected and merged into the final response. The defaults use last-write-wins. Cookies with different name/domain/path identities remain distinct.

## Context

The chain creates request-scoped metadata and an execution-scoped `AbortSignal`. `requestId`, `startedAt`, `elapsedMs`, `originalUrl`, `originalPathname`, and `originalHostname` describe the original request. Custom typed state is shared between handlers in one request and isolated across requests.

Custom state fields may be `undefined` before initialization. They are not forwarded to route handlers unless a handler explicitly encodes them into request headers.

## Errors and timeouts

The handler's `timeout` and `when` predicate share a deadline. Timeout or request cancellation aborts the execution signal and stops the pipeline from waiting; ignored work can continue. A cooperative handler should pass `context.signal` to cancellable work.

For ordinary errors, handler-level `onError` wins over chain-level `onError`. `NextResponse.next()` and a successful `NextResponse.rewrite()` continue after that failed handler; any other `Response` terminates. Timeouts, request cancellation, and engine-level failures cannot resume the chain. They accept only a terminal Web `Response` as recovery; a continuing or rewriting recovery is rejected.

## Diagnostics

Formatted diagnostics include one outcome per handler. Compact `reached/total` counts include skipped outcomes, because their scope or predicate was evaluated; handlers after a terminal response count only in `total`.

`onTrace` receives structured data with request ID, outcome, timing, and handler details. `tracePath: false` omits the original request pathname from the top-level trace and formatted request line; scope details and sanitized rewrite or redirect destination paths remain visible. Destination query values are replaced with `?[query]`. The formatter sanitizes and truncates displayed names and destinations.
