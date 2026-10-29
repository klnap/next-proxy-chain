import { describe, expect, it } from 'bun:test'
import { applyFolderPrefix, physicalFolderPrefix } from '../../src/core/host-folder-prefix'

describe('physicalFolderPrefix', () => {
  it('adds a leading slash and strips surrounding slashes', () => {
    expect(physicalFolderPrefix('shop')).toBe('/shop')
    expect(physicalFolderPrefix('/shop/')).toBe('/shop')
  })

  it('removes Next.js route group segments', () => {
    expect(physicalFolderPrefix('/(sites)/shop/')).toBe('/shop')
  })

  it('normalizes root folder to /', () => {
    expect(physicalFolderPrefix('/')).toBe('/')
  })
})

describe('applyFolderPrefix', () => {
  const base = 'https://example.com'

  it('prefixes pathname when rewrite is outside the folder', () => {
    expect(applyFolderPrefix('/about', '/shop', base)).toBe('https://example.com/shop/about')
  })

  it('does not double-prefix when rewrite already under folder', () => {
    expect(applyFolderPrefix('/shop/item', '/shop', base)).toBe('/shop/item')
  })

  it('prefixes absolute URLs when rewrite parses as URL', () => {
    expect(applyFolderPrefix('/item', '/shop', base)).toBe('https://example.com/shop/item')
  })
})
