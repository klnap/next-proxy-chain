import { describe, expect, it } from 'bun:test'
import { NextRequest, NextResponse } from 'next/server'
import { defineProxy, next, proxyChain } from '../../src/index'

describe('Universal Multi-Host & Rewrite Pipeline Stress Test', () => {
  it('executes multi-host routing cleanly without i18n', async () => {
    const multiHostRule = defineProxy('multiHost', (req) => {
      const host = req.headers.get('host')
      if (host === 'api.localhost:3000') {
        return NextResponse.rewrite(new URL(`/api-host${req.nextUrl.pathname}`, req.url))
      }
      if (host === 'admin.localhost:3000') {
        return NextResponse.rewrite(new URL(`/admin-panel${req.nextUrl.pathname}`, req.url))
      }
      return next()
    })

    const chain = proxyChain({}, [multiHostRule])

    // Request 1: api.localhost
    const reqApi = new NextRequest('http://api.localhost:3000/v1/users', {
      headers: { host: 'api.localhost:3000' },
    })
    const resApi = await chain(reqApi, {} as any)
    expect(resApi.headers.get('x-middleware-rewrite')).toBe(
      'http://api.localhost:3000/api-host/v1/users'
    )

    // Request 2: admin.localhost
    const reqAdmin = new NextRequest('http://admin.localhost:3000/dashboard', {
      headers: { host: 'admin.localhost:3000' },
    })
    const resAdmin = await chain(reqAdmin, {} as any)
    expect(resAdmin.headers.get('x-middleware-rewrite')).toBe(
      'http://admin.localhost:3000/admin-panel/dashboard'
    )

    // Request 3: unknown host -> pass through
    const reqUnknown = new NextRequest('http://unknown.localhost:3000/data', {
      headers: { host: 'unknown.localhost:3000' },
    })
    const resUnknown = await chain(reqUnknown, {} as any)
    expect(resUnknown.headers.get('x-middleware-rewrite')).toBeNull()
    expect(resUnknown.headers.get('x-middleware-next')).toBe('1')
  })

  it('composes multiple sequential rules without dropping rewrite targets or headers', async () => {
    const rule1 = defineProxy('rule1', (req) => {
      return NextResponse.rewrite(new URL(`/shop${req.nextUrl.pathname}`, req.url))
    })

    const rule2 = defineProxy('rule2', (req) => {
      expect(req.nextUrl.pathname).toBe('/shop/pl/produkty')
      const translated = req.nextUrl.pathname.replace('/produkty', '/products')
      return NextResponse.rewrite(new URL(translated, req.url))
    })

    const rule3 = defineProxy('rule3', (req) => {
      expect(req.nextUrl.pathname).toBe('/shop/pl/products')
      return next({
        request: { 'x-custom-rule': 'active' },
        headers: { 'x-audit-passed': 'true' },
      })
    })

    const chain = proxyChain({}, [rule1, rule2, rule3])
    const req = new NextRequest('http://shop.localhost:3000/pl/produkty')

    const res = await chain(req, {} as any)
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'http://shop.localhost:3000/shop/pl/products'
    )
    expect(res.headers.get('x-audit-passed')).toBe('true')
  })

  it('handles malformed host headers and port variations', async () => {
    const hostIsolation = defineProxy('isolation', (req) => {
      const host = req.headers.get('host')?.replace(/:\d+$/, '')
      if (host === 'shop.localhost') {
        return NextResponse.rewrite(new URL(`/shop${req.nextUrl.pathname}`, req.url))
      }
      return next()
    })

    const chain = proxyChain({}, [hostIsolation])

    // Host with explicit port
    const reqPort = new NextRequest('http://shop.localhost:8080/cart', {
      headers: { host: 'shop.localhost:8080' },
    })
    const resPort = await chain(reqPort, {} as any)
    expect(resPort.headers.get('x-middleware-rewrite')).toBe('http://shop.localhost:8080/shop/cart')

    // Empty host header
    const reqEmpty = new NextRequest('http://localhost:3000/cart', {
      headers: { host: '' },
    })
    const resEmpty = await chain(reqEmpty, {} as any)
    expect(resEmpty.headers.get('x-middleware-rewrite')).toBeNull()
  })
})
