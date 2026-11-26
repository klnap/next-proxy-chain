# @klnap/next-proxy-chain

Composable proxy and middleware for Next.js.

```ts
import { chain } from "@klnap/next-proxy-chain";

export default chain([intlProxy, [authProxy, "/dashboard/**"], securityProxy]);
```

`intlProxy`, `authProxy` and `securityProxy` are ordinary Next.js proxy functions: `(request, event) => NextResponse | Response | undefined`. You do not wrap them, and you do not change what they return.

## Install

```sh
npm install @klnap/next-proxy-chain
# or
bun add @klnap/next-proxy-chain
```

`next` is a peer dependency (`>=15.0.0`). The package has no runtime dependencies.

## Basic composition

Pass handlers in the order they should run. Each one receives the native `(request, event)` arguments, so `event.waitUntil()` works.

```ts
import { chain } from "@klnap/next-proxy-chain";
import { NextResponse } from "next/server";

function analytics(request, event) {
  event.waitUntil(sendPageView(request.nextUrl.pathname));
  return NextResponse.next();
}

export default chain([analytics, intlProxy, securityProxy]);
```

A handler continues the chain by returning `undefined` or `NextResponse.next()`. A handler stops the chain by returning a `Response`, `NextResponse.redirect()`, `NextResponse.json()`, or `Response.redirect()`. The rest of this page explains each case.

## Scoped handlers

Wrap a handler in a tuple to run it only for some paths or hosts:

```ts
export default chain([
  // Only /dashboard and its children.
  [authProxy, "/dashboard/**"],

  // Everything except /login.
  [adminProxy, { exclude: "/admin/login" }],

  // RegExp works too.
  [privateProxy, { exclude: /^\/public(\/.*)?$/ }],

  // Several patterns and a host.
  [billingProxy, { include: { host: "app.example.com", path: ["/billing/**", "/invoices/**"] } }],
]);
```

Path patterns:

- `*` matches one segment: `/api/*` matches `/api/users`, not `/api/users/123`.
- `**` matches any depth, including zero segments: `/docs/**` matches `/docs` and `/docs/a/b`.
- `:name` matches one segment and does not capture a value.
- A RegExp is matched against the decoded path. Anchor it with `^` and `$` for an exact match.

Segments are compared whole. `/tenant` does not match `/tenant-other`. A pattern such as `/files/*.pdf` throws when the chain is created, because wildcards must be whole segments.

## Context: data shared along the chain

The context is a `Map` that exists for one request. A handler stores a value with `ctx.set`, and a later handler reads it with `ctx.get`:

```ts
import { chain, defineHandler, next } from "@klnap/next-proxy-chain";
import { NextResponse } from "next/server";

type Session = { user: string };

// Sets the value.
const readSession = defineHandler({
  name: "read-session",
  handler: (request, _event, context) => {
    const user = request.cookies.get("user")?.value;
    if (user) context.set("session", { user });
    return next();
  },
});

// Reads the value.
const requireUser = defineHandler({
  name: "require-user",
  handler: (request, _event, context) => {
    const session = context.get("session") as Session | undefined;
    if (!session) return NextResponse.redirect(new URL("/login", request.url));
    return next();
  },
});

export default chain([readSession, [requireUser, "/dashboard/**"]]);
```

- Each request has its own map. Values never leak between requests.
- `ctx.get` returns `unknown`, so cast it to the type you stored.
- Rules run in array order. Set the value before the rule that reads it.
- A native handler reads the same map through its third argument: `(request, event, ctx)`.

### Optional: `createContext`

`createContext` creates the context object yourself. Use it when every rule should start with the same typed object, such as a request ID:

```ts
type Ctx = { requestId: string };

export default chain([requestLog, authProxy], {
  createContext: (req): Ctx => ({
    requestId: req.headers.get("x-request-id") ?? crypto.randomUUID(),
  }),
});
```

Handlers declared with `defineHandler<Ctx>` need a matching `createContext`. TypeScript reports an error otherwise.

## Continuing and stopping

| A handler returns                                                                      | Effect                                                                                                                      |
| :------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `undefined` or nothing                                                                 | Continue.                                                                                                                   |
| `NextResponse.next()`                                                                  | Continue. Its request-header overrides are kept.                                                                            |
| `NextResponse.rewrite(url)`                                                            | Continue. The rewrite is applied at the end unless a later handler stops.                                                   |
| `NextResponse.redirect(url)`, `NextResponse.json()`, `Response`, `Response.redirect()` | Stop and return that response.                                                                                              |
| `next({ request, headers })`                                                           | Continue, and apply the given headers. This is a library token; plain Next.js handlers should return `NextResponse.next()`. |
| A thrown error or a rejected promise                                                   | Fail closed with `500`, unless `onError` is set.                                                                            |

