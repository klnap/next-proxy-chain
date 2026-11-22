# @klnap/next-proxy-chain

Run several Next.js `proxy.ts` (or `middleware.ts`) handlers as one chain. Each handler can be a plain native Next.js function, scoped to certain paths, and the chain stops or continues according to what each handler returns.

Next.js exports one proxy per app. As soon as the file contains an auth check, a locale redirect, and some security headers, the order matters and the pieces end up in one long function. This package keeps each handler separate and keeps the order visible.

```ts
import { chain } from '@klnap/next-proxy-chain'

export default chain([
  intlProxy,
  [authProxy, '/dashboard/**'],
  securityProxy,
])
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
import { chain } from '@klnap/next-proxy-chain'
import { NextResponse } from 'next/server'

function analytics(request, event) {
  event.waitUntil(sendPageView(request.nextUrl.pathname))
  return NextResponse.next()
}

export default chain([analytics, intlProxy, securityProxy])
```

A handler continues the chain by returning `undefined` or `NextResponse.next()`. A handler stops the chain by returning a `Response`, `NextResponse.redirect()`, `NextResponse.json()`, or `Response.redirect()`. The rest of this page explains each case.

## Scoped handlers

Wrap a handler in a tuple to run it only for some paths or hosts:

```ts
export default chain([
  // Only /dashboard and its children.
  [authProxy, '/dashboard/**'],

  // Everything except /login.
  [adminProxy, { exclude: '/admin/login' }],

  // RegExp works too.
  [privateProxy, { exclude: /^\/public(\/.*)?$/ }],

  // Several patterns and a host.
  [billingProxy, { include: { host: 'app.example.com', path: ['/billing/**', '/invoices/**'] } }],
])
```

Path patterns:

- `*` matches one segment: `/api/*` matches `/api/users`, not `/api/users/123`.
- `**` matches any depth, including zero segments: `/docs/**` matches `/docs` and `/docs/a/b`.
- `:name` matches one segment and does not capture a value.
- A RegExp is matched against the decoded path. Anchor it with `^` and `$` for an exact match.

Segments are compared whole. `/tenant` does not match `/tenant-other`. A pattern such as `/files/*.pdf` throws when the chain is created, because wildcards must be whole segments.

## Context: data shared along the chain

A rule can store a value for the rest of the same request, and any later rule can read it. You do not need `createContext` for this.

Declare a typed key once, and set or read it from any rule:

```ts
import { chain, contextKey, defineProxy, next } from '@klnap/next-proxy-chain'
import { NextResponse } from 'next/server'

type Session = { user: string }

const session = contextKey<Session>('session')

// Sets the value. Rules later in the chain can read it.
const readSession = defineProxy('read-session', (req, ctx) => {
  const user = req.cookies.get('user')?.value
  if (user) session.set(ctx, { user })
  return next()
})

// Reads the value.
const requireUser = defineProxy('require-user', (req, ctx) => {
  if (!session.get(ctx)) return NextResponse.redirect(new URL('/login', req.url))
  return next()
})

export default chain([readSession, [requireUser, '/dashboard/**']])
```

- A value lives for one request. Two requests never see each other's values.
- `session.get(ctx)` returns `Session | undefined`, so the type is known without a cast.
- A native handler reads the same values through its third argument: `(request, event, ctx)`.
- Rules run in array order, so set the value before the rule that reads it.

### When to use `createContext`

Use `createContext` when every rule should start with the same object, such as a request ID created from the incoming request:

```ts
type Ctx = { requestId: string }

export default chain([requestLog, authProxy], {
  createContext: (req): Ctx => ({
    requestId: req.headers.get('x-request-id') ?? crypto.randomUUID(),
  }),
})
```

Rules that expect a context type must be used with a matching `createContext`. TypeScript reports an error otherwise.

## Continuing and stopping

| A handler returns | Effect |
| :--- | :--- |
| `undefined` or nothing | Continue. |
| `NextResponse.next()` | Continue. Its request-header overrides are kept. |
| `NextResponse.rewrite(url)` | Continue. The rewrite is applied at the end unless a later handler stops. |
| `NextResponse.redirect(url)`, `NextResponse.json()`, `Response`, `Response.redirect()` | Stop and return that response. |
| `next({ request, headers })` | Continue, and apply the given headers. This is a library token; plain Next.js handlers should return `NextResponse.next()`. |
| A thrown error or a rejected promise | Fail closed with `500`, unless `onError` is set. |

Stopping is immediate. A handler after a stopping handler does not run, so put checks that must always run before any handler that might answer the request.

Headers and cookies that earlier handlers set are kept on the response that stops the chain. Handlers after it do not contribute.

## Options

`chain(entries, options)` accepts the same options as `proxyChain`:

| Option | Purpose |
| :--- | :--- |
| `createContext` | Creates the context for each request. Required for typed rules. |
| `onError` | Returns a `Response` to stop with, `next()` to continue, or nothing for a `500`. |
| `ruleTimeoutMs` | Time limit per handler. `0` (default) disables it. |
| `headerMergeStrategy`, `cookieMergeStrategy` | How conflicting response headers and cookies are resolved. |
| `requestHeaderPolicy` | Which request headers `next({ request })` may set. |
| `debug`, `logger` | One log line per handler, and a custom logger. |
| `strictOverrideCheck` | Throw at startup if Next.js does not apply request overrides. |
| `hostFolderHeader` | Opt-in multi-tenant folder prefix for rewrites. |

The full reference is in [docs/api.md](https://github.com/klnap/next-proxy-chain/blob/main/docs/api.md).

## Native compatibility

- A plain handler gets `(request, event)`, exactly as in a native `proxy.ts`. `chain()` also passes the request context as an optional third argument, which Next.js never uses.
- `export default chain([...])` is the default export that Next.js expects. Put `export const config = { matcher }` next to it as usual.
- Handlers can be async.
- Handlers returned by other packages work unchanged, if they follow the native signature.

`proxyChain()` is a deprecated alias that is still exported and unchanged. Its plain functions receive `(request, context, event)`. Use `chain()` in new code.

## Documentation

- [Concepts](https://github.com/klnap/next-proxy-chain/blob/main/docs/concepts.md): execution order, continuation, scoping, headers, cookies, errors.
- [Guides](https://github.com/klnap/next-proxy-chain/blob/main/docs/guides.md): recipes for common tasks.
- [API reference](https://github.com/klnap/next-proxy-chain/blob/main/docs/api.md): every export and option.
- [Security](https://github.com/klnap/next-proxy-chain/blob/main/docs/security.md): trust boundaries and safe usage.

Runnable examples are in [`examples/`](https://github.com/klnap/next-proxy-chain/blob/main/examples/).

## Migration

No change is required. `proxyChain()` and `defineProxy()` keep working. To move to `chain()`:

1. Replace `proxyChain(entries)` with `chain(entries)`.
2. Plain functions that used the old `(request, context, event)` signature: rewrite them with `defineProxy()`, which keeps that signature.
3. Replace `path()` and `host()` helpers with strings, arrays, or objects where you like. They still work.

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
