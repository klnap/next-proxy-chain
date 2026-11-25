import { describe, expect, it } from 'bun:test'
import type { NextFetchEvent } from 'next/server'
import { NextRequest } from 'next/server'
import { RuleTimeoutError, withRuleTimeout } from '../../src/core/timeout'
import { chain as composeChain, defineHandler } from '../../src/index'

describe('Timeout Enforcement', () => {
  it('resolves quickly when execution is within budget', async () => {
    const result = await withRuleTimeout(Promise.resolve('fast-result'), 100, 'fastRule')
    expect(result).toBe('fast-result')
  })

  it('rejects with RuleTimeoutError when operation exceeds timeout budget', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 50))
    await expect(withRuleTimeout(slowPromise, 10, 'slowRule')).rejects.toThrow(RuleTimeoutError)
  })

  it('passes through without timeout when timeoutMs is 0 or negative', async () => {
    const result = await withRuleTimeout(Promise.resolve('unlimited'), 0, 'unlimitedRule')
    expect(result).toBe('unlimited')
  })

  it('throws RangeError synchronously for non-finite timeoutMs', () => {
    const promise = Promise.resolve('ok')
    expect(() => withRuleTimeout(promise, Number.NaN, 'nanRule')).toThrow(RangeError)
    expect(() => withRuleTimeout(promise, Number.POSITIVE_INFINITY, 'infRule')).toThrow(RangeError)
    expect(() => withRuleTimeout(promise, Number.NEGATIVE_INFINITY, 'negInfRule')).toThrow(
      RangeError
    )
  })
})

describe('Timeout through chain', () => {
  const fakeEvent = {} as NextFetchEvent
  const silentLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }

  it('throws RangeError synchronously when ruleTimeoutMs is non-finite', () => {
    expect(() => composeChain([], { ruleTimeoutMs: Number.NaN })).toThrow(RangeError)
    expect(() => composeChain([], { ruleTimeoutMs: Number.POSITIVE_INFINITY })).toThrow(RangeError)
    expect(() => composeChain([], { ruleTimeoutMs: Number.NEGATIVE_INFINITY })).toThrow(RangeError)
  })

  it('returns 500 when a rule exceeds ruleTimeoutMs', async () => {
    const slow = defineHandler({
      name: 'slow',
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80))
        return undefined
      },
    })
    const chain = composeChain([slow], { ruleTimeoutMs: 15, logger: silentLogger })
    const res = await chain(new NextRequest('http://localhost:3000/'), fakeEvent)
    expect(res.status).toBe(500)
  })

  it('does not surface an unhandled rejection after timeout', async () => {
    const late = defineHandler({
      name: 'late',
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60))
        throw new Error('late rejection')
      },
    })
    const chain = composeChain([late], { ruleTimeoutMs: 10, logger: silentLogger })
    const res = await chain(new NextRequest('http://localhost:3000/'), fakeEvent)
    expect(res.status).toBe(500)
    await new Promise((resolve) => setTimeout(resolve, 80))
  })
})
