# @klnap/next-proxy-chain

Composable proxy and middleware for Next.js.

Compose security, authentication, redirects, and localization in Next.js's single Proxy or Middleware entrypoint.

```ts
import { chain } from "@klnap/next-proxy-chain";

export default chain([security, authentication, redirects, localization]);
```

## Why?

Next.js discovers one Proxy entrypoint. As request logic grows, teams often split authentication, localization, redirects, security headers, and analytics into separate modules.

Separate files improve organization. The harder part is agreeing what happens when each handler can continue, rewrite, redirect, or return a response—and which request headers, response headers, and cookies reach the final result.

This package composes handlers in order. Handlers keep native `NextRequest`, `NextResponse`, `NextFetchEvent`, and Web `Response` APIs.

## Features

- **Native-first composition:** use existing `(request, event)` handlers without wrappers; `event.waitUntil()` keeps the original event.
- **Ordered execution:** run handlers sequentially; redirects and terminal responses stop later handlers.
- **Conditional handlers:** match path, host, and asynchronous `when` predicates; keep Next.js `config.matcher` as the outer filter.
- **Shared request context:** read generated request metadata and share typed, per-request application state.
- **HTTP composition:** carry native request overrides, response headers, and cookies; continue staged rewrites until a later handler stops.
- **Execution control:** set per-handler deadlines, pass cooperative `AbortSignal`s, and recover from ordinary errors.
- **Diagnostics:** inspect formatted request traces or receive structured traces without a logging dependency.
- **Zero runtime dependencies:** `next` is a peer dependency.

## Installation

**Bun**

```bash
bun add @klnap/next-proxy-chain
```

**npm**

```bash
npm install @klnap/next-proxy-chain
```

## Usage

### Getting started

```ts
import { chain } from "@klnap/next-proxy-chain";
import { NextResponse, type NextRequest } from "next/server";

function securityHeaders() {
  const response = NextResponse.next();
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

function redirectRoot(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/home", request.url));
  }
}

export default chain([securityHeaders, redirectRoot]);

export const config = {
  matcher: ["/:path*"],
};
```

Save this as `proxy.ts` in Next.js 16 or `middleware.ts` in Next.js 15. The matcher is intentionally broad. Narrow it to routes that need the entrypoint. Next.js reads `config.matcher` statically, so keep it a literal in the file.

`securityHeaders` adds a response header. `redirectRoot` can stop the chain with a redirect. The chain keeps the earlier header on that redirect.

| Handler returns                        | Chain behavior                     |
| -------------------------------------- | ---------------------------------- |
| `undefined`                            | Continue to the next handler.      |
| `NextResponse.next()`                  | Compose HTTP effects and continue. |
| Successful `NextResponse.rewrite(url)` | Stage the rewrite and continue.    |
| `NextResponse.redirect(url)`           | Stop and redirect.                 |
| Terminal `Response`                    | Stop and return the response.      |

Both internal and external successful rewrites are staged while the chain continues. Later path scopes and predicates see the rewritten pathname and query. A rewrite does not change the host used for matching; scopes use the effective `host` or `x-forwarded-host` request header. A prior native header replacement of either value changes later host matching. Original request metadata stays unchanged. A later redirect or terminal response replaces the staged rewrite. Only `NextResponse` routing responses are interpreted; a plain `Response` stays terminal.

### Conditional handlers

Configured handlers require a non-empty `name` and a `handle` function. `include` runs a handler when any included scope matches. Any matching `exclude` scope takes precedence. Scope alternatives use OR; `host` and `path` within one scope use AND. `when` runs after scope matching and may return a boolean or a promise.

```ts
import { chain } from "@klnap/next-proxy-chain";
import { NextResponse } from "next/server";
import { security, localization } from "@/lib/proxy/handlers";

export default chain([
  security,
  {
    name: "preview",
    rules: {
      include: "/docs/**",
      when: (request) => request.nextUrl.searchParams.has("preview"),
    },
    handle: () => {
      const response = NextResponse.next();
      response.headers.set("cache-control", "no-store");
      return response;
    },
  },
  localization,
]);
```

Path patterns support `*` for one segment and `**` for zero or more segments. `/docs/**` includes `/docs`. `config.matcher` decides whether Next.js invokes the entrypoint; handler rules only filter configured handlers after invocation.

For example, this application-owned handler matches either billing path on the billing host, except the health route:

```ts
{
  name: "billing",
  rules: {
    include: {
      host: "billing.example.com",
      path: ["/billing/**", "/invoices/**"],
    },
    exclude: "/billing/health",
  },
  handle: billing,
}
```

Matching controls routing, not authorization. Verify permissions in application-owned code, including at the data-access boundary.

### Reusable handlers

