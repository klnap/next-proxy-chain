# @klnap/next-proxy-chain

Composable request pipeline for Next.js middleware and proxy.

---

## Requirements

`next` `>=15.0.0` (peer dependency).

---

## Features

- **Linear Composition**: Chain independent rules sequentially into a single Next.js middleware or proxy handler.
- **Next.js 15 & 16**: Supports both `middleware.ts` and `proxy.ts`.
- **Request-Scoped Context**: Isolated per-request context for sharing state between rules without global state.
- **Deterministic Header & Cookie Merging**: Propagate request header overrides downstream, deduplicate `Set-Cookie` headers, and merge response headers with configurable conflict strategies.
- **Route & Host Scoping**: Declarative path matching (globs, parameters, regex) and host filtering with `include` and `exclude` rules.
- **Safe Pattern Matching**: Normalizes stateful regular expressions to avoid `lastIndex`-related matching issues.
- **Explicit Flow Control**: Return `next({ request, headers })` to continue, or a terminal `Response` / `NextResponse.redirect` / `NextResponse.json` to stop. `NextResponse.rewrite` **continues** the pipeline (rewrite is applied at the end unless a later rule stops).
- **Timeouts & Error Recovery**: Optional per-rule timeouts (`ruleTimeoutMs`). `onError` is fail-closed: returning nothing yields 500; return `next()` to continue; return a `Response` to stop.
- **Zero Runtime Dependencies**: Fully typed in TypeScript with no runtime dependencies (`next` is a peer).

---

## Quick Start

```typescript
// proxy.ts or middleware.ts
import { defineProxy, next, path, proxyChain } from "@klnap/next-proxy-chain"
import { NextResponse } from "next/server"

const auth = defineProxy("auth", (req, ctx) => {
  const token = req.cookies.get("session")?.value
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url))
  }
  ctx.set("userId", "usr_123")
  return next()
})

const security = defineProxy("security", () => {
  return next({
    headers: { "x-frame-options": "DENY" },
  })
})

export default proxyChain({ debug: process.env.NODE_ENV !== "production" }, [
  auth({ include: path("/dashboard/*") }),
  security,
])

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
```

---

## Routing & Scoping

Scope rules to specific paths, hosts, or combinations using `defineProxy`:

```typescript
import { defineProxy, host, next, path } from "@klnap/next-proxy-chain"

const apiAuth = defineProxy("apiAuth", async (req, ctx) => {
  // Executed only for /api/* requests except /api/public/*
  return next()
})

// Scoped rule configuration
const scopedRule = apiAuth({
  include: path("/api/*"),
  exclude: path("/api/public/*"),
})

// Combined path and host filter
const adminRule = apiAuth({
  include: {
    host: host("admin.example.com"),
    path: path("/settings/**"),
  },
})
```

### Path Patterns

- `path("/api/*")` — exactly one segment (`/api/users` yes, `/api/users/123` no)
- `path("/docs/**")` — the prefix plus zero or more extra segments (`/docs`, `/docs/a/b`)
- `path("/users/:id")` — one segment (no capture groups; matching only)
- `path(/^\/foo$/)` — user anchors are kept (`/foo` yes, `/x/foo` no)

### Host Patterns

- `host("admin.example.com")` — exact hostname (case-insensitive, port stripped at match time)
- `host("*.example.com")` — one DNS label (`foo.example.com` yes, `example.com` no, `a.b.example.com` no)
- `host(/shop\.localhost$/)` — raw RegExp

---

## State & Header Mutation

### Request Context

Default context is an isolated `Map<string, unknown>` per request. For a typed object, pass `createContext` — TypeScript then follows the factory, not a fake generic:

```typescript
type Ctx = { user?: { id: string; role: string } }

const enrichUser = defineProxy<Ctx>("enrichUser", async (req, ctx) => {
  ctx.user = { id: "usr_1", role: "admin" }
  return next()
})

const checkPermission = defineProxy<Ctx>("checkPermission", (req, ctx) => {
  if (ctx.user?.role !== "admin") {
    return new Response("Forbidden", { status: 403 })
  }
  return next()
})

export default proxyChain({ createContext: (): Ctx => ({}) }, [enrichUser, checkPermission])
```

Without `createContext`, `ctx` is `ProxyContext` (`Map`). Do not write `proxyChain<{ user: string }>(rules)` — that is a type error.

### Request and Response Headers

Use `next()` to inject **request** headers (visible to downstream rules and route handlers) and **response** headers (including `Set-Cookie`):

```typescript
return next({
  // Downstream request headers (NextRequest & server components). Always last-write-wins.
  request: {
    "x-user-id": "usr_123",
  },
  // Final outgoing response headers / Set-Cookie
  headers: {
    "cache-control": "no-store",
    "set-cookie": "session=abc; Path=/",
  },
})
```

