import { defineProxy, next, path, proxyChain } from '@klnap/next-proxy-chain'
import { NextResponse } from 'next/server'

// A rewrite keeps the chain going. The next rule sees the rewritten path.
const localeRewrite = defineProxy('locale-rewrite', (req) => {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/pl/')) return undefined
  return NextResponse.rewrite(new URL(`/pl${pathname}`, req.url))
})

// Sees /pl/... because the rewrite above already happened.
const plOnly = defineProxy('pl-only', () => next({ headers: { 'content-language': 'pl' } }))

// Redirects stop the chain: rules after this one do not run.
const legacyRedirect = defineProxy('legacy-redirect', (req) => {
  if (req.nextUrl.pathname === '/old') {
    return NextResponse.redirect(new URL('/new', req.url), 308)
  }
  return next()
})

export default proxyChain([legacyRedirect, localeRewrite, plOnly({ include: path('/pl/**') })])
