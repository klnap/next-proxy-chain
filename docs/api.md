# API reference

Everything is exported from `@klnap/next-proxy-chain`.

```ts
import {
  chain,
  defineHandler,
  host,
  isNextResult,
  next,
  path,
  RuleTimeoutError,
} from "@klnap/next-proxy-chain";
import type { HandlerContext, RequestMetadata } from "@klnap/next-proxy-chain";
```

## `chain`

Composes native Next.js proxy handlers, defineHandler() results, and scoped tuples into one handler.

```ts
chain(entries);
chain(entries, options);
chain<TContext>(entries, options);
```

`entries` is an array. Each entry is one of:

| Entry                                         | Receives                                                        | Notes                                                                                                                                  |
| :-------------------------------------------- | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| A plain function `(request, event, context?)` | `request`, `event`, and `context` as an optional third argument | The native Next.js signature. Next.js passes only two arguments; `chain()` adds the request context third.                             |
| A `defineHandler()` result                    | `request`, `event`, and `context`                               | Use for named handlers, local rules, typed context, and per-handler settings.                                                          |
| A tuple `[handler, scope]`                    | As above, only when the scope matches                           | `scope` is a path string, an array of paths, a RegExp, or an object `{ include?, exclude? }`. Include objects can also contain `host`. |

`chain()` runs entries in array order. It returns a function that Next.js calls as `default` export of `proxy.ts` or `middleware.ts`.

```ts
export default chain([intlProxy, [authProxy, "/dashboard/**"], securityProxy]);
```

A plain handler keeps the native Next.js signature. The optional third context argument is supplied only by `chain()`.

## `defineHandler`

Defines a native-signature handler with an optional name, route rules, timeout, and local debug level.

```ts
const authHandler = defineHandler<Context>({
  name: "auth",
  debug: "verbose",
  timeout: 2000,
  rules: {
    include: ["/dashboard/**", "/account/**"],
    exclude: "/account/login",
    when: (request, event, context) => Boolean(context.user),
  },
  handler: (request, event, context) => authenticate(request, event, context),
});
```

The handler receives `(request, event, context)`. `rules.when` runs after include/exclude matching and before the handler. It shares the handler's signal and deadline; an unset handler timeout inherits chain `timeout`.

The optional handler-level `onError` replaces the chain-level `onError` for that handler. If it returns `undefined`, `null`, or throws, the request fails closed; the chain-level handler is not tried afterward. Verbose diagnostics identify which policy handled the error.

## `next`

```ts
next(options?: NextOptions): NextResult
```

Continues to the next rule.

```ts
type NextOptions = {
  request?: HeadersInit; // request headers for downstream code
  headers?: HeadersInit; // response headers; set-cookie entries become cookies
};
```

`request` values pass through `requestHeaderPolicy`. Header names in `headers` are merged according to `headerMergeStrategy`, and cookies according to `cookieMergeStrategy`.

`headers` are sent to the browser on the response Next.js returns. Next.js advises against setting response headers from the proxy this way, because a header such as `Content-Type` can break Server Actions and streaming responses. Keep proxy response headers to safe values like `cache-control` and security headers, and set anything else in the route.

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

| Pattern      | Matches                                | Does not match              |
| :----------- | :------------------------------------- | :-------------------------- |
| `/api/*`     | `/api/users`                           | `/api`, `/api/users/123`    |
| `/api/**`    | `/api`, `/api/users`, `/api/users/123` | `/apix`                     |
| `/users/:id` | `/users/42`                            | `/users`, `/users/42/posts` |

`:name` matches one segment. It does not capture a value. Use `req.nextUrl.pathname` if you need the segment.

`*` and `**` must be a whole segment. A segment such as `*.pdf` throws when the rule is created, instead of matching a literal.

A RegExp is matched as written. If it has neither `^` nor `$`, the whole path must match. A one-sided anchor gives a prefix or suffix match, so anchor both ends for an exact match:

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
- `host(/shop\.localhost$/)`: a RegExp, matched against the whole host name. Only its source is used; its flags are ignored, and matching is case-insensitive.
- An array matches if any entry matches.

