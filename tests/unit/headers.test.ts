import { describe, expect, it } from 'bun:test'
import {
  applyMergedToResponse,
  cookieIdentityKey,
  cookieItemsFromHeaders,
  decodeOverriddenRequestHeaders,
  headersDiffer,
  headersInitToHeaders,
  isRequestHeaderAllowed,
  listSetCookie,
  mergeRequestHeaderOverrides,
  mergeWrites,
  parseCookieName,
  responseHeaderItems,
} from '../../src/core/headers'

describe('headers: initialization and difference comparison', () => {
  it('converts HeadersInit into Headers instance', () => {
    const headers = headersInitToHeaders({ 'x-version': '1.0.0' })
    expect(headers.get('x-version')).toBe('1.0.0')
  })

  it('detects header differences accurately', () => {
    const base = new Headers({ 'x-trace-id': '123', 'x-env': 'prod' })
    const same = new Headers({ 'x-trace-id': '123' })
    const different = new Headers({ 'x-trace-id': '456' })

    expect(headersDiffer(base, same)).toBe(false)
    expect(headersDiffer(base, different)).toBe(true)
  })
})

describe('headers: request header policy and overrides', () => {
  it('blocks dangerous headers by default', () => {
    const target = new Headers()
    const overrides = new Headers({
      host: 'malicious.com',
      authorization: 'Bearer hacked',
      'x-custom-tenant': 'tenant-1',
    })

    const { applied, dropped } = mergeRequestHeaderOverrides(target, overrides)

    expect(applied).toBe(1)
    expect(dropped).toContain('host')
    expect(dropped).toContain('authorization')
    expect(target.get('host')).toBeNull()
    expect(target.get('authorization')).toBeNull()
    expect(target.get('x-custom-tenant')).toBe('tenant-1')
  })

  it('disallows internal Next.js middleware headers from mutation', () => {
    expect(isRequestHeaderAllowed('x-middleware-next')).toBe(false)
    expect(isRequestHeaderAllowed('x-middleware-override-headers')).toBe(false)
    expect(isRequestHeaderAllowed('x-middleware-request-x-tenant')).toBe(false)
  })

  it('supports custom allowlist exceptions', () => {
    expect(isRequestHeaderAllowed('authorization', { allowed: ['authorization'] })).toBe(true)
  })
})

describe('headers: cookie parsing and deduplication', () => {
  it('extracts cookie names from Set-Cookie headers', () => {
    expect(parseCookieName('session_id=xyz; Path=/; HttpOnly')).toBe('session_id')
    expect(parseCookieName('theme=dark')).toBe('theme')
  })

  it('lists all set-cookie directives', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'a=1; Path=/')
    headers.append('set-cookie', 'b=2; Path=/')

    const cookies = listSetCookie(headers)
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toContain('a=1')
    expect(cookies[1]).toContain('b=2')
  })

  it('collapses the same cookie name + path + domain to last write', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'session=1; Path=/')
    headers.append('set-cookie', 'session=2; Path=/')

    const map = cookieItemsFromHeaders(headers)
    expect(map.size).toBe(1)
    expect([...map.values()][0]).toBe('session=2; Path=/')
  })

  it('keeps the same cookie name when Path differs', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'session=foo; Path=/')
    headers.append('set-cookie', 'session=bar; Path=/admin')

    const map = cookieItemsFromHeaders(headers)
    expect(map.size).toBe(2)
    expect([...map.values()]).toEqual(['session=foo; Path=/', 'session=bar; Path=/admin'])
  })

  it('keeps cookies distinct by name, domain, and path', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'foo=1; Path=/')
    headers.append('set-cookie', 'foo=2; Path=/admin')
    headers.append('set-cookie', 'foo=3; Domain=example.com; Path=/')

    const map = cookieItemsFromHeaders(headers)
    expect(map.size).toBe(3)
    expect([...map.values()]).toEqual([
      'foo=1; Path=/',
      'foo=2; Path=/admin',
      'foo=3; Domain=example.com; Path=/',
    ])
  })

  it('treats cookies without Path as a separate identity from explicit Path=/', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'foo=plain')
    headers.append('set-cookie', 'foo=root; Path=/')

    const map = cookieItemsFromHeaders(headers)
    expect(map.size).toBe(2)
    expect([...map.values()]).toEqual(['foo=plain', 'foo=root; Path=/'])
  })

  it('domain case-insensitive, path case-sensitive', () => {
    const a = cookieIdentityKey('foo=1; Domain=Example.com; Path=/')
    const b = cookieIdentityKey('foo=2; Domain=example.com; Path=/')
    const c = cookieIdentityKey('foo=3; Domain=example.com; Path=/Admin')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('does not split a single Set-Cookie on Expires commas', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'session=1; Path=/; Expires=Wed, 21 Oct 2015 07:28:00 GMT')
    const cookies = listSetCookie(headers)
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toContain('Expires=Wed, 21 Oct 2015')
  })
})

