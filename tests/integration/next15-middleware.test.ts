import { describe, expect, it } from 'bun:test'
import type { NextFetchEvent } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { defineProxy, next, path, proxyChain } from '../../src'

const mockEvent = {} as NextFetchEvent

describe('Next.js 15 Integration: middleware.ts cycle', () => {
  it('executes as a standard Next.js 15 middleware export', async () => {
    const requestIdProxy = defineProxy('requestId', (req) => {
      const id = req.headers.get('x-request-id') ?? 'req_test_15'
      return next({
        request: { 'x-request-id': id },
        headers: { 'x-request-id': id },
      })
    })

    const authProxy = defineProxy('auth', (req) => {
      const cookie = req.cookies.get('auth_session')?.value
      if (!cookie) {
        return NextResponse.redirect(new URL('/login', req.url))
      }
      return next()
    })

    const middleware = proxyChain([requestIdProxy, authProxy({ include: path('/dashboard/*') })])

    // 1. Unauthenticated request to /dashboard -> 307 redirect
    const unauthReq = new NextRequest('https://example.com/dashboard/settings')
    const unauthRes = await middleware(unauthReq, mockEvent)
    expect(unauthRes.status).toBe(307)
    expect(unauthRes.headers.get('location')).toBe('https://example.com/login')
    expect(unauthRes.headers.get('x-request-id')).toBe('req_test_15')

    // 2. Authenticated request to /dashboard -> pass with headers
    const authReq = new NextRequest('https://example.com/dashboard/settings', {
      headers: { cookie: 'auth_session=valid_token' },
    })
    const authRes = await middleware(authReq, mockEvent)
    expect(authRes.status).toBe(200)
    expect(authRes.headers.get('x-request-id')).toBe('req_test_15')

    // 3. Public route -> bypasses authProxy
    const publicReq = new NextRequest('https://example.com/about')
    const publicRes = await middleware(publicReq, mockEvent)
    expect(publicRes.status).toBe(200)
  })
})
