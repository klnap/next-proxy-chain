// proxy.ts (Next.js 16) or middleware.ts (Next.js 15)
import { defineProxy, next, path, proxyChain } from '@klnap/next-proxy-chain'
import { NextResponse } from 'next/server'

// Security headers first: a redirect from a later rule would stop the chain
// before this rule runs, and the redirect would go out without the header.
const securityHeaders = defineProxy('security-headers', () =>
  next({ headers: { 'x-frame-options': 'DENY' } })
)

// Presence check only. Verify the session token on the server before protecting real data.
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
