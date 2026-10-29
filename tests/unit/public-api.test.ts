import { describe, expect, it } from 'bun:test'
import * as api from '../../src/index'

describe('public API surface', () => {
  it('exports only documented runtime symbols from the package entry', () => {
    expect(Object.keys(api).sort()).toEqual([
      'RuleTimeoutError',
      'createProxyContext',
      'defineProxy',
      'host',
      'isNextResult',
      'next',
      'path',
      'proxyChain',
    ])
  })
})