describe('headers: response header filtering and merge', () => {
  it('strips internal transport headers and set-cookie from response headers map', () => {
    const headers = new Headers({
      'x-response-id': 'res-999',
      'x-middleware-next': '1',
      'x-middleware-override-headers': 'x-foo',
      'set-cookie': 'token=secret',
    })

    const items = responseHeaderItems(headers)
    expect(items.has('x-response-id')).toBe(true)
    expect(items.has('x-middleware-next')).toBe(false)
    expect(items.has('x-middleware-override-headers')).toBe(false)
    expect(items.has('set-cookie')).toBe(false)
  })

  it('decodes Next.js request override headers', () => {
    const headers = new Headers({
      'x-middleware-override-headers': 'x-user-id,x-org-id',
      'x-middleware-request-x-user-id': 'usr_abc',
      'x-middleware-request-x-org-id': 'org_xyz',
    })

    const decoded = decodeOverriddenRequestHeaders(headers)
    expect(decoded.get('x-user-id')).toBe('usr_abc')
    expect(decoded.get('x-org-id')).toBe('org_xyz')
  })

  it('merges writes using last-write-wins by default', () => {
    const writes = [
      { ruleIndex: 0, ruleName: 'ruleA', items: new Map([['x-val', 'A']]) },
      { ruleIndex: 1, ruleName: 'ruleB', items: new Map([['x-val', 'B']]) },
    ]

    const result = mergeWrites(writes, 'last-write-wins')
    expect(result.get('x-val')).toBe('B')
  })

  it('merges writes using first-write-wins', () => {
    const writes = [
      { ruleIndex: 0, ruleName: 'ruleA', items: new Map([['x-val', 'A']]) },
      { ruleIndex: 1, ruleName: 'ruleB', items: new Map([['x-val', 'B']]) },
    ]

    const result = mergeWrites(writes, 'first-write-wins')
    expect(result.get('x-val')).toBe('A')
  })

  it('merges writes using custom resolver function', () => {
    const writes = [
      { ruleIndex: 0, ruleName: 'ruleA', items: new Map([['x-val', 'A']]) },
      { ruleIndex: 1, ruleName: 'ruleB', items: new Map([['x-val', 'B']]) },
    ]

    const result = mergeWrites(writes, (_key, existing, incoming) => `${existing};${incoming}`)
    expect(result.get('x-val')).toBe('A;B')
  })

  it('applies merged headers and cookies to outgoing response', () => {
    const res = new Response('OK', {
      headers: { 'x-old': 'old-val', 'set-cookie': 'legacy=1' },
    })

    applyMergedToResponse(
      res,
      new Map([['x-new', 'new-val']]),
      new Map([['session', 'session=new; Path=/']])
    )

    expect(res.headers.get('x-old')).toBe('old-val')
    expect(res.headers.get('x-new')).toBe('new-val')
    expect(res.headers.get('set-cookie')).toBe('session=new; Path=/')
  })
})
