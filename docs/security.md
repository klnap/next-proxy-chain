# Security

`@klnap/next-proxy-chain` organizes code that runs in Proxy or Middleware. It does not decide what is allowed. Your rules decide that. This page separates package guarantees from application responsibilities.

## Trust boundaries

- **Request data is untrusted.** Paths, queries, cookies, headers, and hosts can be set by clients.
- **Handlers are trusted code.** A handler can set request headers, response headers, cookies, stop the chain, or rewrite a path.
- **Upstream responses are data.** Relayed response headers pass through except Next.js routing metadata, which is stripped from terminal responses.

## Authentication

The package runs your authentication check; it does not perform one. A present cookie does not prove a session. Verify the session or token in trusted server code:

```ts
const requireSession = defineHandler({
  name: "require-session",
  handle: async (request) => {
    const session = await verifySession(request.cookies.get("session")?.value);
    if (!session) return NextResponse.redirect(new URL("/login", request.url));
  },
});
```

`verifySession` is application-owned. Proxy runs before the route, so route handlers must still authorize access to returned data.

Server Functions (Server Actions) use POST requests to their route. Excluding that route from `config.matcher` also skips those calls. Enforce authorization inside each Server Function.

## Ordering and early responses

A redirect or terminal `Response` stops the chain. Later handlers do not run, so their checks, headers, and cookies are absent.

Put universal security headers first. Put authentication before handlers that can answer a request, such as cache or static-response handlers.

## Path matching

- Scopes match decoded paths without a trailing slash. `/%61dmin/users` is matched as `/admin/users`.
- `/api/*` matches one segment; `/api/**` matches all descendants.
- Malformed percent encoding returns `400 Bad Request` before handlers run.
- A handler sees rewrites staged by earlier handlers. Verify that the path it protects is the path Next.js serves.

## Host matching

The `host` header comes from the client or a proxy and is not trusted by default. Host scopes are routing aids, not access control. Use a platform host allowlist.

- Ports and trailing dots are ignored.
- Host strings compare case-insensitively. Wildcards match one DNS label.
- If `host` is missing, matching falls back to `x-forwarded-host`. Trust that header only when a proxy you control sets it.

## Request headers

`NextResponse.next({ request: { headers } })` uses Next.js's native request-header override mechanism. The supplied `Headers` instance replaces the forwarded header set. Clone `request.headers` to preserve values; omitted values are removed. Later handlers receive the effective replacement.

There is no package-level header allowlist or blocklist. Handler code chooses which headers to forward. Validate any client-controlled value before using it for identity, authorization, host routing, or rewrite decisions. A forwarded header is not trusted merely because Proxy set it; clients may reach a route directly.

Request overrides remain separate from outgoing response headers. The package reads Next.js's override metadata to reconstruct the request for later handlers. It strips Next.js routing metadata from terminal responses, including error-recovered responses, so transport instructions are not forwarded as ordinary response headers.

## Rewrites

Handlers may use native `NextResponse.rewrite()` for internal or external destinations. Validate destinations derived from request data. Do not pass an untrusted redirect or rewrite target through without checking its origin and allowed paths.

## Response headers and cookies

- Headers from continuing handlers merge onto the final response. `last-write-wins` is the default.
- Cookies use name, domain, and path identity. A later cookie with the same identity replaces an earlier one by default.
- Next.js routing headers are stripped from terminal responses. Native `NextResponse.next()` and `NextResponse.rewrite()` metadata is interpreted only as routing behavior, not copied to the client as ordinary response headers.

## Diagnostics and privacy

Debug logs and `onTrace` are disabled unless enabled. Formatted traces and structured traces omit request and response header values, cookie values, request bodies, application context values, and raw errors. Redirect and rewrite query values are redacted.

Pathnames can contain personal data. `tracePath: false` omits only the original request pathname from the top-level structured trace and formatted request line. It does not hide paths in handler scope details or sanitized rewrite and redirect destinations. Destination query values appear as `?[query]`. Handler names and scope strings are sanitized and length-limited before display.

Treat traces as operational data. Logger callbacks can persist them beyond the request; the package cannot control retention, access, or cross-process ordering.

## Error recovery

For ordinary handler errors, handler-level `onError` takes precedence over chain-level `onError`:

- `NextResponse.next()` continues after the failed handler.
- A Web `Response` terminates with that response.
- `undefined`, `void`, `null`, a throw, or an unsupported return fails closed with `500`.

Timeout and request-cancellation recovery accepts only a terminal Web `Response`; continuation is not allowed. Without timeout recovery, the chain returns `500`, but ignored work may continue. Without cancellation recovery, the chain stops and returns the native `NextResponse.next()` handoff; Next.js may continue downstream routing after a client disconnect. This handoff is not fail-closed.

## Timeouts

Handler `timeout` covers its `when` predicate and `handle` together. Timeout or request cancellation aborts the execution-scoped signal and stops the engine from waiting. Cooperative work can stop early; synchronous JavaScript, ignored signals, and side effects cannot be forcibly stopped or undone.

Each handler execution gets its own signal. The predicate shares that handler's signal. `event.waitUntil()` work is not supervised by the timeout; pass `context.signal` explicitly when background work should follow the handler lifetime.

## Context

Each request gets isolated context. Built-in request metadata is immutable; application properties are mutable. `originalUrl` may contain sensitive query values. Do not log or forward it without redaction. Context values do not enter built-in diagnostics.

## Next.js version notes

- Next.js 16 uses `proxy.ts` and the Node.js runtime by default. Proxy does not accept a `runtime` setting.
- Next.js 15 uses `middleware.ts` and may run on Edge. Edge behavior must be verified separately for the target release.
- `config.matcher` decides which paths reach Proxy or Middleware. Handler scopes cannot widen that set.

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private vulnerability reporting from the repository's **Security** tab.
