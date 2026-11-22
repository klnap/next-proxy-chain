import { defineProxy, next, path, proxyChain } from '@klnap/next-proxy-chain'
import { type NextRequest, NextResponse } from 'next/server'

const apiKeyCheck = defineProxy('api-key', (req) => {
  if (!req.headers.get('x-api-key')) {
    return new Response('Unauthorized', { status: 401 })
  }
  return next()
})

// Placeholder. Replace with a server-side session check (see docs/security.md).
// A cookie that is merely present proves nothing.
function isAdminSession(_req: NextRequest): boolean {
  return false
}

const adminOnly = defineProxy('admin-only', (req) => {
  if (!isAdminSession(req)) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return next()
})

export default proxyChain([
  // `/api/**` covers /api, /api/users and /api/users/123.
  // `/api/*` would cover exactly one segment, so /api/users/123 would skip the check.
  apiKeyCheck({ include: path('/api/**'), exclude: path('/api/public/**') }),
  // Scope by path, not by host. The host header is client-controlled.
  adminOnly({ include: path('/settings/**') }),
])
