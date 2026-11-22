import { describe, expect, it } from 'bun:test'
import { NextRequest, NextResponse } from 'next/server'
import { defineProxy, proxyChain } from '../../src/index'

const hostFolder = { hostFolderHeader: 'x-internal-host-folder' } as const

function rewritePath(res: Response): string {
  const header = res.headers.get('x-middleware-rewrite')
  expect(header).not.toBeNull()
  return new URL(header!).pathname
}

describe('host folder prefix edge cases', () => {
  it('normalizes folder values without a leading slash', async () => {
    const chain = proxyChain(hostFolder, [
      defineProxy('map', () => {
        const headers = new Headers()
        headers.set('x-internal-host-folder', 'shop')
        return NextResponse.next({ request: { headers } })
      }),
    ])

    const res = await chain(
      new NextRequest('http://shop.localhost:3000/dashboard', {
        headers: { host: 'shop.localhost:3000' },
      }),
      {} as any
    )
    expect(rewritePath(res)).toBe('/shop/dashboard')
  })

  it('strips route groups and surrounding slashes from folder values', async () => {
    const chain = proxyChain(hostFolder, [
      defineProxy('map', () => {
        const headers = new Headers()
        headers.set('x-internal-host-folder', '/(sites)/shop/')
        return NextResponse.next({ request: { headers } })
      }),
    ])

    const res = await chain(
      new NextRequest('http://shop.localhost:3000/products', {
        headers: { host: 'shop.localhost:3000' },
      }),
      {} as any
    )
    expect(rewritePath(res)).toBe('/shop/products')
  })

  it('does not double-prefix a rewrite URL already under the folder', async () => {
    const chain = proxyChain(hostFolder, [
      defineProxy('map', () => {
        const headers = new Headers()
        headers.set('x-internal-host-folder', '/shop')
        return NextResponse.next({ request: { headers } })
      }),
      defineProxy('rewrite', () =>
        NextResponse.rewrite(new URL('/shop/pl/products', 'http://shop.localhost:3000'))
      ),
    ])

    const res = await chain(
      new NextRequest('http://shop.localhost:3000/pl/produkty', {
        headers: { host: 'shop.localhost:3000' },
      }),
      {} as any
    )
    expect(rewritePath(res)).toBe('/shop/pl/products')
  })

  it('prefixes a rewrite URL that starts outside the folder', async () => {
    const chain = proxyChain(hostFolder, [
      defineProxy('map', () => {
        const headers = new Headers()
        headers.set('x-internal-host-folder', '/shop')
        return NextResponse.next({ request: { headers } })
      }),
      defineProxy('rewrite', (req) =>
        NextResponse.rewrite(new URL('/pl/products?sort=asc', req.url))
      ),
    ])

    const res = await chain(
      new NextRequest('http://shop.localhost:3000/pl/produkty', {
        headers: { host: 'shop.localhost:3000' },
      }),
      {} as any
    )
    expect(rewritePath(res)).toBe('/shop/pl/products')
    expect(new URL(res.headers.get('x-middleware-rewrite')!).search).toBe('?sort=asc')
  })

  it('maps root requests to a non-root folder', async () => {
    const chain = proxyChain(hostFolder, [
      defineProxy('map', () => {
        const headers = new Headers()
        headers.set('x-internal-host-folder', '/shop')
        return NextResponse.next({ request: { headers } })
      }),
    ])

    const res = await chain(
      new NextRequest('http://shop.localhost:3000/', {
        headers: { host: 'shop.localhost:3000' },
      }),
      {} as any
    )
    expect(rewritePath(res)).toBe('/shop')
  })

  it('does not rewrite pass-through paths when folder normalizes to root', async () => {
    const chain = proxyChain(hostFolder, [
      defineProxy('map', () => {
        const headers = new Headers()
        headers.set('x-internal-host-folder', '/')
        return NextResponse.next({ request: { headers } })
      }),
    ])

    const res = await chain(
      new NextRequest('http://app.localhost:3000/dashboard', {
        headers: { host: 'app.localhost:3000' },
      }),
      {} as any
    )
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
  })
})
