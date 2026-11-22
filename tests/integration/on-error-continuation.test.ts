import { describe, expect, it } from 'bun:test'
import type { NextFetchEvent } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { defineProxy, next, proxyChain } from '../../src/index'

const silent = { debug() {}, info() {}, warn() {}, error() {} }
const fakeEvent = {} as NextFetchEvent

describe('onError recovery semantics', () => {
  it('treats NextResponse.next() from a rule-level onError as continuation', async () => {
    const boom = defineProxy('boom', () => {
      throw new Error('upstream down')
    })
    const auth = defineProxy('auth', () => new Response('denied', { status: 403 }))
    const handler = proxyChain({ logger: silent, onError: () => NextResponse.next() }, [boom, auth])

    const res = await handler(new NextRequest('http://localhost/admin'), fakeEvent)
    expect(res.status).toBe(403)
  })

  it('still stops on a terminal Response from onError', async () => {
    const boom = defineProxy('boom', () => {
      throw new Error('upstream down')
    })
    const auth = defineProxy('auth', () => new Response('unreachable', { status: 200 }))
    const handler = proxyChain(
      { logger: silent, onError: () => new Response('blocked', { status: 503 }) },
      [boom, auth]
    )

    const res = await handler(new NextRequest('http://localhost/admin'), fakeEvent)
    expect(res.status).toBe(503)
  })

  it('strips Next.js request-override headers from a terminal rule Response', async () => {
    const stop = defineProxy(
      'stop',
      () =>
        new Response(null, {
          status: 302,
          headers: {
            location: '/login',
            'x-middleware-override-headers': 'cookie',
            'x-middleware-request-cookie': 'session=evil',
          },
        })
    )
    const handler = proxyChain({ logger: silent }, [stop])

    const res = await handler(new NextRequest('http://localhost/x'), fakeEvent)
    expect(res.status).toBe(302)
    expect(res.headers.get('x-middleware-override-headers')).toBeNull()
    expect(res.headers.get('x-middleware-request-cookie')).toBeNull()
  })

  it('merges earlier rule headers and cookies into an engine-level onError Response', async () => {
    const setHeaders = defineProxy('headers', () =>
      next({ headers: { 'x-csp': "default-src 'self'", 'set-cookie': 'sid=1; Path=/' } })
    )
    const badRewrite = defineProxy(
      'bad-rewrite',
      () =>
        new Response(null, {
          status: 200,
          headers: { 'x-middleware-rewrite': 'http://[::bad' },
        })
    )
    const handler = proxyChain(
      { logger: silent, onError: () => new Response('recovered', { status: 503 }) },
      [setHeaders, badRewrite]
    )

    const res = await handler(new NextRequest('http://localhost/x'), fakeEvent)
    expect(res.headers.get('x-csp')).toBe("default-src 'self'")
    expect(res.headers.get('set-cookie')).toContain('sid=1')
  })

  it('fails closed when an engine-level onError returns NextResponse.next()', async () => {
    const malformed = defineProxy('malformed', () => true as never)
    const auth = defineProxy('auth', () => new Response('denied', { status: 403 }))
    const handler = proxyChain({ logger: silent, onError: () => NextResponse.next() }, [
      malformed,
      auth,
    ])

    const res = await handler(new NextRequest('http://localhost/admin'), fakeEvent)
    expect(res.status).toBe(500)
  })

  it('strips routing override headers from an onError-recovered Response', async () => {
    const boom = defineProxy('boom', () => {
      throw new Error('upstream down')
    })
    const handler = proxyChain(
      {
        logger: silent,
        onError: () =>
          new Response('Service unavailable', {
            status: 503,
            headers: {
              'x-middleware-override-headers': 'cookie',
              'x-middleware-request-cookie': 'session=evil',
            },
          }),
      },
      [boom]
    )

    const res = await handler(new NextRequest('http://localhost/x'), fakeEvent)
    expect(res.status).toBe(503)
    expect(res.headers.get('x-middleware-request-cookie')).toBeNull()
    expect(res.headers.get('x-middleware-override-headers')).toBeNull()
  })
})
