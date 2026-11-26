# Security

`@klnap/next-proxy-chain` organizes the code that runs in your Proxy. It does not decide what is allowed. Your rules decide that. This page lists what the library guarantees, what it leaves to you, and the mistakes that are easy to make.

## Trust boundaries

- **Request data is untrusted.** Path, query, cookies, headers, and host can all be set by the client. Rules must treat them as input.
- **Rules are trusted code.** A rule can set any response header, stop the chain, or rewrite the path. Only put code you trust in the chain.
- **Upstream responses are data.** If a rule relays a response from another service, the library passes its headers through, except Next.js routing headers, which are removed (see below).

## Authentication

The library runs your auth check. It does not perform one. A cookie being present is not a session. Verify the session or token on the server, with the same code that protects your data:

```ts
const requireSession = defineHandler({
  name: "require-session",
  handler: async (request) => {
    const session = await verifySession(request.cookies.get("session")?.value);
    if (!session) return NextResponse.redirect(new URL("/login", request.url));
    return next();
  },
});
```

`verifySession` is your code. Keep in mind that Proxy runs before the route, so a route handler should still check authorization for the data it returns.

## Server Functions

Server Functions (Server Actions) are sent as POST requests to the route that uses them. A proxy matcher that excludes that route also skips the Server Function calls. Check authentication and authorization inside each Server Function, not only in the proxy.

## Ordering and early responses

A rule that returns a `Response` stops the chain. Rules after it do not run, which means their headers, cookies, and checks are absent from that response.

Put these first:

- security headers (`Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`),
- anything that must apply to every response, including redirects.

Put auth checks before any rule that can answer a request on its own, such as a cache or a static response.

[examples/01](../examples/01-quick-start.ts) shows the header-first order.

## Path matching

- Scopes match the decoded path with no trailing slash. `/admin/` is treated as `/admin`, and `/%61dmin/users` as `/admin/users`. Scope patterns apply to the same form Next.js routes on.
- `/api/*` matches exactly one segment. `/api/**` matches everything below `/api`. For access control, prefer `**` so that deeper routes are covered.
- Malformed percent-encoding, such as `%E0%A4%A`, returns `400 Bad Request` before any rule runs.
- A rule sees the path after rewrites made by earlier rules. Check that the path it protects is the path that Next.js serves.

## Host matching

The `host` header is set by the client, or by a proxy in front of your app, and is not trusted by default. Host scopes are a routing aid, not an access control on their own. Use them together with your platform's host allowlist.

- The port is ignored. `admin.example.com:8443` matches `host('admin.example.com')`.
- A trailing dot is ignored, so `admin.example.com.` matches as well.
- If `host` is missing, `x-forwarded-host` is used. Only trust that header when a proxy you control sets it.

## Request header overrides

`next({ request })` sets headers that route handlers and later rules receive. A client cannot set these headers, but a rule can. Overrides go through `requestHeaderPolicy`. By default, these names are blocked:

- `cookie`, `authorization`, `host`, `x-forwarded-host`, `x-forwarded-for`, `x-forwarded-proto`, `x-real-ip`, and hop-by-hop headers,
- every `x-middleware-*` name.

Do not put identity or authorization data into `request` headers unless the rule that sets it is the only source for them, and the route handler trusts only that header. A client that can reach the handler directly can send the same header.

`requestHeaderPolicy.allowed` overrides the default list, including `x-middleware-*` names. Use it only for names your own code controls.

## Response headers and cookies

- Headers from every rule that continued are merged. With the default `last-write-wins`, a later rule can replace an earlier rule's header. Set `headerMergeStrategy` if you need a different rule.
- Cookies are identified by name, domain, and path. A later `Set-Cookie` with the same identity replaces the earlier one by default. Set `cookieMergeStrategy` to `first-write-wins`, or a function, if an earlier session cookie must not be replaced.
- Next.js routing headers (`x-middleware-override-headers`, `x-middleware-request-*`) are removed from terminal responses. This includes responses returned by `onError`.

## Diagnostics and privacy

Debug output and `onTrace` are off unless explicitly enabled. Diagnostics never include request or response headers, cookies, bodies, context values, or raw errors. Redirect and rewrite query values are redacted.

Pathnames can still contain user IDs or other personal data. Set `tracePath: false` to omit them from both formatted output and structured traces. Handler names and configured scope strings are sanitized and length-limited before diagnostics; terminal control characters cannot inject ANSI escapes or extra lines.

Treat traces as operational data. External logger callbacks can persist them beyond the request, and the package cannot control their retention, access, or cross-process ordering.

## Error recovery

For ordinary handler errors, `onError` decides what happens:

- `Response`: the chain stops with it. Earlier headers and cookies are kept.
- `next()` or `NextResponse.next()`: the chain continues to the next rule. The rule that failed does not run its protection. Use this only for rules that do not enforce access control.
- nothing, or a throw: `500 Internal Server Error`.

Timeout recovery is stricter: only a terminal `Response` is accepted. Missing, throwing, or continuing recovery fails closed with `500`. Request-cancellation recovery also accepts only a terminal `Response`; without one, the chain returns `NextResponse.next()` as the framework handoff. Neither fallback guarantees downstream work stops after a client disconnect.

## Timeouts

Chain option `timeout` covers the predicate and handler together. A timeout aborts the execution-scoped signal and stops the engine from waiting. Cooperative operations can stop early, but ignored signals, synchronous JavaScript, and side effects cannot be forcibly stopped or undone. Do not use a timeout as a transaction or authorization boundary.

Each handler gets a separate signal. Predicates share their handler's signal. `event.waitUntil()` work is not supervised by the timeout; explicitly passing a handler signal gives that background work the handler scope's lifecycle.

## Context

Each request gets an isolated context. Built-in request metadata is immutable; application properties remain mutable. `originalUrl` may contain sensitive query values. Do not log or forward it without redaction. Context values do not enter built-in diagnostics.

## Next.js version notes

- Next.js 16 runs `proxy.ts` on the Node.js runtime by default. A `runtime` setting is not allowed in `proxy.ts`.
- Next.js 15 `middleware.ts` can run on the Edge runtime. The library uses only Web APIs, but the Edge runtime has not been tested here.
- A `matcher` in `config` decides which paths Next.js sends to the Proxy at all. A scope in this library cannot widen that set. Keep the matcher and the scopes consistent, so that a path you protect is in both.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**.
