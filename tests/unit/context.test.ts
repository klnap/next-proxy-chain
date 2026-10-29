import { describe, expect, it } from 'bun:test'
import { createProxyContext, isNextResult, next } from '../../src/index'

describe('Context and Action Primitives', () => {
  it('initializes an isolated Map instance as request context', () => {
    const ctx = createProxyContext()
    expect(ctx instanceof Map).toBe(true)
    ctx.set('authId', 'usr_123')
    ctx.set('tenant', 'acme')
    expect(ctx.get('authId')).toBe('usr_123')
    expect(ctx.get('tenant')).toBe('acme')
  })

  it('produces branded next continuation tokens', () => {
    const continuation = next({
      request: { 'x-user': 'test' },
      headers: { 'x-res': 'value' },
    })

    expect(isNextResult(continuation)).toBe(true)
    expect(continuation.request).toEqual({ 'x-user': 'test' })
    expect(continuation.headers).toEqual({ 'x-res': 'value' })
  })

  it('distinguishes next continuation tokens from regular responses and nulls', () => {
    expect(isNextResult(new Response())).toBe(false)
    expect(isNextResult(null)).toBe(false)
    expect(isNextResult(undefined)).toBe(false)
    expect(isNextResult({})).toBe(false)
  })
})
