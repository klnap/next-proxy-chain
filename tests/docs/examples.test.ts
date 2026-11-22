import { afterAll, describe, expect, it } from 'bun:test'
import type { NextFetchEvent } from 'next/server'
import { NextRequest } from 'next/server'
import quickStart, { config } from '../../examples/01-quick-start'
import scoped from '../../examples/02-scoped-rules'
import typed from '../../examples/03-typed-context'
import headers from '../../examples/04-request-and-response-headers'
import redirectRewrite from '../../examples/05-redirect-and-rewrite'
import errorRecovery from '../../examples/06-error-recovery'
import composed from '../../examples/07-composing-rules'

const event = {} as NextFetchEvent
const req = (url: string, init?: { headers?: Record<string, string> }) => new NextRequest(url, init)

describe('documentation examples', () => {
  it('01 quick start: security header survives a login redirect', async () => {
    const redirected = await quickStart(req('http://localhost/dashboard'), event)
    expect(redirected.status).toBe(307)
    expect(redirected.headers.get('location')).toBe('http://localhost/login')
    expect(redirected.headers.get('x-frame-options')).toBe('DENY')

    const allowed = await quickStart(
      req('http://localhost/dashboard', { headers: { cookie: 'session=abc' } }),
      event
    )
    expect(allowed.headers.get('x-middleware-next')).toBe('1')
    expect(allowed.headers.get('x-frame-options')).toBe('DENY')
  })

  it('01 quick start: the matcher excludes static assets', () => {
    expect(config.matcher).toHaveLength(1)
    const pattern = new RegExp(`^${config.matcher[0]!}$`)
    expect(pattern.test('/_next/static/app.js')).toBe(false)
    expect(pattern.test('/dashboard')).toBe(true)
  })

  it('02 scoped rules: /api/** covers deep paths, public paths are excluded', async () => {
    const deep = await scoped(req('http://localhost/api/users/123'), event)
    expect(deep.status).toBe(401)

    const withKey = await scoped(
      req('http://localhost/api/users/123', { headers: { 'x-api-key': 'k' } }),
      event
    )
    expect(withKey.headers.get('x-middleware-next')).toBe('1')

    const publicPath = await scoped(req('http://localhost/api/public/status'), event)
    expect(publicPath.headers.get('x-middleware-next')).toBe('1')
  })

  it('02 scoped rules: the admin rule redirects without a verified session, on any host', async () => {
    const onAdmin = await scoped(
      req('http://admin.example.com/settings/profile', { headers: { host: 'admin.example.com' } }),
      event
    )
    expect(onAdmin.status).toBe(307)

    const onOther = await scoped(req('http://www.example.com/settings/profile'), event)
    expect(onOther.status).toBe(307)
  })

  it('03 typed context: generated request id is passed downstream', async () => {
    const res = await typed(req('http://localhost/'), event)
    const id = res.headers.get('x-middleware-request-x-request-id')
    expect(id).toBeTruthy()
    expect(res.headers.get('x-middleware-request-x-request-id')).toBe(id)
  })

  it('04 headers: request override is forwarded, cookie override is dropped', async () => {
    const res = await headers(req('http://localhost/'), event)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-middleware-request-x-user-tier')).toBe('free')
    expect(res.headers.get('x-middleware-request-cookie')).toBeNull()
  })

  it('05 redirect and rewrite: redirect stops, rewrite continues into later rules', async () => {
    const redirect = await redirectRewrite(req('http://localhost/old'), event)
    expect(redirect.status).toBe(308)
    expect(redirect.headers.get('location')).toBe('http://localhost/new')

    const rewritten = await redirectRewrite(req('http://localhost/about'), event)
    expect(rewritten.headers.get('x-middleware-rewrite')).toContain('/pl/about')
    expect(rewritten.headers.get('content-language')).toBe('pl')
  })

  describe('06 error recovery', () => {
    const originalFetch = globalThis.fetch
    afterAll(() => {
      globalThis.fetch = originalFetch
    })

    it('failing remote lookup returns 503 through onError', async () => {
      globalThis.fetch = (async () =>
        new Response('down', { status: 500 })) as unknown as typeof fetch
      const res = await errorRecovery(req('http://localhost/'), event)
      expect(res.status).toBe(503)
    })

    it('successful remote lookup continues', async () => {
      globalThis.fetch = (async () =>
        new Response('{}', { status: 200 })) as unknown as typeof fetch
      const res = await errorRecovery(req('http://localhost/'), event)
      expect(res.headers.get('x-middleware-next')).toBe('1')
    })
  })

  it('07 composing rules: integrations run in the order the app lists them', async () => {
    const res = await composed(req('http://localhost/about'), event)
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(res.headers.get('content-language')).toBe('en')
    expect(res.headers.get('x-middleware-request-x-request-id')).toBeTruthy()
  })
})
