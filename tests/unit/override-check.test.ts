import { afterEach, describe, expect, it } from 'bun:test'
import type { NextFetchEvent } from 'next/server'
import { NextRequest } from 'next/server'
import {
  assertOverrideMechanismSupported,
  resetOverrideMechanismProbeForTests,
  setOverrideMechanismProbeForTests,
} from '../../src/core/pipeline'
import { proxyChain } from '../../src/index'

afterEach(() => {
  resetOverrideMechanismProbeForTests()
})

describe('assertOverrideMechanismSupported strict cache', () => {
  it('throws on strict=true after strict=false warmed an unsupported cache', () => {
    setOverrideMechanismProbeForTests(() => false)

    expect(assertOverrideMechanismSupported(false)).toBe(false)
    expect(() => assertOverrideMechanismSupported(true)).toThrow(
      /does not support x-middleware-next header overrides/
    )
  })

  it('does not throw on strict=false after strict=true cached unsupported capability', () => {
    setOverrideMechanismProbeForTests(() => false)

    expect(() => assertOverrideMechanismSupported(true)).toThrow(
      /does not support x-middleware-next header overrides/
    )
    expect(assertOverrideMechanismSupported(false)).toBe(false)
  })

  it('runs the probe only once while applying strict on each call', () => {
    let probeCalls = 0
    setOverrideMechanismProbeForTests(() => {
      probeCalls++
      return false
    })

    expect(assertOverrideMechanismSupported(false)).toBe(false)
    expect(() => assertOverrideMechanismSupported(true)).toThrow()
    expect(assertOverrideMechanismSupported(false)).toBe(false)
    expect(probeCalls).toBe(1)
  })
})

describe('proxyChain strictOverrideCheck cache', () => {
  const fakeEvent = {} as NextFetchEvent

  it('throws when strictOverrideCheck=true follows a warmed unsupported cache', () => {
    setOverrideMechanismProbeForTests(() => false)

    expect(() => proxyChain({ strictOverrideCheck: false }, [])).not.toThrow()
    expect(() => proxyChain({ strictOverrideCheck: true }, [])).toThrow(
      /does not support x-middleware-next header overrides/
    )
  })

  it('does not throw when strictOverrideCheck=false reuses cached unsupported capability', () => {
    setOverrideMechanismProbeForTests(() => false)

    expect(() => proxyChain({ strictOverrideCheck: true }, [])).toThrow()
    expect(() => proxyChain({ strictOverrideCheck: false }, [])).not.toThrow()

    const chain = proxyChain({ strictOverrideCheck: false }, [])
    return chain(new NextRequest('http://localhost:3000/'), fakeEvent).then((res) => {
      expect(res.status).toBe(200)
    })
  })
})
