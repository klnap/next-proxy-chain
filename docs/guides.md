# Guides

Each recipe is short and links to a runnable file in [`examples/`](../examples/). Read [Concepts](concepts.md) first if you have not yet.

## Protect a set of routes

Scope the rule with `include`. Use `**` so that every route below the prefix is covered.

```ts
import { chain, defineHandler, next, path } from "@klnap/next-proxy-chain";

const requireApiKey = defineHandler({
  name: "api-key",
  rules: { include: path("/api/**") },
  handler: (request) => {
    if (!request.headers.get("x-api-key")) return new Response("Unauthorized", { status: 401 });
    return next();
  },
});

export default chain([requireApiKey]);
```

`/api/**` covers `/api`, `/api/users`, and `/api/users/123`. A pattern such as `/api/*` covers only one segment.

Check the credential itself in your own code before you rely on it. See [Security: Authentication](security.md#authentication). [examples/02](../examples/02-scoped-rules.ts) has a fuller version with an exclusion.

## Exclude public paths

Add `exclude` next to `include`. `exclude` wins when both match.

```ts
export default chain([
  [requireApiKey, { include: path("/api/**"), exclude: path("/api/public/**") }],
]);
```

Make sure the excluded paths are truly public. Anything the exclusion matches skips every check on that rule.

## Limit a rule to one host

```ts
const adminOnly = defineHandler({
  name: "admin",
  rules: { include: { host: "admin.example.com", path: "/settings/**" } },
  handler: () => new Response("Forbidden", { status: 403 }),
});

export default chain([adminOnly]);
```

Host matching uses the `host` header. Treat it as routing, not as access control. See [Security: Host matching](security.md#host-matching).

## Add security headers to every response

Put the rule first, so it also runs before any redirect.

```ts
const securityHeaders = defineHandler({
  name: "security-headers",
  handler: () =>
    next({
      headers: {
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
      },
    }),
});

export default chain([securityHeaders, [requireSession, { include: path("/dashboard/**") }]]);
```

[examples/01](../examples/01-quick-start.ts) shows the complete file.

## Share typed state between rules

Pass an application context type to `chain`. Its properties are optional until set and isolated per request. Request identity and original URL metadata are built in.

```ts
type RequestState = { locale?: string };

const detectLocale = defineHandler<RequestState>({
  name: "detect-locale",
  handler: (request, _event, context) => {
    context.locale = request.headers.get("accept-language")?.startsWith("pl") ? "pl" : "en";
    return next();
  },
});

export default chain<RequestState>([detectLocale]);
```

Use `context.requestId` for logs or forward it explicitly with `next({ request })`. Incoming request-ID headers do not change the generated ID. Route handlers cannot read context directly. [examples/03](../examples/03-typed-context.ts) has the complete file.

## Pass a value to route handlers

Use `next({ request })`. The handler reads it with `headers()` or `request.headers`.

```ts
next({ request: { "x-user-tier": "free" } });
```

Headers you pass this way go through `requestHeaderPolicy`. By default, `cookie` and `authorization` cannot be set this way. [examples/04](../examples/04-request-and-response-headers.ts) shows which names are dropped.

## Set a response header for the browser

Use `headers`. This is what the browser receives.

```ts
next({ headers: { "cache-control": "no-store" } });
```

Request headers and response headers are separate channels. Setting one does not set the other.

Keep proxy response headers to safe values such as `cache-control` and security headers. Next.js advises against setting `Content-Type` from the proxy, because it can break Server Actions and streaming. See [the API notes](api.md#next).

## Redirect old URLs

Return `NextResponse.redirect`. The chain stops, so rules after it do not run.

```ts
const legacyRedirect = defineHandler({
  name: "legacy-redirect",
  handler: (request) => {
    if (request.nextUrl.pathname === "/old") {
      return NextResponse.redirect(new URL("/new", request.url), 308);
    }
    return next();
  },
});
```

## Rewrite a path and keep going

Return `NextResponse.rewrite`. The chain continues, and later rules see the new path.

```ts
const localeRewrite = defineHandler({
  name: "locale-rewrite",
  handler: (request) => {
    const { pathname } = request.nextUrl;
    if (pathname.startsWith("/pl/")) return undefined;
    return NextResponse.rewrite(new URL(`/pl${pathname}`, request.url));
  },
});

// Without a matcher the rewrite would also run for static files and API routes.
export const config = {
  matcher: ["/((?!_next/static|_next/image|api|favicon.ico).*)"],
};

// Runs for /pl/... only, including requests that were just rewritten to it.
const plOnly = defineHandler({
  name: "pl-only",
  rules: { include: path("/pl/**") },
  handler: () => next({ headers: { "content-language": "pl" } }),
});
```

[examples/05](../examples/05-redirect-and-rewrite.ts) combines a redirect and a rewrite.

## Recover from a failing remote check

Use `onError` for rules that call other services. Return a response that you choose, and do not return `next()` for an access-control rule.

```ts
export default chain([lookupFeatureFlags], {
  timeout: 500,
  onError: () => new Response("Service unavailable", { status: 503 }),
});
```

[examples/06](../examples/06-error-recovery.ts) has the complete file. See [Security: Error recovery](security.md#error-recovery) before you return `next()` from `onError`.

## Compose independent integrations

Export each concern as a factory, and let the app decide the order.

```ts
// lib/proxy/locale.ts
export function createLocaleRule(locales: readonly string[], fallback: string) {
  return defineHandler({
    name: "locale",
    handler: (request) => {
      const first = request.nextUrl.pathname.split("/")[1] ?? "";
      if (locales.includes(first)) return next();
      return next({ headers: { "content-language": fallback } });
    },
  });
}

// proxy.ts
const locale = createLocaleRule(["en", "pl"], "en");
export default chain([requestId, maintenance, [locale, path("/**")]]);
```

Factories keep each integration testable on its own. Share one context type across the integrations with `chain<Context>(...)`. [examples/07](../examples/07-composing-rules.ts) shows the complete pattern.

## Log what the chain does

Set `debug` to `'compact'`, `'detailed'`, or `'verbose'` for built-in request diagnostics. Use `onTrace` for structured data, independent of built-in output.

```ts
export default chain(rules, {
  debug: process.env.NODE_ENV === "development",
  onTrace: (trace) => myLogger.info(trace),
});
```

Debugging defaults to off, even in development. Diagnostics omit query strings, request data, context values, and raw errors. Pathnames can still contain private data; set `tracePath: false` to omit them.
