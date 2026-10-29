import { describe, expect, it } from 'bun:test'
import {
  assertIncludeExcludeNoOverlap,
  compileScopes,
  host,
  normalizeHost,
  path,
  pathMatches,
  ruleMatches,
  toRule,
  toStatelessRegExp,
  withPaths,
} from '../../src/core/matching'

describe('Scope Matching & Host Normalization', () => {
  it('matches path-only scopes across any hostname', () => {
    const include = compileScopes(path('/admin/*'))!
    const rule = toRule({ run: () => undefined, include })
    expect(ruleMatches('/admin/users', 'shop.localhost', rule)).toBe(true)
    expect(ruleMatches('/admin/settings', 'museum.localhost', rule)).toBe(true)
    expect(ruleMatches('/public', 'shop.localhost', rule)).toBe(false)
  })

  it('evaluates host and path combinations with OR widening', () => {
    const include = compileScopes([
      path('/health'),
      { host: 'shop.localhost', path: '/checkout/*' },
    ])!
    const rule = toRule({ run: () => undefined, include })
    expect(ruleMatches('/health', 'museum.localhost', rule)).toBe(true)
    expect(ruleMatches('/checkout/cart', 'shop.localhost', rule)).toBe(true)
    expect(ruleMatches('/checkout/cart', 'museum.localhost', rule)).toBe(false)
  })

  it('evaluates host-only scopes across any pathname', () => {
    const include = compileScopes({ host: 'shop.localhost' })!
    const rule = toRule({ run: () => undefined, include })
    expect(ruleMatches('/any/route', 'shop.localhost', rule)).toBe(true)
    expect(ruleMatches('/any/route', 'app.localhost', rule)).toBe(false)
  })

  it('ensures exclusion rules take precedence over inclusion rules', () => {
    const rule = toRule({
      run: () => undefined,
      include: compileScopes(path('/admin/*')),
      exclude: compileScopes({ host: 'museum.localhost', path: '/admin/*' }),
    })
    expect(ruleMatches('/admin/metrics', 'shop.localhost', rule)).toBe(true)
    expect(ruleMatches('/admin/metrics', 'museum.localhost', rule)).toBe(false)
  })

  it('throws an error when include and exclude define identical scopes', () => {
    const scope = compileScopes(path('/admin'))!
    expect(() => assertIncludeExcludeNoOverlap(scope, scope, 'authRule')).toThrow(/identical scope/)
  })

  it('scopes a rule cleanly using withPaths wrapper', () => {
    const scoped = withPaths(() => undefined, {
      include: path('/api/*'),
      name: 'apiRule',
    })
    expect(scoped.name).toBe('apiRule')
    expect(ruleMatches('/api/users', null, scoped)).toBe(true)
    expect(ruleMatches('/web', null, scoped)).toBe(false)
  })

  it('matches exact host strings and arrays of host patterns', () => {
    expect(host('shop.localhost').test('shop.localhost')).toBe(true)
    expect(host(['shop.localhost', 'app.localhost']).test('app.localhost')).toBe(true)
    expect(host('shop.localhost').test('other.localhost')).toBe(false)
  })

  it('matches `*.example.com` as a single DNS label wildcard', () => {
    const re = host('*.example.com')
    expect(re.test('foo.example.com')).toBe(true)
    expect(re.test('bar.example.com')).toBe(true)
    expect(re.test('example.com')).toBe(false)
    expect(re.test('foo.bar.example.com')).toBe(false)
    expect(re.test('evilfoo.example.com')).toBe(true)
  })

  it('normalizes hostnames, stripping port declarations and brackets', () => {
    expect(normalizeHost('App.Example.COM:443')).toBe('app.example.com')
    expect(normalizeHost('[2001:db8::1]:3000')).toBe('2001:db8::1')
    expect(normalizeHost('')).toBeNull()
    expect(normalizeHost(undefined)).toBeNull()
  })

  it('strips stateful sticky and global flags to ensure stateless regex execution', () => {
    const regexWithFlags = /test/gy
    const stateless = toStatelessRegExp(regexWithFlags)
    expect(stateless.flags.includes('g')).toBe(false)
    expect(stateless.flags.includes('y')).toBe(false)
  })

  it('runs raw RegExp scopes through path() so anchors apply', () => {
    const include = compileScopes(/^\/exact$/)!
    const rule = toRule({ run: () => undefined, include })
    expect(ruleMatches('/exact', null, rule)).toBe(true)
    expect(ruleMatches('/exact/no', null, rule)).toBe(false)
    expect(ruleMatches('/x/exact', null, rule)).toBe(false)
  })

  it('provides helper pathMatches for host-agnostic validation', () => {
    const rule = toRule({
      run: () => undefined,
      include: compileScopes(path('/dashboard')),
    })
    expect(pathMatches('/dashboard', rule)).toBe(true)
    expect(pathMatches('/login', rule)).toBe(false)
  })
})
