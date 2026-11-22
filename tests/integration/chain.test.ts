import { describe, expect, it } from 'bun:test'
import type { NextFetchEvent } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { assertOverrideMechanismSupported } from '../../src/core/pipeline'
import { defineProxy, next, proxyChain } from '../../src/index'

describe('Proxy Chain Pipeline Integration', () => {
  const fakeEvent = {} as NextFetchEvent

  it('verifies platform override support without errors', () => {
    expect(() => assertOverrideMechanismSupported()).not.toThrow()
  })

  it('threads isolated context and propagates mutated headers between sequential rules', async () => {
    const authRule = defineProxy('auth', (_req, ctx) => {
      ctx.set('userId', 'usr_9921')
      return next({
        request: { 'x-user-id': 'usr_9921' },
        headers: { 'x-auth-applied': 'true' },
      })
    })

    const enrichRule = defineProxy('enrich', (req, ctx) => {
      expect(ctx.get('userId')).toBe('usr_9921')
      expect(req.headers.get('x-user-id')).toBe('usr_9921')
      return next({
        headers: { 'x-enrich-applied': 'true' },
      })
    })

    const chain = proxyChain([authRule, enrichRule])
    const req = new NextRequest('http://localhost:3000/')
    const res = await chain(req, fakeEvent)

    expect(res.headers.get('x-auth-applied')).toBe('true')
    expect(res.headers.get('x-enrich-applied')).toBe('true')
  })

  it('detects NextResponse.next() pass-through with override headers', async () => {
    const externalPassThrough = defineProxy('external', () => {
      return NextResponse.next({
        request: {
          headers: new Headers({ 'x-injected': 'true' }),
        },
      })
    })

    const downstream = defineProxy('downstream', (req) => {
      expect(req.headers.get('x-injected')).toBe('true')
      return new NextResponse('success', { status: 200 })
    })

    const chain = proxyChain([externalPassThrough, downstream])
    const req = new NextRequest('http://localhost:3000/')
    const res = await chain(req, fakeEvent)

    expect(res.status).toBe(200)
    expect(res.headers.has('x-middleware-next')).toBe(false)
  })

  it('handles empty rules array with default pass-through response', async () => {
    const chain = proxyChain([])
    const req = new NextRequest('http://localhost:3000/hello')
    const res = await chain(req, fakeEvent)
    expect(res.status).toBe(200)
  })

  it('handles all rules returning undefined or void cleanly', async () => {
    const noop1 = defineProxy('noop1', () => undefined)
    const noop2 = defineProxy('noop2', () => {})
    const chain = proxyChain([noop1, noop2])
    const req = new NextRequest('http://localhost:3000/hello')
    const res = await chain(req, fakeEvent)
    expect(res.status).toBe(200)
  })

  const silentLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }

  it('catches unhandled rule errors and returns safe 500 status', async () => {
    const failingRule = defineProxy('failing', () => {
      throw new Error('unexpected breakdown')
    })

    const chain = proxyChain({ logger: silentLogger }, [failingRule])
    const req = new NextRequest('http://localhost:3000/')
    const res = await chain(req, fakeEvent)
    expect(res.status).toBe(500)
  })

  it('handles createContext exceptions gracefully with safe 500 status', async () => {
    const normalRule = defineProxy('normal', () => next())
    const chain = proxyChain(
      {
        logger: silentLogger,
        createContext: () => {
          throw new Error('context init failed')
        },
      },
      [normalRule]
    )

    const req = new NextRequest('http://localhost:3000/')
    const res = await chain(req, fakeEvent)
    expect(res.status).toBe(500)
  })

  it('handles onError handler exceptions with safe 500 status', async () => {
    const failingRule = defineProxy('failing', () => {
      throw new Error('initial error')
    })

    const chain = proxyChain(
      {
        logger: silentLogger,
        onError: () => {
          throw new Error('onError failure')
        },
      },
      [failingRule]
    )

    const req = new NextRequest('http://localhost:3000/')
    const res = await chain(req, fakeEvent)
    expect(res.status).toBe(500)
  })

  it('allows onError handler to recover with custom terminal Response', async () => {
    const failingRule = defineProxy('failing', () => {
      throw new Error('unauthorized access')
    })

    const chain = proxyChain(
      {
        onError: (_err) => new NextResponse('Access Denied', { status: 403 }),
      },
      [failingRule]
    )

    const req = new NextRequest('http://localhost:3000/')
    const res = await chain(req, fakeEvent)
    expect(res.status).toBe(403)
  })

  it('fails closed when onError returns nothing', async () => {
    const failing = defineProxy('auth', () => {
      throw new Error('auth failed')
    })
    const downstream = defineProxy('downstream', () => next({ headers: { 'x-leaked': '1' } }))
    const chain = proxyChain(
      {
        logger: silentLogger,
        onError: () => {
          /* logging only */
        },
      },
      [failing, downstream]
    )
    const res = await chain(new NextRequest('http://localhost:3000/'), fakeEvent)
    expect(res.status).toBe(500)
    expect(res.headers.get('x-leaked')).toBeNull()
  })

  it('continues the pipeline when onError returns next()', async () => {
    const failing = defineProxy('flaky', () => {
      throw new Error('transient')
    })
    const downstream = defineProxy('downstream', () => next({ headers: { 'x-recovered': '1' } }))
    const chain = proxyChain({ onError: () => next() }, [failing, downstream])
    const res = await chain(new NextRequest('http://localhost:3000/'), fakeEvent)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-recovered')).toBe('1')
  })

  it('forwards Set-Cookie from next() onto the final response', async () => {
    const one = defineProxy('one', () =>
      next({
        headers: { 'set-cookie': 'session=abc; Path=/' },
      })
    )
    const chain = proxyChain([one])
    const res = await chain(new NextRequest('http://localhost:3000/'), fakeEvent)
    const cookies = res.headers.getSetCookie()
    expect(cookies.some((c) => c.startsWith('session=abc'))).toBe(true)
  })

  it('forwards multiple Set-Cookie values from next()', async () => {
    const cookies = defineProxy('cookies', () =>
      next({
        headers: [
          ['set-cookie', 'a=1; Path=/'],
          ['set-cookie', 'b=2; Path=/'],
        ],
      })
    )
    const chain = proxyChain([cookies])
    const res = await chain(new NextRequest('http://localhost:3000/'), fakeEvent)
    const listed = res.headers.getSetCookie()
    expect(listed.some((c) => c.startsWith('a=1'))).toBe(true)
    expect(listed.some((c) => c.startsWith('b=2'))).toBe(true)
  })

  it('merges Set-Cookie from next() with NextResponse.next() cookies', async () => {
    const viaNext = defineProxy('viaNext', () =>
      next({ headers: { 'set-cookie': 'from-next=1; Path=/' } })
    )
    const viaResponse = defineProxy('viaResponse', () => {
      const res = NextResponse.next()
      res.cookies.set('from-response', '2', { path: '/' })
      return res
    })
    const chain = proxyChain([viaNext, viaResponse])
    const res = await chain(new NextRequest('http://localhost:3000/'), fakeEvent)
    const listed = res.headers.getSetCookie()
    expect(listed.some((c) => c.includes('from-next=1'))).toBe(true)
    expect(listed.some((c) => c.includes('from-response=2'))).toBe(true)
  })

  it('keeps same-name cookies with different Path', async () => {
    const cookies = defineProxy('cookies', () =>
      next({
        headers: [
          ['set-cookie', 'session=foo; Path=/'],
          ['set-cookie', 'session=bar; Path=/admin'],
        ],
      })
    )
    const chain = proxyChain([cookies])
    const res = await chain(new NextRequest('http://localhost:3000/'), fakeEvent)
    const listed = res.headers.getSetCookie()
    expect(listed).toHaveLength(2)
    expect(listed.some((c) => c.startsWith('session=foo'))).toBe(true)
    expect(listed.some((c) => c.startsWith('session=bar') && c.includes('Path=/admin'))).toBe(true)
  })

  it('deletes a header from the terminal response when merge returns null', async () => {
    const first = defineProxy('first', () => next({ headers: { 'x-remove': '1', 'x-keep': '1' } }))
    const terminal = defineProxy(
      'terminal',
      () => new NextResponse('ok', { headers: { 'x-remove': '2', 'x-keep': '2' } })
    )
    const chain = proxyChain(
      {
        headerMergeStrategy: (key, _existing, incoming) => (key === 'x-remove' ? null : incoming),
      },
      [first, terminal]
    )
    const res = await chain(new NextRequest('http://localhost:3000/'), fakeEvent)
    expect(res.headers.get('x-remove')).toBeNull()
    expect(res.headers.get('x-keep')).toBe('2')
  })

  it('does not mutate the original NextRequest on rewrite continuation', async () => {
    const rewriter = defineProxy('rewriter', (req) =>
      NextResponse.rewrite(new URL(`/shop${req.nextUrl.pathname}`, req.url))
    )
    const downstream = defineProxy('downstream', (req) => {
      expect(req.nextUrl.pathname).toBe('/shop/pl/produkty')
      return next()
    })
    const chain = proxyChain([rewriter, downstream])
    const req = new NextRequest('http://shop.localhost:3000/pl/produkty')
    const originalPath = req.nextUrl.pathname
    const res = await chain(req, fakeEvent)
    expect(req.nextUrl.pathname).toBe(originalPath)
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'http://shop.localhost:3000/shop/pl/produkty'
    )
  })

  it('uses createContext as the runtime context type', async () => {
    type Ctx = { user: string }
    const rule = defineProxy<Ctx>('typed', (_req, ctx) => {
      expect(ctx.user).toBe('ada')
      return next({ headers: { 'x-user': ctx.user } })
    })
    const chain = proxyChain({ createContext: (): Ctx => ({ user: 'ada' }) }, [rule])
    const res = await chain(new NextRequest('http://localhost:3000/'), fakeEvent)
    expect(res.headers.get('x-user')).toBe('ada')
  })
})
