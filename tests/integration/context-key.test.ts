import { describe, expect, it } from 'bun:test'
import { NextRequest, NextResponse } from 'next/server'
import { chain, contextKey, defineProxy, next } from '../../src/index'

const silent = { debug() {}, info() {}, warn() {}, error() {} }
type Session = { user: string }
const session = contextKey<Session>('session')

describe('contextKey: rule-owned typed context', () => {
  it('a rule sets a value that a later rule in the same chain reads, without createContext', async () => {
    const readSession = defineProxy('read-session', (req, ctx) => {
      session.set(ctx, { user: req.cookies.get('user')?.value ?? 'anon' })
      return next()
    })
    const requireUser = defineProxy('require-user', (_req, ctx) => {
      const s = session.get(ctx)
      if (!s || s.user === 'anon') return new Response('no', { status: 401 })
      return next({ headers: { 'x-user': s.user } })
    })
    const h = chain([readSession, [requireUser, '/dashboard/**']], { logger: silent })
    const ok = await h(
      new NextRequest('http://x/dashboard/a', { headers: { cookie: 'user=ada' } }),
      {} as never
    )
    const anon = await h(new NextRequest('http://x/dashboard/a'), {} as never)
    expect(ok.headers.get('x-user')).toBe('ada')
    expect(anon.status).toBe(401)
  })

  it('a native handler reads the value through the third argument', async () => {
    const setIt = defineProxy('set', (_req, ctx) => {
      session.set(ctx, { user: 'grace' })
      return next()
    })
    const native = (_req: NextRequest, _event: unknown, ctx: Parameters<typeof session.get>[0]) =>
      NextResponse.next({ headers: { 'x-user': session.get(ctx)?.user ?? 'none' } } as never)
    const h = chain([setIt, native], { logger: silent })
    const res = await h(new NextRequest('http://x/a'), {} as never)
    expect(res.headers.get('x-user')).toBe('grace')
  })

  it('values do not leak between requests', async () => {
    const write = defineProxy('w', (req, ctx) => {
      if (req.headers.get('x-set')) session.set(ctx, { user: 'ada' })
      return next()
    })
    const read = defineProxy('r', (_req, ctx) =>
      next({ headers: { 'x-has': session.get(ctx) ? 'yes' : 'no' } })
    )
    const h = chain([write, read], { logger: silent })
    expect(
      (
        await h(new NextRequest('http://x/a', { headers: { 'x-set': '1' } }), {} as never)
      ).headers.get('x-has')
    ).toBe('yes')
    expect((await h(new NextRequest('http://x/b'), {} as never)).headers.get('x-has')).toBe('no')
  })

  it('two keys with the same name do not collide', () => {
    const a = contextKey<number>('n')
    const b = contextKey<string>('n')
    const ctx = new Map<unknown, unknown>()
    a.set(ctx as never, 1)
    b.set(ctx as never, 'x')
    expect(a.get(ctx as never)).toBe(1)
    expect(b.get(ctx as never)).toBe('x')
  })
})
