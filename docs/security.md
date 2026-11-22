# Security

`@klnap/next-proxy-chain` organizes the code that runs in your Proxy. It does not decide what is allowed. Your rules decide that. This page lists what the library guarantees, what it leaves to you, and the mistakes that are easy to make.

## Trust boundaries

- **Request data is untrusted.** Path, query, cookies, headers, and host can all be set by the client. Rules must treat them as input.
- **Rules are trusted code.** A rule can set any response header, stop the chain, or rewrite the path. Only put code you trust in the chain.
- **Upstream responses are data.** If a rule relays a response from another service, the library passes its headers through, except Next.js routing headers, which are removed (see below).

## Authentication

The library runs your auth check. It does not perform one. A cookie being present is not a session. Verify the session or token on the server, with the same code that protects your data:

```ts
const requireSession = defineProxy('require-session', async (req) => {
  const session = await verifySession(req.cookies.get('session')?.value)
  if (!session) return NextResponse.redirect(new URL('/login', req.url))
  return next()
})
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
- A rule sees the path after rewrites made by earlier rules. It does not see the `hostFolderHeader` prefix, which is applied after all rules run. If a rule protects a path, check that the path it sees is the path that is served.

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

## Error recovery

`onError` decides what happens after a rule throws or times out:

- `Response`: the chain stops with it. Earlier headers and cookies are kept.
- `next()` or `NextResponse.next()`: the chain continues to the next rule. The rule that failed does not run its protection. Use this only for rules that do not enforce access control.
- nothing, or a throw: `500 Internal Server Error`.

Engine-level failures, after all rules ran, cannot continue. `next()` returns `500` there.

## Timeouts

`ruleTimeoutMs` stops waiting for a rule. It does not cancel the rule. The rule keeps running, and its side effects still happen. Keep rules idempotent if they write anything, and do not rely on a timeout to prevent an action.

A timed-out rule goes to `onError`. Without one, the request gets a `500`.

## Context

The context is created for each request and dropped when the request finishes. It is not shared between requests. Do not store secrets in it that you later return in a response.

## Next.js version notes

- Next.js 16 runs `proxy.ts` on the Node.js runtime by default. A `runtime` setting is not allowed in `proxy.ts`.
- Next.js 15 `middleware.ts` can run on the Edge runtime. The library uses only Web APIs, but the Edge runtime has not been tested here.
- A `matcher` in `config` decides which paths Next.js sends to the Proxy at all. A scope in this library cannot widen that set. Keep the matcher and the scopes consistent, so that a path you protect is in both.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**.
