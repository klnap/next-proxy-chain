import { describe, expect, it } from 'bun:test'
import type { NextFetchEvent } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { chain, defineProxy, next } from '../../src/index'

const silent = { debug() {}, info() {}, warn() {}, error() {} }
const req = (url: string) => new NextRequest(url)

describe('chain() with native Next.js handlers', () => {
  it('passes (request, event) to a native handler, so event.waitUntil works', async () => {
    const calls: string[] = []
    const analytics = (_req: NextRequest, event: NextFetchEvent) => {
      event.waitUntil(Promise.resolve().then(() => calls.push('waitUntil')))
      return NextResponse.next()
    }
    const handler = chain([analytics], { logger: silent })
    const res = await handler(req('http://localhost/x'), { waitUntil() {} } as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('awaits an async native handler', async () => {
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return undefined
    }
    const handler = chain([slow], { logger: silent })
    const res = await handler(req('http://localhost/x'), {} as never)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('runs a scoped native handler only for matching paths', async () => {
    const auth = (_req: NextRequest) => new Response('denied', { status: 403 })
    const handler = chain([[auth, '/dashboard/**']], { logger: silent })
    expect((await handler(req('http://localhost/dashboard/home'), {} as never)).status).toBe(403)
    expect((await handler(req('http://localhost/about'), {} as never)).status).toBe(200)
  })

  it('accepts an exclude object and a RegExp exclude, Nimpl-style', async () => {
    const auth = () => new Response('denied', { status: 403 })
    const handler = chain([[auth, { exclude: /^\/private(\/.*)?$/ }]], { logger: silent })
    expect((await handler(req('http://localhost/private/x'), {} as never)).status).toBe(200)
    expect((await handler(req('http://localhost/public'), {} as never)).status).toBe(403)
  })

  it('stops at a native redirect and keeps earlier headers', async () => {
    const header = (_req: NextRequest) => next({ headers: { 'x-frame-options': 'DENY' } })
    const redirect = (req: NextRequest) => NextResponse.redirect(new URL('/login', req.url))
    const after = () => new Response('unreachable', { status: 200 })
    const handler = chain([header, redirect, after], { logger: silent })
    const res = await handler(req('http://localhost/x'), {} as never)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/login')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('returns 500 when a native handler throws', async () => {
    const broken = () => {
      throw new Error('boom')
    }
    const handler = chain([broken], { logger: silent })
    expect((await handler(req('http://localhost/x'), {} as never)).status).toBe(500)
  })

  it('an empty chain passes every request through', async () => {
    const handler = chain([], { logger: silent })
    expect(
      (await handler(req('http://localhost/x'), {} as never)).headers.get('x-middleware-next')
    ).toBe('1')
  })

  it('keeps defineProxy context isolated per request and shares it between rules', async () => {
    type Ctx = { user?: string }
    const setUser = defineProxy<Ctx>('set-user', (r, ctx) => {
      ctx.user = r.headers.get('x-user') ?? 'anonymous'
      return next()
    })
    const reportUser = defineProxy<Ctx>('report-user', (_r, ctx) =>
      next({ headers: { 'x-seen-user': ctx.user ?? 'none' } })
    )
    const handler = chain([setUser, reportUser], {
      logger: silent,
      createContext: (): Ctx => ({}),
    })
    const a = await handler(
      new NextRequest('http://localhost/a', { headers: { 'x-user': 'ada' } }),
      {} as never
    )
    const b = await handler(new NextRequest('http://localhost/b'), {} as never)
    expect(a.headers.get('x-seen-user')).toBe('ada')
    expect(b.headers.get('x-seen-user')).toBe('anonymous')
  })

  it('scopes a defineProxy rule with the tuple form', async () => {
    const deny = defineProxy('deny', () => new Response('denied', { status: 403 }))
    const handler = chain([[deny, '/admin/**']], { logger: silent })
    expect((await handler(req('http://localhost/admin/x'), {} as never)).status).toBe(403)
    expect((await handler(req('http://localhost/home'), {} as never)).status).toBe(200)
  })

  it('passes the request context to a native handler as the third argument', async () => {
    type Ctx = { requestId: string }
    const tag = defineProxy<Ctx>('tag', (_r, ctx) => {
      ctx.requestId = 'req-1'
      return next()
    })
    const native = (
      _req: NextRequest,
      event: { waitUntil(p: Promise<unknown>): void },
      ctx: Ctx
    ) => {
      event.waitUntil(Promise.resolve())
      return next({ headers: { 'x-request-id': ctx.requestId } })
    }
    const handler = chain([tag, native], {
      logger: silent,
      createContext: (): Ctx => ({ requestId: '' }),
    })
    const res = await handler(new NextRequest('http://localhost/x'), { waitUntil() {} } as never)
    expect(res.headers.get('x-request-id')).toBe('req-1')
  })

  it('createContext sets a request id at the start that every handler sees', async () => {
    type Ctx = { requestId: string }
    const native = (_req: NextRequest, _event: unknown, ctx: Ctx) =>
      next({ headers: { 'x-request-id': ctx.requestId } })
    const rule = defineProxy<Ctx>('rule', (_r, ctx) =>
      next({ headers: { 'x-seen-id': ctx.requestId } })
    )
    const handler = chain([rule, native], {
      logger: silent,
      createContext: (req): Ctx => ({ requestId: req.headers.get('x-request-id') ?? 'generated' }),
    })
    const withId = await handler(
      new NextRequest('http://localhost/x', { headers: { 'x-request-id': 'abc' } }),
      {} as never
    )
    expect(withId.headers.get('x-request-id')).toBe('abc')
    expect(withId.headers.get('x-seen-id')).toBe('abc')
    const generated = await handler(new NextRequest('http://localhost/y'), {} as never)
    expect(generated.headers.get('x-request-id')).toBe('generated')
  })
})
