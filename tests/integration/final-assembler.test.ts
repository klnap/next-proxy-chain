import { describe, expect, it } from 'bun:test'
import { NextRequest, NextResponse } from 'next/server'
import { defineProxy, proxyChain } from '../../src/index'

const hostFolder = { hostFolderHeader: 'x-internal-host-folder' } as const

describe('Final Assembler & Security Sanitization', () => {
  it('sanitizes untrusted client-injected x-internal-* headers when no rule sets them', async () => {
    const chain = proxyChain([
      defineProxy('noop', () => {
        return NextResponse.next()
      }),
    ])

    const req = new NextRequest('http://app.localhost:3000/dashboard', {
      headers: {
        'x-internal-host-folder': '/malicious-folder',
        'x-internal-spoof': 'true',
        host: 'app.localhost:3000',
      },
    })

    const res = await chain(req, {} as any)
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('does not treat x-internal-host-folder as routing unless hostFolderHeader is set', async () => {
    const chain = proxyChain([
      defineProxy('multiHost', () => {
        const headers = new Headers()
        headers.set('x-internal-host-folder', '/web-app')
        return NextResponse.next({ request: { headers } })
      }),
    ])

    const req = new NextRequest('http://app.localhost:3000/dashboard', {
      headers: { host: 'app.localhost:3000' },
    })
    const res = await chain(req, {} as any)
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('assembles physical path from x-internal-host-folder for pass-through requests', async () => {
    const chain = proxyChain(hostFolder, [
      defineProxy('multiHost', () => {
        const headers = new Headers()
        headers.set('x-internal-host-folder', '/web-app')
        return NextResponse.next({ request: { headers } })
      }),
    ])

    const req = new NextRequest('http://app.localhost:3000/dashboard?tab=analytics#section', {
      headers: { host: 'app.localhost:3000' },
    })

    const res = await chain(req, {} as any)
    const rewriteHeader = res.headers.get('x-middleware-rewrite')
    expect(rewriteHeader).not.toBeNull()
    const parsed = new URL(rewriteHeader!)
    expect(parsed.pathname).toBe('/web-app/dashboard')
    expect(parsed.search).toBe('?tab=analytics')
  })

  it('assembles physical path when upstream rule has already rewritten the URL', async () => {
    const chain = proxyChain(hostFolder, [
      defineProxy('multiHost', () => {
        const headers = new Headers()
        headers.set('x-internal-host-folder', '/(sites)/shop')
        return NextResponse.next({ request: { headers } })
      }),
      defineProxy('i18n', (req) => {
        const target = new URL('/pl/products?sort=asc', req.url)
        return NextResponse.rewrite(target)
      }),
    ])

    const req = new NextRequest('http://shop.localhost:3000/pl/produkty', {
      headers: { host: 'shop.localhost:3000' },
    })

    const res = await chain(req, {} as any)
    const rewriteHeader = res.headers.get('x-middleware-rewrite')
    expect(rewriteHeader).not.toBeNull()
    const parsed = new URL(rewriteHeader!)
    expect(parsed.pathname).toBe('/shop/pl/products')
    expect(parsed.search).toBe('?sort=asc')
  })

  it("handles root path '/' gracefully for both mapped and unmapped hosts", async () => {
    const chain = proxyChain(hostFolder, [
      defineProxy('multiHost', (req) => {
        if (req.headers.get('host')?.includes('shop')) {
          const headers = new Headers()
          headers.set('x-internal-host-folder', '/shop')
          return NextResponse.next({ request: { headers } })
        }
        return NextResponse.next()
      }),
    ])

    // Mapped host
    const req1 = new NextRequest('http://shop.localhost:3000/', {
      headers: { host: 'shop.localhost:3000' },
    })
    const res1 = await chain(req1, {} as any)
    const parsed1 = new URL(res1.headers.get('x-middleware-rewrite')!)
    expect(parsed1.pathname).toBe('/shop')

    // Unmapped host
    const req2 = new NextRequest('http://standalone.localhost:3000/', {
      headers: { host: 'standalone.localhost:3000' },
    })
    const res2 = await chain(req2, {} as any)
    expect(res2.headers.get('x-middleware-rewrite')).toBeNull()
  })
})