- `headerMergeStrategy` / `cookieMergeStrategy` apply to **response** headers and cookies only.
- Request overrides ignore those strategies (last write wins).
- Cookies are keyed by **name + domain + path**, so `session; Path=/` and `session; Path=/admin` both survive.
- Custom merge `return null` removes that response header from the final `Response`.

---

## API Reference

### Core Functions

| Function | Signature | Description |
| :--- | :--- | :--- |
| `proxyChain(rules)` | `(rules: Entry[]) => Handler` | Creates a middleware/proxy handler from a list of rules. |
| `proxyChain(options, rules)` | `(options: ProxyChainOptions, rules: Entry[]) => Handler` | Creates a handler with custom pipeline options. |
| `defineProxy(name?, fn)` | `(name?: string, fn: ProxyFn) => DefinedProxy` | Defines a reusable proxy rule with scoping capabilities. |
| `next(options?)` | `(options?: NextOptions) => NextResult` | Returns a continuation token with optional header mutations. |
| `path(pattern)` | `(pattern: string \| RegExp) => RegExp` | Compiles a path pattern into a stateless `RegExp`. |
| `host(matcher)` | `(matcher: HostMatcher) => RegExp` | Compiles hostname(s) into an anchored `RegExp` (`*` = one DNS label). |
| `createProxyContext()` | `() => ProxyContext` | Creates a new `Map<string, unknown>` context instance. |
| `isNextResult(value)` | `(value: unknown) => boolean` | Type guard for `next()` continuation tokens. |
| `RuleTimeoutError` | `Error` | Thrown internally when `ruleTimeoutMs` is exceeded (catchable in `onError`). |

### Configuration Options (`ProxyChainOptions`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `createContext` | `(req, event) => TContext` | `() => new Map()` | Factory for custom per-request context. Required for a non-`Map` `TContext`. |
| `headerMergeStrategy` | `"last-write-wins" \| "first-write-wins" \| Function` | `"last-write-wins"` | Conflict strategy for **response** headers only. |
| `cookieMergeStrategy` | `"last-write-wins" \| "first-write-wins" \| Function` | `"last-write-wins"` | Conflict strategy for `Set-Cookie` (same name+domain+path). |
| `ruleTimeoutMs` | `number` | `0` | Wall-clock timeout per rule in ms (`0` disables). Does not abort the rule function; leftover rejections are swallowed. |
| `onError` | `(err, index, req, ctx) => Response \| NextResult \| void` | `undefined` | Recovery hook. See **Errors** below. |
| `requestHeaderPolicy` | `{ blocked?: string[], allowed?: string[] }` | `{}` | Blocklist/allowlist for **request** header mutations. |
| `debug` | `boolean` | `false` | Structured one-line logs per rule. |
| `logger` | `ChainLogger` | `console` | Custom logger (`debug`, `info`, `warn`, `error`). |
| `strictOverrideCheck` | `boolean` | `false` | Throw at init if `NextResponse.next()` request overrides look unsupported. |
| `hostFolderHeader` | `string` | unset | Opt-in: request header name that prefixes rewrites with a physical folder (e.g. `"x-internal-host-folder"`). Off by default. |

### Errors (`onError`)

| `onError` returns | Behavior |
| :--- | :--- |
| `Response` | Stop and return that response (headers/cookies still merged). |
| `next()` | Continue to the next rule (rule-level errors only). |
| `undefined` / `void` / `null` | **Fail closed** — `500 Internal Server Error`. |
| throws | `500 Internal Server Error`. |
| omitted | Rule throw → `500`. |

`ruleIndex` is `0`-based. `-1` means an engine-level error after context creation; only a `Response` is honored (the pipeline cannot continue).

A logging-only `onError: (err) => { console.error(err) }` does **not** skip the failure.

### Return Value Protocol

A rule (`ProxyFn`) can return:

| Return Value | Behavior |
| :--- | :--- |
| `next({ request?, headers? })` | Continues. Queues request overrides, response headers, and `Set-Cookie`. |
| `undefined` / `void` | Continues without mutations. |
| `NextResponse.next()` | Continues; extracts Next.js request override headers and cookies. |
| `NextResponse.rewrite(url)` | **Continues**. Stages a rewrite for later rules; the incoming `NextRequest` is not mutated. The rewrite is applied when the chain finishes unless a later rule returns a terminal response. |
| `NextResponse.redirect(url)` | Stops immediately with the redirect. |
| `Response` / `NextResponse.json()` | Stops immediately with that response. |

---

## Links

- [GitHub](https://github.com/klnap/next-proxy-chain)

---

## License

[MIT](./LICENSE)

