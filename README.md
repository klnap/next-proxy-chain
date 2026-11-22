# @klnap/next-proxy-chain

Compose independent request rules for Next.js `proxy.ts` (or `middleware.ts`) without writing one long function.

Next.js gives each app one `proxy` export. Once that file also checks sessions, sets security headers, picks a locale, and redirects old URLs, the order of those checks matters, and each one has to know about the others. This package lets each concern be its own rule. The rules run in order, can be limited to certain paths or hosts, and share request-scoped state without any global variables.

```ts
import { defineProxy, next, path, proxyChain } from '@klnap/next-proxy-chain'
import { NextResponse } from 'next/server'

const securityHeaders = defineProxy('security-headers', () =>
  next({ headers: { 'x-frame-options': 'DENY' } })
)

const requireSession = defineProxy('require-session', (req) => {
  if (!req.cookies.has('session')) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return next()
})

export default proxyChain([securityHeaders, requireSession({ include: path('/dashboard/**') })])

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

This sets `X-Frame-Options` on every response and sends visitors without a session cookie from `/dashboard` to `/login`. The security header comes first, so it also appears on the redirect.

## Install

```sh
npm install @klnap/next-proxy-chain
# or
bun add @klnap/next-proxy-chain
```

`next` is a peer dependency (`>=15.0.0`). The package has no runtime dependencies.

## When to use it

Use it when one Proxy file needs several independent concerns, for example:

- a session check on some routes and not others,
- security headers on every response,
- a locale rewrite,
- a redirect from old URLs,
- request IDs passed to route handlers.

A single redirect rule does not need it. Write `NextResponse.redirect` directly in `proxy.ts`.

It is a composition layer, not a security product. It does not authenticate users, verify tokens, or replace Next.js routing. It runs the rules you write, in the order you list them.

## How it works

- Rules run in array order. A rule continues by returning `next()` or nothing, and stops the chain by returning a `Response`.
- A rule can be scoped with `include` and `exclude` paths or hosts. Rules that do not match are skipped.
- Headers and cookies set by earlier rules are kept on the final response, unless a later rule overrides them.
- Each request gets its own context. Rules can share values through it without globals.
- Errors and timeouts can be recovered with `onError`. By default they produce a 500.

[Concepts](https://github.com/klnap/next-proxy-chain/blob/main/docs/concepts.md) explains the execution model in full.

## Documentation

- [Concepts](https://github.com/klnap/next-proxy-chain/blob/main/docs/concepts.md): rule order, continuation, scoping, headers, cookies, errors.
- [Guides](https://github.com/klnap/next-proxy-chain/blob/main/docs/guides.md): recipes for common tasks, with links to runnable examples.
- [API reference](https://github.com/klnap/next-proxy-chain/blob/main/docs/api.md): every export and option.
- [Security](https://github.com/klnap/next-proxy-chain/blob/main/docs/security.md): trust boundaries and safe usage.

Runnable examples live in [`examples/`](https://github.com/klnap/next-proxy-chain/blob/main/examples/). They are type-checked and tested in this repository.

## Compatibility

- Next.js: peer `>=15.0.0`. The test suite runs against Next.js 16.3.2. Next.js 15 `middleware.ts` is covered by integration tests that model its behavior, not by a Next.js 15 application.
- Node.js `>=20`, Bun `>=1`.
- Next.js 16 runs `proxy.ts` on the Node.js runtime by default. The package uses only Web platform APIs (`Headers`, `Request`, `Response`, `URL`), so it should also work on the Edge runtime, but that is not tested here.

## Links

- [Changelog](https://github.com/klnap/next-proxy-chain/blob/main/CHANGELOG.md)
- [Issues](https://github.com/klnap/next-proxy-chain/issues)

## License

[MIT](https://github.com/klnap/next-proxy-chain/blob/main/LICENSE)