`defineHandler()` accepts the same configuration as an inline entry. Moving the object into `defineHandler()` does not change its options or implementation.

```ts
import { defineHandler } from "@klnap/next-proxy-chain";
import { NextResponse } from "next/server";

export const preview = defineHandler({
  name: "preview",
  rules: {
    include: "/docs/**",
    when: (request) => request.nextUrl.searchParams.has("preview"),
  },
  handle: () => {
    const response = NextResponse.next();
    response.headers.set("cache-control", "no-store");
    return response;
  },
});
```

Compose it like any other handler:

```ts
import { chain } from "@klnap/next-proxy-chain";
import { security, localization } from "@/lib/proxy/handlers";
import { preview } from "@/lib/proxy/preview";

export default chain([security, preview, localization]);
```

Inline and reusable configurations share the same `HandlerConfig` type and runtime behavior. `defineHandler()` validates and returns the configuration unchanged; `handle` remains the executable property in both forms.

### Request context

The chain creates request metadata and a cancellation signal:

```ts
import { chain } from "@klnap/next-proxy-chain";

export default chain([
  {
    name: "request-logger",
    handle: (_request, _event, context) => {
      console.info({
        requestId: context.requestId,
        pathname: context.originalPathname,
        elapsedMs: context.elapsedMs,
      });
    },
  },
]);
```

| Property           | Type          | Description                                          |
| ------------------ | ------------- | ---------------------------------------------------- |
| `requestId`        | `string`      | Generated request identifier with the `req_` prefix. |
| `startedAt`        | `number`      | Unix timestamp in milliseconds.                      |
| `elapsedMs`        | `number`      | Monotonic elapsed time.                              |
| `originalUrl`      | `string`      | Original request URL.                                |
| `originalPathname` | `string`      | Original request pathname.                           |
| `originalHostname` | `string`      | Original request hostname.                           |
| `signal`           | `AbortSignal` | Execution-scoped cancellation signal.                |

Built-in metadata is read-only. Each chain invocation gets a new request ID. Application context is isolated per request and shared between that request's handlers. Custom properties are optional until a handler sets them, so a reader that runs first can observe `undefined`. A matching predicate and its handler share the same execution-scope signal.

```ts
import { chain } from "@klnap/next-proxy-chain";
import { NextResponse } from "next/server";

type AppContext = {
  isPreview: boolean;
};

export default chain<AppContext>([
  {
    name: "detect-preview",
    handle: (request, _event, context) => {
      context.isPreview = request.nextUrl.searchParams.has("preview");
    },
  },
  {
    name: "preview-headers",
    handle: (_request, _event, context) => {
      if (!context.isPreview) return;
      const response = NextResponse.next();
      response.headers.set("cache-control", "no-store");
      return response;
    },
  },
]);
```

Context is not forwarded downstream automatically. To make a request ID visible to route handlers, use Next.js's native request-header forwarding:

```ts
import { chain } from "@klnap/next-proxy-chain";
import { NextResponse } from "next/server";

export default chain([
  {
    name: "request-id",
    handle: (request, _event, context) => {
      const headers = new Headers(request.headers);
      headers.set("x-request-id", context.requestId);
      return NextResponse.next({
        request: { headers },
      });
    },
  },
]);
```

