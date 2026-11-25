import { chain as composeChain, defineHandler, next, path } from '@klnap/next-proxy-chain'
import { NextResponse } from 'next/server'

// A rewrite keeps the chain going. The next rule sees the rewritten path.
const localeRewrite = defineHandler({
  name: 'locale-rewrite',
  handler: (req) => {
    const { pathname } = req.nextUrl
    if (pathname.startsWith('/pl/')) return undefined
    return NextResponse.rewrite(new URL(`/pl${pathname}`, req.url))
  },
})

// Sees /pl/... because the rewrite above already happened.
const plOnly = defineHandler({
  name: 'pl-only',
  handler: () => next({ headers: { 'content-language': 'pl' } }),
})

// Redirects stop the chain: rules after this one do not run.
const legacyRedirect = defineHandler({
  name: 'legacy-redirect',
  handler: (req) => {
    if (req.nextUrl.pathname === '/old') {
      return NextResponse.redirect(new URL('/new', req.url), 308)
    }
    return next()
  },
})

export default composeChain([legacyRedirect, localeRewrite, [plOnly, { include: path('/pl/**') }]])

// Without a matcher, a locale rewrite would also apply to static files and API routes.
export const config = {
  matcher: ['/((?!_next/static|_next/image|api|favicon.ico).*)'],
}
