# Concepts

This page describes how a request moves through a chain. Read it before writing rules that stop requests, change headers, or recover from errors.

## One request, one pass

`proxyChain` returns a single function. Next.js calls it once per request. It runs the rules in array order, one at a time:

1. Check whether the rule's `include` and `exclude` scopes match the request. If not, skip the rule.
2. Run the rule with the current request and the request's context.
3. Read the result: continue, or stop with a response.

If every rule continues, the chain ends with `NextResponse.next()`, or with a rewrite if a rule staged one.

## Continue or stop

| A rule returns | Effect |
| :--- | :--- |
| `next()` or nothing | Continue to the next rule. |
| `next({ request, headers })` | Continue. Request headers are passed on, response headers are queued. |
| `NextResponse.rewrite(url)` | Continue. The rewrite applies at the end, unless a later rule stops. |
| `NextResponse.next()` | Continue. Its request-header overrides and cookies are carried forward. |
| `Response`, `NextResponse.redirect()`, `NextResponse.json()` | Stop and return that response. |

Stopping is immediate. Rules after a stopping rule never run, so their headers, cookies, and checks are not applied. This matters most for security headers. See [Ordering](#ordering-and-early-responses).

## Scoping

A rule can take an `include` and an `exclude`:

```ts
authRule({ include: path('/admin/**'), exclude: path('/admin/login') })
```

- No `include`: the rule runs for every request.
- With `include`: the rule runs only when at least one include matches.
- `exclude` wins: a matching `exclude` skips the rule even if `include` matches.

Paths and hosts are matched against the path that Next.js resolves: percent-decoded, without a trailing slash. See [Path patterns](api.md#path) for the pattern syntax.

Rule-level scope is checked before the rule runs. A skipped rule has no effect at all.

## Request headers and response headers

These are two separate channels:

- **Request headers** change what downstream code sees: other rules, route handlers, and server components. Set them with `next({ request })`.
- **Response headers** change what the browser sees. Set them with `next({ headers })`, or by returning a `Response` that has them.

The distinction matters because a header you set for downstream code is not sent to the browser, and a header you send to the browser is not visible to route handlers.

Request overrides are merged into the request for later rules, and then forwarded to Next.js. The `requestHeaderPolicy` option controls which names may be set. By default, `cookie`, `authorization`, `host`, and several proxy headers cannot be overridden. See [Security](security.md#request-header-overrides).

Request overrides always use last-write-wins. The header merge strategies apply only to response headers and cookies.

## Response headers and cookies

Headers from every rule that continued, plus the final response, are merged into one result:

- Each rule's response headers are recorded in order. If two rules set the same header, `headerMergeStrategy` decides which value wins. The default is `last-write-wins`.
- `Set-Cookie` values are keyed by name, domain, and path. `session` on `/` and `session` on `/admin` are two separate cookies and both survive. A cookie with the same key is handled by `cookieMergeStrategy`.
- A custom merge function that returns `null` removes that header or cookie from the response.

Headers from rules that continued before a stopping rule are still merged into its response. Headers from rules after it are not.

## Context

Each request gets its own context object, created before the first rule runs. Rules can read and write it. Nothing in it survives the request.

```ts
const setUser = defineProxy('set-user', (req, ctx) => {
  ctx.set('userId', 'usr_123')
  return next()
})
```

The default context is a `Map<string, unknown>`. For a typed object, pass `createContext`. See the [typed context guide](guides.md#share-typed-state-between-rules).

Context is not the place to pass data to the browser. Use response headers or cookies for that.

## Rewrites

A rewrite changes the path for the rules that follow:

- The rewrite is staged, not applied at once. The next rule sees the rewritten pathname in `req.nextUrl.pathname`, so scopes match the new path.
- The original request object is not mutated.
- If a later rule returns a `Response`, the rewrite is dropped and that response is returned.

Example: a locale rule rewrites `/about` to `/pl/about`, and a later rule scoped to `path('/pl/**')` runs for it. See [examples/05](../examples/05-redirect-and-rewrite.ts).

## Redirects

A redirect stops the chain, like any `Response`. Rules after it do not run. Put checks that must always run before any rule that might redirect, or before the redirect rule itself.

## Ordering and early responses

Rules are not reordered. The order in the array is the order of execution.

Two patterns are common:

- **Security headers first.** A header rule placed before an auth rule still sets its header on a redirect from the auth rule. A header rule placed after does not.
- **Check the path you mean.** A rule placed after a rewrite sees the rewritten path. Place a redirect before a rewrite if it should match the original URL.

See [examples/01](../examples/01-quick-start.ts) for the first pattern.

## Errors and timeouts

A rule can throw. What happens next depends on `onError`:

| Situation | Result |
| :--- | :--- |
| Rule throws, no `onError` | `500 Internal Server Error`. Later rules do not run. |
| `onError` returns a `Response` | The chain stops with that response. Earlier headers and cookies are still merged. |
| `onError` returns `next()` or `NextResponse.next()` | The chain continues with the next rule. |
| `onError` returns nothing | `500 Internal Server Error`. |
| `onError` throws | `500 Internal Server Error`. |

`onError` receives the error and the index of the rule that threw. Index `-1` means the failure happened after all rules ran, while the final response was being built. No rule is left to continue to, so only a `Response` is honored there. `next()` or `NextResponse.next()` returns `500`.

`ruleTimeoutMs` gives each rule a time limit. A rule that runs past it is treated as thrown, with a `RuleTimeoutError`. The rule function is not cancelled: it keeps running in the background, and its late result is ignored.

When a rule continues after `onError` returns `next()`, that rule's own result is skipped, and the rules after it run as usual. Use this only when skipping the rule is safe for your application.

## Summary

- Rules run in order. A stopping rule ends the chain.
- Scopes are checked before a rule runs.
- Request headers go downstream. Response headers go to the browser.
- Context is per request.
- Errors fail closed unless `onError` says otherwise.
