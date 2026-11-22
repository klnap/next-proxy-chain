# API reference

Everything is exported from `@klnap/next-proxy-chain`.

```ts
import {
  defineProxy,
  host,
  isNextResult,
  next,
  path,
  proxyChain,
  createProxyContext,
  RuleTimeoutError,
} from '@klnap/next-proxy-chain'
```

## `proxyChain`

Builds the function that Next.js calls for each request.

```ts
proxyChain(entries)
proxyChain(options, entries)
proxyChain<TContext>({ createContext, ...options }, entries)
```

- `entries`: an array of rules. Each entry is either a rule created with `defineProxy`, a plain function, or a `{ run, include, exclude, name }` object.
- `options`: see [Options](#options).

Export the result as the default export of `proxy.ts` (Next.js 16) or `middleware.ts` (Next.js 15).

```ts
export default proxyChain([...rules])
```

## `defineProxy`

Creates a reusable rule. Calling the result with a scope returns a scoped rule.

```ts
const rule = defineProxy('name', (req, ctx, event) => next())
const scoped = rule({ include: path('/admin/**'), exclude: path('/admin/login') })
```

- `name` is optional. It appears in logs and in error messages. Without it, the function's name is used.
- Pass a generic to type the context: `defineProxy<MyContext>(...)`.
- Calling a rule with a request instead of a scope runs it directly. You do not normally do this.

### Scope

`include` and `exclude` each accept:

- a path pattern (`string` or `RegExp`),
- a host matcher object `{ host, path? }` or `{ path, host? }`,
- or an array of these.

`exclude` is checked first. A rule runs when it matches at least one `include` (or has no `include`) and matches no `exclude`. Declaring the same scope in both `include` and `exclude` throws at startup.

## `next`

```ts
next(options?: NextOptions): NextResult
```

Continues to the next rule.

```ts
type NextOptions = {
  request?: HeadersInit // request headers for downstream code
  headers?: HeadersInit // response headers; set-cookie entries become cookies
}
```

`request` values pass through `requestHeaderPolicy`. Header names in `headers` are merged according to `headerMergeStrategy`, and cookies according to `cookieMergeStrategy`.

## `isNextResult`

```ts
isNextResult(value: unknown): value is NextResult
```

True for values returned by `next()`. `NextResponse.next()` returns a `Response`, not a `NextResult`, and is handled separately.

## `path`

```ts
path(pattern: string | RegExp): RegExp
```

Compiles a path pattern. The result is a stateless `RegExp` that matches the decoded pathname with no trailing slash.

String patterns:

| Pattern | Matches | Does not match |
| :--- | :--- | :--- |
| `/api/*` | `/api/users` | `/api`, `/api/users/123` |
| `/api/**` | `/api`, `/api/users`, `/api/users/123` | `/apix` |
| `/users/:id` | `/users/42` | `/users`, `/users/42/posts` |

`:name` matches one segment. It does not capture a value. Use `req.nextUrl.pathname` if you need the segment.

RegExp patterns keep your anchors. Without anchors, the whole path must match:

- `path(/^\/foo$/)` matches `/foo` only.
- `path(/\/public|\/static/)` matches `/public` and `/static` as whole paths, not `/admin/static`.

Malformed percent-encoding (for example `%E0%A4%A`) makes the chain return `400 Bad Request` before any rule runs.

## `host`

```ts
host(matcher: string | RegExp | (string | RegExp)[]): RegExp
```

Compiles host names for a host scope.

- `host('admin.example.com')`: exact match, case-insensitive. The port is ignored.
- `host('*.example.com')`: one DNS label. `foo.example.com` matches. `example.com` and `a.b.example.com` do not.
- `host(/shop\.localhost$/)`: a RegExp, used as written.
- An array matches if any entry matches.

The host comes from the `host` header, or from `x-forwarded-host` when `host` is absent. The client controls this header. See [Security](security.md#host-matching).

## `createProxyContext`

```ts
createProxyContext(): ProxyContext // Map<string, unknown>
```

Creates the default per-request context. You rarely call it directly. The default `createContext` uses it.

## `RuleTimeoutError`

```ts
class RuleTimeoutError extends Error {
  readonly ruleName: string
  readonly timeoutMs: number
}
```

Passed to `onError` when a rule exceeds `ruleTimeoutMs`. Check with `err instanceof RuleTimeoutError`.

## Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `createContext` | `(req, event) => TContext` | `createProxyContext` | Creates the context for each request. Required when `TContext` is not a `Map`. |
| `headerMergeStrategy` | `'last-write-wins' \| 'first-write-wins' \| MergeFn` | `'last-write-wins'` | Resolves response header conflicts between rules. |
| `cookieMergeStrategy` | `'last-write-wins' \| 'first-write-wins' \| MergeFn` | `'last-write-wins'` | Resolves `Set-Cookie` conflicts with the same name, domain, and path. |
| `ruleTimeoutMs` | `number` | `0` | Time limit per rule in milliseconds. `0` disables it. Must be finite. |
| `onError` | `OnErrorHandler` | none | Recovers from a thrown rule or a timeout. See below. |
| `requestHeaderPolicy` | `{ blocked?: string[]; allowed?: string[] }` | `{}` | Controls which request headers `next({ request })` may set. |
| `debug` | `boolean` | `false` | Logs one line per rule, and merge conflicts. |
| `logger` | `ChainLogger` | console | Receives log lines. Must provide `debug`, `info`, `warn`, `error`. |
| `strictOverrideCheck` | `boolean` | `false` | Throws at startup when the runtime cannot apply request overrides. |
| `hostFolderHeader` | `string` | unset | Name of a request header that prefixes internal rewrites with a folder. For multi-tenant `app/(sites)/...` layouts. Off by default. |

`MergeFn` is `(key: string, existing: string, incoming: string) => string | null`. Returning `null` removes the header or cookie.

### `requestHeaderPolicy`

By default, these names cannot be set through `next({ request })`:

`host`, `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`, `content-length`, `cookie`, `authorization`, `x-forwarded-host`, `x-forwarded-for`, `x-forwarded-proto`, `x-real-ip`, and every name starting with `x-middleware-`.

- `blocked` adds names to this list.
- `allowed` lets names through. It overrides the default list, including `x-middleware-*` names. Use it only for headers your own code controls.

Blocked names are dropped silently. Set `debug: true` to see them in the logs.

### `onError`

```ts
type OnErrorHandler<TContext> = (
  err: unknown,
  ruleIndex: number,
  req: NextRequest,
  ctx: TContext
) => OnErrorResult | Promise<OnErrorResult>
```

`ruleIndex` is the zero-based index of the rule that failed. `-1` means the failure came after all rules ran.

| Returns | Effect |
| :--- | :--- |
| `Response` | Stops the chain with that response. Earlier headers and cookies are merged into it. |
| `next()` or `NextResponse.next()` | Continues to the next rule. Not allowed for `-1`, where no rule is left: returns `500`. |
| `undefined`, `void`, or `null` | `500 Internal Server Error`. |

Throwing inside `onError` also gives a 500.

## `ChainLogger`

```ts
interface ChainLogger {
  debug(metaOrMsg: unknown, maybeMsg?: string): void
  info(metaOrMsg: unknown, maybeMsg?: string): void
  warn(metaOrMsg: unknown, maybeMsg?: string): void
  error(metaOrMsg: unknown, maybeMsg?: string): void
}
```

Any logger with these four methods works, including pino and winston.

## Types

| Type | Meaning |
| :--- | :--- |
| `ProxyFn<TContext>` | The function a rule runs. Returns a response, `next()`, `undefined`, or a promise of one. |
| `ProxyRule<TContext>` | A rule object with `run`, `include`, `exclude`, `name`. |
| `DefinedProxy<TContext>` | The return type of `defineProxy`: callable as a rule or with a scope. |
| `Entry<TContext>` | Anything you can put in the rules array. |
| `ProxyContext` | `Map<string, unknown>`. |
| `ProxyChainOptions<TContext>` | The options object. |
| `ProxyPathFilter` | `{ include?, exclude?, name? }`, the argument to a scoped rule. |
| `PathMatcher` | `string \| RegExp`. |
| `HostMatcher` | `string \| RegExp \| (string \| RegExp)[]`. |
| `NextOptions` | The argument to `next()`. |
| `NextResult` | The return type of `next()`. |
| `MergeStrategy` | `'last-write-wins' \| 'first-write-wins' \| MergeFn`. |
| `RequestHeaderPolicy` | `{ blocked?, allowed? }`. |
| `OnErrorHandler`, `OnErrorResult` | Types for `onError`. |
| `ChainLogger` | The logger interface. |
