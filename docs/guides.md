# Guides

Each recipe is short and links to a runnable file in [`examples/`](../examples/). Read [Concepts](concepts.md) first if you have not yet.

## Protect a set of routes

Scope the rule with `include`. Use `**` so that every route below the prefix is covered.

```ts
import { defineProxy, next, path, proxyChain } from '@klnap/next-proxy-chain'

const requireApiKey = defineProxy('api-key', (req) => {
  if (!req.headers.get('x-api-key')) return new Response('Unauthorized', { status: 401 })
  return next()
})

export default proxyChain([requireApiKey({ include: path('/api/**') })])
```

`/api/**` covers `/api`, `/api/users`, and `/api/users/123`. A pattern such as `/api/*` covers only one segment.

Check the credential itself in your own code before you rely on it. See [Security: Authentication](security.md#authentication). [examples/02](../examples/02-scoped-rules.ts) has a fuller version with an exclusion.

## Exclude public paths

Add `exclude` next to `include`. `exclude` wins when both match.

```ts
requireApiKey({ include: path('/api/**'), exclude: path('/api/public/**') })
```

Make sure the excluded paths are truly public. Anything the exclusion matches skips every check on that rule.

## Limit a rule to one host

```ts
import { host, path } from '@klnap/next-proxy-chain'

adminOnly({ include: { host: host('admin.example.com'), path: path('/settings/**') } })
```

Host matching uses the `host` header. Treat it as routing, not as access control. See [Security: Host matching](security.md#host-matching).

## Add security headers to every response

Put the rule first, so it also runs before any redirect.

```ts
const securityHeaders = defineProxy('security-headers', () =>
  next({
    headers: {
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
    },
  })
)

export default proxyChain([securityHeaders, requireSession({ include: path('/dashboard/**') })])
```

[examples/01](../examples/01-quick-start.ts) shows the complete file.

## Share typed state between rules

Pass `createContext` to type the context. Each request gets a new object.

```ts
type RequestState = { requestId: string; locale?: string }

const trackRequest = defineProxy<RequestState>('track-request', (req, ctx) => {
  ctx.requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  return next({ request: { 'x-request-id': ctx.requestId } })
})

const detectLocale = defineProxy<RequestState>('detect-locale', (req, ctx) => {
  ctx.locale = req.headers.get('accept-language')?.startsWith('pl') ? 'pl' : 'en'
  return next()
})

export default proxyChain({ createContext: (): RequestState => ({ requestId: '' }) }, [
  trackRequest,
  detectLocale,
])
```

Use the context inside the chain. Route handlers cannot read it. To pass a value to a route handler, use a request header, as `trackRequest` does. [examples/03](../examples/03-typed-context.ts) has the complete file.

## Pass a value to route handlers

Use `next({ request })`. The handler reads it with `headers()` or `request.headers`.

```ts
next({ request: { 'x-user-tier': 'free' } })
```

Headers you pass this way go through `requestHeaderPolicy`. By default, `cookie` and `authorization` cannot be set this way. [examples/04](../examples/04-request-and-response-headers.ts) shows which names are dropped.

## Set a response header for the browser

Use `headers`. This is what the browser receives.

```ts
next({ headers: { 'cache-control': 'no-store' } })
```

Request headers and response headers are separate channels. Setting one does not set the other.

Keep proxy response headers to safe values such as `cache-control` and security headers. Next.js advises against setting `Content-Type` from the proxy, because it can break Server Actions and streaming. See [the API notes](api.md#next).

## Redirect old URLs

Return `NextResponse.redirect`. The chain stops, so rules after it do not run.

```ts
const legacyRedirect = defineProxy('legacy-redirect', (req) => {
  if (req.nextUrl.pathname === '/old') {
    return NextResponse.redirect(new URL('/new', req.url), 308)
  }
  return next()
})
```

## Rewrite a path and keep going

Return `NextResponse.rewrite`. The chain continues, and later rules see the new path.

```ts
const localeRewrite = defineProxy('locale-rewrite', (req) => {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/pl/')) return undefined
  return NextResponse.rewrite(new URL(`/pl${pathname}`, req.url))
})

// Without a matcher the rewrite would also run for static files and API routes.
export const config = {
  matcher: ['/((?!_next/static|_next/image|api|favicon.ico).*)'],
}

// Runs for /pl/... only, including requests that were just rewritten to it.
const plOnly = defineProxy('pl-only', () => next({ headers: { 'content-language': 'pl' } }))
```

[examples/05](../examples/05-redirect-and-rewrite.ts) combines a redirect and a rewrite.

## Recover from a failing remote check

Use `onError` for rules that call other services. Return a response that you choose, and do not return `next()` for an access-control rule.

```ts
export default proxyChain(
  {
    ruleTimeoutMs: 500,
    onError: () => new Response('Service unavailable', { status: 503 }),
  },
  [lookupFeatureFlags]
)
```

[examples/06](../examples/06-error-recovery.ts) has the complete file. See [Security: Error recovery](security.md#error-recovery) before you return `next()` from `onError`.

## Compose independent integrations

Export each concern as a factory, and let the app decide the order.

```ts
// lib/proxy/locale.ts
export function createLocaleRule(locales: readonly string[], fallback: string) {
  return defineProxy('locale', (req) => {
    const first = req.nextUrl.pathname.split('/')[1] ?? ''
    if (locales.includes(first)) return next()
    return next({ headers: { 'content-language': fallback } })
  })
}

// proxy.ts
const locale = createLocaleRule(['en', 'pl'], 'en')
export default proxyChain([requestId, maintenance, locale({ include: path('/**') })])
```

Factories keep each integration testable on its own. Share one context type across the integrations so that they type-check against the same `createContext`. [examples/07](../examples/07-composing-rules.ts) shows the complete pattern.

## Log what the chain does

Set `debug: true` to get one line per rule that runs, and warnings for blocked header overrides. Pass a `logger` to send them to your own logging library.

```ts
proxyChain(
  { debug: process.env.NODE_ENV !== 'production', logger: myLogger },
  [...rules]
)
```

Debug output can include path and header names. Turn it off in production unless your logger is set up for that.