`NextResponse.next({ request: { headers } })` replaces the forwarded request-header set. Cloning `request.headers` preserves existing headers; omitted headers are removed downstream. This changes downstream request headers, not client-facing response headers. Validate client-controlled values and avoid forwarding sensitive headers without a reason. See [Security](docs/security.md#request-headers).

### Timeouts and error recovery

The chain-level `timeout` sets a deadline in milliseconds for each handler execution. Its default is `0`, which disables timeouts. A handler-level `timeout` overrides the chain default; handler value `0` disables that handler's deadline. The `when` predicate and `handle` share the same deadline.

```ts
import { chain } from "@klnap/next-proxy-chain";

import { loadRequestSettings } from "@/lib/proxy/settings";

export default chain(
  [
    {
      name: "request-settings",
      rules: { include: "/dashboard/**" },
      timeout: 500,
      handle: async (_request, _event, context) => {
        const settings = await loadRequestSettings({ signal: context.signal });
        if (settings.maintenanceMode) {
          return new Response("Service unavailable", { status: 503 });
        }
      },
    },
  ],
  {
    onError: () => new Response("Service unavailable", { status: 503 }),
  },
);
```

Pass `context.signal` to work that supports cooperative cancellation. A timeout or request cancellation stops the chain from waiting, but cannot stop synchronous JavaScript or work that ignores its signal. `event.waitUntil()` work is outside the handler timeout.

For ordinary errors, handler-level `onError` takes precedence over chain-level `onError`. Returning `NextResponse.next()` continues after the failed handler. A terminal `Response` stops the chain.

Timeout and request-cancellation recovery accepts only a terminal Web `Response`. Without recovery, a timeout returns `500`. Cancellation stops this chain and returns a native `NextResponse.next()` handoff. Next.js may continue downstream routing, so cancellation is not a fail-closed response.

### Debugging and observability

Debugging defaults to `false`. Set `debug: true` as an alias for `"detailed"`, or choose a mode:

| Mode       | Output                                |
| ---------- | ------------------------------------- |
| `compact`  | Single-line request summary.          |
| `detailed` | Request summary and handler outcomes. |
| `verbose`  | Matching and execution details.       |

These examples show a continuing security handler, a skipped authentication handler, and a staged localization rewrite. Request IDs and durations vary:

```text
[proxy-chain] req_d14c6cf2-962a-400a-8b7f-6e3c45545fc5 · GET /products · REWRITE /pl/products · 4.34ms · 3/3 handlers
```

```text
[proxy-chain] GET /products
  Request: req_63491ecd-a382-4cd4-9a88-b1e8575a33c5
│ ✓ security         continue       0.15ms
│ ○ authentication   skipped
│ ↪ localization     rewrite        0.13ms
└ REWRITE /pl/products
  Total: 0.80ms
```

The compact `reached/total` count includes skipped handlers. Handlers after a terminal outcome count only in the total. See the [diagnostics guide](docs/guides.md#diagnostics) for verbose output.

Use `onTrace` for structured diagnostics independently of formatted logging:

```ts
import { chain } from "@klnap/next-proxy-chain";

export default chain(handlers, {
  debug: "detailed",
  onTrace: (trace) => {
    console.info({
      requestId: trace.requestId,
      outcome: trace.outcome.type,
      handlers: trace.handlers,
    });
  },
});
```

Formatted and structured traces omit header values, cookie values, raw query values, request bodies, application context values, and raw errors.

`tracePath: false` omits only the original request pathname from the top-level trace and formatted request line. Handler scope patterns and sanitized rewrite or redirect destination paths remain visible. Destination query values appear as `?[query]`.

## Configuration

`chain(entries, options?)` accepts native handlers and configured handler objects. Handler-level options are `rules`, `timeout`, `debug`, and `onError`.

| Chain option          | Default                 | Description                                                                                     |
| --------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `timeout`             | `0`                     | Per-handler deadline in milliseconds; `0` disables it. Handler values override the chain value. |
| `debug`               | `false`                 | Formatted diagnostics. `true` means `"detailed"`; handlers can override the chain level.        |
| `onError`             | None                    | Recovery for ordinary handler errors; handler-level recovery takes precedence.                  |
| `onTrace`             | None                    | Callback for structured request traces.                                                         |
| `tracePath`           | `true`                  | Include the original pathname in diagnostics.                                                   |
| `logger`              | Console logger (`info`) | Logger with `debug`, `info`, `warn`, and `error` methods.                                       |
| `headerMergeStrategy` | `"last-write-wins"`     | Resolve conflicts between response headers from continued handlers.                             |
| `cookieMergeStrategy` | `"last-write-wins"`     | Resolve conflicts between cookie identities from continued handlers.                            |
| `strictOverrideCheck` | `false`                 | Throw at chain creation if native request-header override support cannot be verified.           |

`onTrace`, `tracePath`, `logger`, merge strategies, and `strictOverrideCheck` are chain-level only. See the [API reference](docs/api.md#chain-options) for types and precedence.

## Compatibility

The package declares `next >=15.0.0` as a peer dependency and Node.js `>=20.0.0`. It provides ESM and CommonJS entrypoints with TypeScript declarations.

Packed consumer builds and live requests were verified with Next.js 15.5.29 and 16.3.2 on Node.js 26.13.1. This does not verify every version in the peer range. Next.js 15 Edge deployments have not been independently verified.

## Documentation

- [Concepts](docs/concepts.md) — execution model, matching, rewrites, HTTP composition, and context.
- [Guides](docs/guides.md) — practical integration examples, request IDs, cancellation, and diagnostics.
- [API reference](docs/api.md) — public exports, configuration, types, defaults, and precedence.
- [Security](docs/security.md) — trust boundaries, limitations, and safe integration.

### AI coding agents

The package tarball includes version-matched consumer documentation and public declarations. Read [`llms.txt`](llms.txt) from the installed package at `node_modules/@klnap/next-proxy-chain/`.

```text
Before integrating @klnap/next-proxy-chain, read the
installed package's llms.txt, README.md, relevant
documentation, and public TypeScript declarations.

Use the installed package's API as the source of truth.
```

## License

[MIT](LICENSE)