Stopping is immediate. A handler after a stopping handler does not run, so put checks that must always run before any handler that might answer the request.

Headers and cookies that earlier handlers set are kept on the response that stops the chain. Handlers after it do not contribute.

## Options

`chain(entries, options)` accepts these options:

| Option                                       | Purpose                                                                          |
| :------------------------------------------- | :------------------------------------------------------------------------------- |
| `createContext`                              | Creates the context for each request. Required for typed handlers.               |
| `onError`                                    | Returns a `Response` to stop with, `next()` to continue, or nothing for a `500`. |
| `ruleTimeoutMs`                              | Time limit per handler. `0` (default) disables it.                               |
| `headerMergeStrategy`, `cookieMergeStrategy` | How conflicting response headers and cookies are resolved.                       |
| `requestHeaderPolicy`                        | Which request headers `next({ request })` may set.                               |
| `debug`, `logger`                            | Built-in diagnostics level and its output sink. Debugging defaults to `false`.   |
| `onTrace`                                    | Optional non-blocking callback with one structured trace per request.            |
| `tracePath`                                  | Include the request pathname in diagnostics. Set `false` to omit it.             |
| `strictOverrideCheck`                        | Throw at startup if Next.js does not apply request overrides.                    |
| `hostFolderHeader`                           | Opt-in multi-tenant folder prefix for rewrites.                                  |

