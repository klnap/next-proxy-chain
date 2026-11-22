import { defineProxy, host, next, path, proxyChain } from '@klnap/next-proxy-chain'
import { NextResponse } from 'next/server'

const apiKeyCheck = defineProxy('api-key', (req) => {
  if (!req.headers.get('x-api-key')) {
    return new Response('Unauthorized', { status: 401 })
  }
  return next()
})

const adminOnly = defineProxy('admin-only', (req) => {
  if (!req.cookies.has('admin')) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return next()
})

export default proxyChain([
  // `/api/**` covers /api, /api/users and /api/users/123.
  // `/api/*` would cover exactly one segment, so /api/users/123 would skip the check.
  apiKeyCheck({ include: path('/api/**'), exclude: path('/api/public/**') }),
  // Only for the admin host, and only under /settings.
  adminOnly({ include: { host: host('admin.example.com'), path: path('/settings/**') } }),
])
