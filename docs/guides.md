# Guides

## Native matcher configuration

Keep the Next.js matcher at the entrypoint. Use `rules` to scope one handler:

```ts
export const config = { matcher: ["/api/:path*"] };

export default chain([
  {
    name: "api-auth",
    rules: {
      include: "/api/**",
      exclude: "/api/public/**",
      when: async (request) => request.headers.has("authorization"),
    },
    handle: (request) => verifyApiRequest(request),
  },
]);
```

Path strings support `*` for one segment and `**` for zero or more segments. Scope objects can combine `host` and `path`.

## Add, update, and remove request headers

Next.js treats the supplied `Headers` as a replacement set. Clone the effective request headers to preserve existing values:

```ts
import { NextResponse } from "next/server";

{
  name: "request-metadata",
  handle: (request) => {
    const headers = new Headers(request.headers);
    headers.set("x-user-tier", "free");
    headers.set("x-request-source", "proxy");
    headers.delete("x-untrusted-client-value");
    return NextResponse.next({ request: { headers } });
  },
}
```

To deliberately replace the entire set, create a new `Headers` instance and add only the values to forward. Headers omitted from that set are removed downstream. A later handler sees the effective result and can clone it before making another change.

## Forward a request ID

The chain generates `context.requestId`, but does not forward it automatically:

```ts
import { NextResponse } from "next/server";

{
  name: "request-id",
  handle: (request, _event, context) => {
    const headers = new Headers(request.headers);
    headers.set("x-request-id", context.requestId);
    return NextResponse.next({ request: { headers } });
  },
}
```

This changes request headers seen by downstream handlers and route code. It does not set a client-facing response header.

## Set response headers and cookies

Use the native response object:

```ts
import { NextResponse } from "next/server";

{
  name: "security",
  handle: () => {
    const response = NextResponse.next();
    response.headers.set("x-content-type-options", "nosniff");
    response.cookies.set("locale", "en");
    return response;
  },
}
```

Response headers and cookies are composed across continued handlers. Last write wins by default.

## Rewrite and continue

A successful rewrite is staged. Later handlers receive the rewritten pathname, while `context.originalPathname` retains the original value:

```ts
import { NextResponse } from "next/server";

{
  name: "localized-route",
  rules: { include: "/**" },
  handle: (request) => {
    if (request.nextUrl.pathname.startsWith("/pl/")) return;
    return NextResponse.rewrite(new URL(`/pl${request.nextUrl.pathname}`, request.url));
  },
}
```

Internal and external destinations use Next.js's `NextResponse.rewrite()` API. A later redirect or terminal response stops the chain.

## Redirect

```ts
import { NextResponse } from "next/server";

{
  name: "canonical-host",
  handle: (request) => {
    if (request.nextUrl.hostname !== "www.example.com") {
      return NextResponse.redirect(new URL(request.url.replace("://", "://www."), request.url));
    }
  },
}
```

Redirects are terminal. Earlier composed response headers and cookies remain on the outgoing response.

## Share typed context

```ts
type RequestState = { locale?: "en" | "pl" };

export default chain<RequestState>([
  {
    name: "detect-locale",
    handle: (request, _event, context) => {
      context.locale = request.headers.get("accept-language")?.startsWith("pl") ? "pl" : "en";
    },
  },
  {
    name: "locale-header",
    handle: (_request, _event, context) => {
      if (!context.locale) return;
      const response = NextResponse.next();
      response.headers.set("content-language", context.locale);
      return response;
    },
  },
]);
```

Custom context properties may be undefined until initialized. The chain isolates custom state between requests.

## Timeout and cancellation

```ts
{
  name: "remote-settings",
  timeout: 500,
  handle: async (_request, _event, context) => {
    return fetchSettings({ signal: context.signal });
  },
}
```

The handler and its `when` predicate share one timeout. Pass `context.signal` into supported APIs. Timeout stops later handlers; ignored work may continue if it does not honor cancellation.

## Error recovery

For ordinary failures, return native `NextResponse.next()` to continue:

```ts
{
  name: "optional-profile",
  onError: () => NextResponse.next(),
  handle: async () => loadOptionalProfile(),
}
```

For timeout and request cancellation, recovery must return a terminal Web `Response`:

```ts
{
  name: "critical-profile",
  onError: () => new Response("Service unavailable", { status: 503 }),
  timeout: 500,
  handle: async (_request, _event, context) => loadProfile({ signal: context.signal }),
}
```

Handler-level `onError` takes precedence over chain-level `onError`. An absent recovery response fails closed.

## Diagnostics

Enable readable traces with `debug`:

```ts
export default chain(handlers, { debug: "detailed" });
```

Set `debug: "compact"` for a short trace. Compact `reached/total` counts include skipped handlers as reached outcomes, but skipped handlers did not execute their `handle` callback. Handlers after a terminal outcome count only in total.

Use `onTrace` for structured data:

```ts
export default chain(handlers, {
  onTrace: (trace) => {
    console.info({
      requestId: trace.requestId,
      outcome: trace.outcome.type,
      handlers: trace.handlers,
    });
  },
});
```

`tracePath: false` omits only the original request pathname from the top-level trace and formatted request line. It does not hide paths in scope details or sanitized rewrite and redirect destinations; destination query values appear as `?[query]`. Formatted traces and structured traces omit request and response header values, cookie values, raw query values, request bodies, application context values, and raw errors. Display formatting sanitizes and truncates handler names and destinations.
