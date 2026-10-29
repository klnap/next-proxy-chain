import { describe, expect, it } from 'bun:test'
import { path } from '../../src/index'

describe('path() glob and regex contracts', () => {
  it('matches exact paths', () => {
    const re = path('/dashboard')
    expect(re.test('/dashboard')).toBe(true)
    expect(re.test('/dashboard/settings')).toBe(false)
    expect(re.test('/en/dashboard')).toBe(false)
  })

  it('matches root path exactly', () => {
    const re = path('/')
    expect(re.test('/')).toBe(true)
    expect(re.test('/en')).toBe(false)
    expect(re.test('/foo')).toBe(false)
  })

  it('keeps RegExp start and end anchors', () => {
    const re = path(/^\/foo$/)
    expect(re.test('/foo')).toBe(true)
    expect(re.test('/foo/bar')).toBe(false)
    expect(re.test('/x/foo')).toBe(false)
  })

  it('treats trailing * as exactly one segment', () => {
    const re = path('/api/*')
    expect(re.test('/api/users')).toBe(true)
    expect(re.test('/api/users/123')).toBe(false)
    expect(re.test('/api')).toBe(false)
  })

  it('treats trailing ** as zero or more subsequent segments', () => {
    const re = path('/api/**')
    expect(re.test('/api')).toBe(true)
    expect(re.test('/api/users')).toBe(true)
    expect(re.test('/api/users/123')).toBe(true)
  })

  it('matches :id as one path segment', () => {
    const re = path('/users/:id')
    expect(re.test('/users/123')).toBe(true)
    expect(re.test('/users/abc-def')).toBe(true)
    expect(re.test('/users')).toBe(false)
    expect(re.test('/users/123/posts')).toBe(false)
  })

  it('matches RegExp patterns without anchors when unanchored', () => {
    const re = path(/^\/v[0-9]+\/.*/)
    expect(re.test('/v1/users')).toBe(true)
    expect(re.test('/v2/admin/settings')).toBe(true)
    expect(re.test('/users')).toBe(false)
  })
})