The host comes from the `host` header, or from `x-forwarded-host` when `host` is absent. The client controls this header. See [Security](security.md#host-matching).

## Request context

```ts
type RequestMetadata = {
  readonly requestId: string;
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly originalUrl: string;
  readonly originalPathname: string;
  readonly originalHostname: string;
};

type HandlerContext<TContext extends object = object> = RequestMetadata &
  Omit<Partial<TContext>, keyof RequestMetadata | "signal"> & {
    readonly signal: AbortSignal;
  };
```

Every invocation creates one ID and metadata snapshot. Application properties are mutable, optional until set, and isolated per request. The seven metadata properties and `signal` are immutable.

## `RuleTimeoutError`

```ts
class RuleTimeoutError extends Error {
  readonly ruleName: string;
  readonly timeoutMs: number;
}
```

Passed to `onError` when a handler exceeds its timeout. Check with `err instanceof RuleTimeoutError`.

## Options

| Option                | Type                                                    | Default             | Description                                                                                                                                             |
| :-------------------- | :------------------------------------------------------ | :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `headerMergeStrategy` | `'last-write-wins' \| 'first-write-wins' \| MergeFn`    | `'last-write-wins'` | Resolves response header conflicts between rules.                                                                                                       |
| `cookieMergeStrategy` | `'last-write-wins' \| 'first-write-wins' \| MergeFn`    | `'last-write-wins'` | Resolves `Set-Cookie` conflicts with the same name, domain, and path.                                                                                   |
| `timeout`             | `number`                                                | `0`                 | Time limit per handler, including its predicate. Zero disables it. Must be an integer from 0 through `2_147_483_647`.                                   |
| `onError`             | `OnErrorHandler`                                        | none                | Recovers from ordinary errors. Timeout and request cancellation accept only a terminal `Response`.                                                      |
| `requestHeaderPolicy` | `{ blocked?: string[]; allowed?: string[] }`            | `{}`                | Controls which request headers `next({ request })` may set.                                                                                             |
| `debug`               | `false \| true \| 'compact' \| 'detailed' \| 'verbose'` | `false`             | Built-in request diagnostics. `true` means `'detailed'`.                                                                                                |
| `onTrace`             | `(trace: ChainTrace) => void \| Promise<void>`          | none                | Receives one completed structured trace per request. The chain does not await it.                                                                       |
| `tracePath`           | `boolean`                                               | `true`              | Set `false` to omit request pathnames from built-in output and traces.                                                                                  |
| `logger`              | `ChainLogger`                                           | console             | Replaces the built-in output sink. Completed debug blocks use `info`; methods must provide `debug`, `info`, `warn`, `error`. Sink failures are ignored. |
| `strictOverrideCheck` | `boolean`                                               | `false`             | Throws at startup when the runtime cannot apply request overrides.                                                                                      |

`MergeFn` is `(key: string, existing: string, incoming: string) => string | null`. Returning `null` removes the header or cookie.

### `requestHeaderPolicy`

By default, these names cannot be set through `next({ request })`:

`host`, `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`, `content-length`, `cookie`, `authorization`, `x-forwarded-host`, `x-forwarded-for`, `x-forwarded-proto`, `x-real-ip`, and every name starting with `x-middleware-`. Other `x-forwarded-*` names, such as `x-forwarded-port`, are not on the list.

- `blocked` adds names to this list.
- `allowed` lets names through. It overrides the default list, including `x-middleware-*` names. Use it only for headers your own code controls.

Blocked names are dropped silently. Set `debug: true` to see them in the logs.

### Debug levels and traces

| Level        | Output                                                                                           |
| :----------- | :----------------------------------------------------------------------------------------------- |
| `false`      | No built-in diagnostics. This is the default, including in development.                          |
| `true`       | Same as `'detailed'`.                                                                            |
| `'compact'`  | One concise summary line per request.                                                            |
| `'detailed'` | Summary and executed, skipped, and not-reached handler outcomes.                                 |
| `'verbose'`  | Detailed output plus skip reasons, declared match rules, `when` results, and effective timeouts. |

`defineHandler({ debug })` overrides the chain level for that handler. Explicit `false` hides its built-in details, but never changes execution or the `onTrace` callback. A handler-level `true`, `'detailed'`, or `'verbose'` can enable built-in output when chain debugging is off. `'compact'` requests summary output.

`onTrace` is independent of built-in debug filtering. Every trace includes `requestId`, `startedAt`, monotonic `durationMs`, optional pathname, final outcome, and ordered handler outcomes. It never receives request headers, cookies, bodies, context values, or raw error objects. Rejected promises and thrown errors from the callback are ignored.

The built-in formatter uses `NO_COLOR` before `FORCE_COLOR`, then TTY detection. It uses plain text when output is non-interactive or terminal capabilities are uncertain. `tracePath: false` omits pathnames; destination query values are always redacted. Terminal controls and excessively long strings are sanitized.

Handler durations include `when` evaluation but exclude recovery. Total duration includes recovery, response composition, and finalization. Timeout aborts the handler signal and stops waiting; user code must cooperate with the signal.

### `onError`

```ts
type OnErrorHandler<TContext> = (
  err: unknown,
  ruleIndex: number,
  req: NextRequest,
  ctx: HandlerContext<TContext>,
) => OnErrorResult | Promise<OnErrorResult>;
```

`ruleIndex` is the zero-based index of the rule that failed. `-1` means the error came from the engine itself rather than a rule's own code: after all rules ran, or while reading a rule's return value.

| Returns                           | Effect                                                                                  |
| :-------------------------------- | :-------------------------------------------------------------------------------------- |
| `Response`                        | Stops the chain with that response. Earlier headers and cookies are merged into it.     |
| `next()` or `NextResponse.next()` | Continues to the next rule. Not allowed for `-1`, where no rule is left: returns `500`. |
| `undefined`, `void`, or `null`    | `500 Internal Server Error`.                                                            |

Throwing inside `onError` also gives a 500.

## `ChainLogger`

```ts
interface ChainLogger {
  debug(metaOrMsg: unknown, maybeMsg?: string): void;
  info(metaOrMsg: unknown, maybeMsg?: string): void;
  warn(metaOrMsg: unknown, maybeMsg?: string): void;
  error(metaOrMsg: unknown, maybeMsg?: string): void;
}
```

Any logger with these four methods works, including pino and winston.

## Types

| Type                                         | Meaning                                                       |
| :------------------------------------------- | :------------------------------------------------------------ |
| `ChainOptions<TContext>`                     | Options accepted by `chain()`.                                |
| `ChainEntry<TContext>`                       | A native handler, defined handler, or scoped tuple.           |
| `DefinedHandler<TContext>`                   | The return type of `defineHandler()`.                         |
| `HandlerContext<TContext>`                   | Read-only request metadata and signal with mutable app state. |
| `RequestMetadata`                            | Immutable request identity and original request snapshot.     |
| `PathMatcher`                                | `string \| RegExp`.                                           |
| `HostMatcher`                                | `string \| RegExp \| (string \| RegExp)[]`.                   |
| `NextOptions`                                | The argument to `next()`.                                     |
| `NextResult`                                 | The return type of `next()`.                                  |
| `MergeStrategy`                              | `'last-write-wins' \| 'first-write-wins' \| MergeFn`.         |
| `RequestHeaderPolicy`                        | `{ blocked?, allowed? }`.                                     |
| `OnErrorHandler`, `OnErrorResult`            | Types for `onError`.                                          |
| `ChainLogger`                                | The logger interface.                                         |
| `DebugLevel`                                 | `false \| true \| 'compact' \| 'detailed' \| 'verbose'`.      |
| `ChainTrace`, `ChainOutcome`, `HandlerTrace` | Sanitized structured request diagnostics.                     |