The full reference is in [docs/api.md](https://github.com/klnap/next-proxy-chain/blob/main/docs/api.md).

## Debugging and observability

Enable debugging to see how a request moves through the chain, which handlers run, which are skipped, how long they take, and what response the chain ultimately returns.

```ts
export default chain(handlers, {
  debug: true,
});
```

Debug output is off by default, including in development. Set it explicitly:

```ts
export default chain(handlers, {
  debug: process.env.NODE_ENV === "development",
});
```

`debug` accepts `false`, `true`, `'compact'`, `'detailed'`, or `'verbose'`. `true` means `'detailed'`. Compact prints one request summary; detailed adds handler outcomes; verbose adds matching rules and effective timeouts.

Use `defineHandler()` for named handlers with local settings:

```ts
import { chain, defineHandler } from "@klnap/next-proxy-chain";

type Context = { user: string };

const authHandler = defineHandler<Context>({
  name: "auth",
  debug: "verbose",
  timeout: 2000,
  rules: {
    include: ["/dashboard/**", "/account/**"],
    exclude: "/account/login",
  },
  handler: (request, event, context) => authenticate(request, event, context),
});

export default chain([authHandler], { debug: "compact" });
```

Handler settings override chain settings; chain settings override library defaults. An explicit `debug: false` hides that handler's built-in detail. It does not affect execution or `onTrace`. A handler-level detail override can enable output while global debugging is off.

`defineHandler` can also set a local `onError`. It replaces the chain-level error handler for that handler; a local failure does not fall through to the global handler.

Detailed output distinguishes continuation, rewrites, redirects, terminal responses, rule skips, handlers not reached, recovered errors, failures, and timeouts. `NEXT` means Next.js continues routing; it does not claim the application returned HTTP 200.

```text
proxy-chain GET /en/dashboard                          1.48ms
│ ✓ security         continue       0.12ms
│ ✓ session          continue       0.84ms
│ ○ auth             skipped
│   include: /account/** (mismatch)
│   reason: include-mismatch
└ NEXT
```

```text
proxy-chain GET /old-page                              0.42ms
│ ↗ redirects        redirect       0.14ms
│   destination: /new-page
└ REDIRECT 301 /new-page
```

```text
proxy-chain GET /work                                  1.48ms
│ ↪ intl             rewrite        1.07ms
│   destination: /en/work
└ REWRITE /en/work
```

```text
proxy-chain GET /account                              2001.24ms
│ ✓ security         continue       0.08ms
│ × session          timeout        2000.00ms
│   timeout: 2000ms (handler)
│   error policy: chain default
│   deadline: 2000ms
│ – auth             not reached
└ ERROR 500 · timeout 2000ms
```

```text
proxy-chain GET /work                                  4.72ms
│ ✓ security         continue       0.11ms
│ ! analytics        recovered      4.21ms
│   error policy: chain
│ ✓ intl             continue       0.24ms
└ NEXT
```

Compact output is one line:

```text
proxy-chain GET /work → NEXT · 3 executed · 1 skipped · 1.48ms
```

Send traces to any logger without adding a logging dependency:

```ts
export default chain(handlers, {
  onTrace: (trace) => logger.info(trace),
});
```

`onTrace` runs once after each request. The chain does not await it. Synchronous failures and rejected promises are ignored, so logging cannot change the response. The `logger` option replaces the built-in terminal sink; it receives one completed formatted block through `info`. It does not receive every handler event.

Diagnostics omit query strings, headers, bodies, context values, and raw errors. Redirect and rewrite query values are redacted. Set `tracePath: false` when pathnames may contain private data. Names and strings are length-limited and terminal controls are escaped. Color follows `NO_COLOR` first, then `FORCE_COLOR`, then TTY detection; uncertain or non-interactive output stays plain. Unicode symbols fall back to ASCII for C/POSIX or ASCII locales.

When debugging and tracing are both disabled, the chain does not create trace arrays or read a clock for diagnostics. Handler durations include `when` evaluation and error recovery; total duration also includes composition and response finalization, so handler durations need not sum to the total. Cross-process and external sink ordering is not guaranteed.

### Benchmark

Run `bun run bench/diagnostics.bench.ts` to compare disabled diagnostics, output levels, structured traces, formatter cost, and concurrent requests. Set `BENCH_TERMINAL_IO=1` to measure actual console output separately. Results vary by runtime and host; these are local measurements, not performance guarantees.

Sample run: Bun 1.4.4, Node.js 26.13.1, Linux x86_64 under WSL2, Intel Core i3-10105, three handlers, 20,000 measured requests after 1,000 warmups:

| Case                                   | µs/request |
| :------------------------------------- | ---------: |
| Debug disabled                         |       6.61 |
| Compact                                |      11.46 |
| Detailed                               |      14.79 |
| Verbose                                |      20.39 |
| Structured trace                       |      10.29 |
| Detailed, 32 concurrent                |      16.45 |
| Terminal output, compact (10 requests) |      39.63 |

Formatting a collected trace alone took 0.59 µs for compact, 3.19 µs for detailed, and 3.54 µs for verbose.

## Native compatibility

- A plain handler gets `(request, event)`, exactly as in a native `proxy.ts`. `chain()` also passes the request context as an optional third argument, which Next.js never uses.
- `export default chain([...])` is the default export that Next.js expects. Put `export const config = { matcher }` next to it as usual.
- Handlers can be async.
- Handlers returned by other packages work unchanged, if they follow the native signature.

## Documentation

- [Concepts](https://github.com/klnap/next-proxy-chain/blob/main/docs/concepts.md): execution order, continuation, scoping, headers, cookies, errors.
- [Guides](https://github.com/klnap/next-proxy-chain/blob/main/docs/guides.md): recipes for common tasks.
- [API reference](https://github.com/klnap/next-proxy-chain/blob/main/docs/api.md): every export and option.
- [Security](https://github.com/klnap/next-proxy-chain/blob/main/docs/security.md): trust boundaries and safe usage.

Runnable examples are in [`examples/`](https://github.com/klnap/next-proxy-chain/blob/main/examples/).

## Migration

Version 2 removes `proxyChain()`, `defineProxy()`, context-first handler signatures, and manually constructed rule objects. Upgrade with:

1. Install `@klnap/next-proxy-chain@^2.0.0`.
2. Change `proxyChain(options, entries)` to `chain(entries, options)`.
3. Replace `defineProxy(name, (request, context, event) => ...)` with `defineHandler({ name, handler: (request, event, context) => ... })`.
4. Replace callable scopes such as `handler({ include })` with `[handler, { include }]`, or move the scope into `defineHandler({ rules })`.
5. Replace manually constructed `{ run, include, exclude, name }` entries with native functions or `defineHandler()` results.

Version 1.2 remains backward compatible. Keep using it if you cannot migrate yet.

## Compatibility

- Next.js: peer `>=15.0.0`. The test suite runs against Next.js 16.3.2 through a live app. Next.js 15 is covered by integration tests that model its behavior; it has not been run as a live application.
- Node.js `>=20`, Bun `>=1`.
- Next.js 16 runs `proxy.ts` on the Node.js runtime by default. The package uses only Web platform APIs, so it should also run on the Edge runtime for Next.js 15 `middleware.ts`, but that is not tested here.
- Framework-neutral use (Express, Hono) is not supported. The package depends on Next.js request and response semantics.

## Links

- [Changelog](https://github.com/klnap/next-proxy-chain/blob/main/CHANGELOG.md)
- [Issues](https://github.com/klnap/next-proxy-chain/issues)

## License

[MIT](https://github.com/klnap/next-proxy-chain/blob/main/LICENSE)
