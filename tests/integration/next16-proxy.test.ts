import { describe, expect, it } from 'bun:test'
import type { NextFetchEvent } from 'next/server'
import { NextRequest } from 'next/server'
import { defineProxy, host, next, proxyChain } from '../../src'

const mockEvent = {} as NextFetchEvent

describe('Next.js 16 Integration: proxy.ts cycle', () => {
  it('executes multi-tenant proxy routing seamlessly in Next.js 16 conventions', async () => {
    const multiHostProxy = defineProxy('multiHost', (req, ctx) => {
      const hostname = req.headers.get('host')?.split(':')[0]
      if (hostname === 'admin.platform.com') {
        ctx.set('tenant', 'admin')
        return next({
          request: { 'x-tenant-id': 'admin-portal' },
          headers: { 'x-routed-by': 'next-proxy-chain' },
        })
      }
      if (hostname === 'store.platform.com') {
        ctx.set('tenant', 'store')
        return next({
          request: { 'x-tenant-id': 'ecommerce-store' },
          headers: { 'x-routed-by': 'next-proxy-chain' },
        })
      }
      return next()
    })

    const rateLimitProxy = defineProxy('rateLimit', (_req, ctx) => {
      const tenant = ctx.get('tenant')
      return next({
        headers: { 'x-rate-limit-tier': tenant === 'admin' ? 'unlimited' : 'standard' },
      })
    })

    const proxy = proxyChain([
      multiHostProxy,
      rateLimitProxy({ include: { host: host(['admin.platform.com', 'store.platform.com']) } }),
    ])

    // 1. Admin host request
    const adminReq = new NextRequest('https://admin.platform.com/overview', {
      headers: { host: 'admin.platform.com' },
    })
    const adminRes = await proxy(adminReq, mockEvent)
    expect(adminRes.status).toBe(200)
    expect(adminRes.headers.get('x-routed-by')).toBe('next-proxy-chain')
    expect(adminRes.headers.get('x-rate-limit-tier')).toBe('unlimited')

    // 2. Store host request
    const storeReq = new NextRequest('https://store.platform.com/products', {
      headers: { host: 'store.platform.com' },
    })
    const storeRes = await proxy(storeReq, mockEvent)
    expect(storeRes.status).toBe(200)
    expect(storeRes.headers.get('x-rate-limit-tier')).toBe('standard')
  })
})
