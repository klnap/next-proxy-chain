import { DEFAULT_BLOCKED_REQUEST_HEADERS } from './constants'
import type { EntryWrite, MergeStrategy, RequestHeaderPolicy } from './types'

/**
 * Normalizes header keys to lowercase.
 */
function normalizeHeaderName(name: string): string {
  return name.toLowerCase()
}

/**
 * Converts HeadersInit or undefined to a standard Web Headers instance.
 */
export function headersInitToHeaders(init?: HeadersInit): Headers {
  return new Headers(init)
}

/**
 * Compares two Headers instances to determine if overrides contain differences.
 */
export function headersDiffer(base: Headers, overrides: Headers): boolean {
  for (const [key, value] of overrides.entries()) {
    if (base.get(key) !== value) return true
  }
  return false
}

/**
 * Checks whether a request header is permitted to be mutated under the configured policy.
 */
export function isRequestHeaderAllowed(name: string, policy: RequestHeaderPolicy = {}): boolean {
  const key = normalizeHeaderName(name)
  const allowed = new Set((policy.allowed ?? []).map(normalizeHeaderName))
  if (allowed.has(key)) return true
  if (key.startsWith('x-middleware-')) return false
  const blocked = new Set([
    ...DEFAULT_BLOCKED_REQUEST_HEADERS.map(normalizeHeaderName),
    ...(policy.blocked ?? []).map(normalizeHeaderName),
  ])
  return !blocked.has(key)
}

/**
 * Merges new request header overrides into the target Headers instance, filtering prohibited headers.
 */
export function mergeRequestHeaderOverrides(
  target: Headers,
  overrides: Headers,
  policy: RequestHeaderPolicy = {}
): { applied: number; dropped: string[] } {
  const dropped: string[] = []
  let applied = 0
  overrides.forEach((value, key) => {
    if (!isRequestHeaderAllowed(key, policy)) {
      dropped.push(key)
      return
    }
    target.set(key, value)
    applied++
  })
  return { applied, dropped }
}

/**
 * Extracts cookie name from a raw Set-Cookie directive.
 */
export function parseCookieName(setCookie: string): string {
  const eq = setCookie.indexOf('=')
  return (eq === -1 ? setCookie : setCookie.slice(0, eq)).trim()
}

/**
 * Extracts all Set-Cookie directives using standard getSetCookie() when available.
 * Fallback treats the combined header as a single cookie so `Expires=Wed, 21 Oct ...` is not split.
 */
export function listSetCookie(headers: Headers): string[] {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

function cookieAttribute(setCookie: string, name: string): string {
  const parts = setCookie.split(';')
  for (let i = 1; i < parts.length; i++) {
    const piece = parts[i]
    if (!piece) continue
    const eq = piece.indexOf('=')
    const key = (eq === -1 ? piece : piece.slice(0, eq)).trim().toLowerCase()
    if (key !== name) continue
    return (eq === -1 ? '' : piece.slice(eq + 1)).trim()
  }
  return ''
}

/** Identity key so the same cookie name with a different Path or Domain is not collapsed. */
export function cookieIdentityKey(setCookie: string): string {
  const name = parseCookieName(setCookie)
  const path = cookieAttribute(setCookie, 'path')
  const domain = cookieAttribute(setCookie, 'domain').toLowerCase()
  return `${name};domain=${domain};path=${path}`
}

/**
 * Maps Set-Cookie directives by name + domain + path.
 */
export function cookieItemsFromHeaders(headers: Headers): Map<string, string> {
  const map = new Map<string, string>()
  for (const value of listSetCookie(headers)) {
    map.set(cookieIdentityKey(value), value)
  }
  return map
}

/**
 * Filters out Set-Cookie and internal transport headers (x-middleware-*) from response headers.
 */
export function responseHeaderItems(headers: Headers): Map<string, string> {
  const map = new Map<string, string>()
  headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'set-cookie') return
    if (
      lower.startsWith('x-middleware-next') ||
      lower.startsWith('x-middleware-rewrite') ||
      lower.startsWith('x-middleware-override-headers') ||
      lower.startsWith('x-middleware-request-')
    ) {
      return
    }
    map.set(key, value)
  })
  return map
}

/**
 * Decodes Next.js request header overrides encoded into response headers.
 */
export function decodeOverriddenRequestHeaders(headers: Headers): Headers {
  const result = new Headers()
  const overrideHeaderNames = headers.get('x-middleware-override-headers')
  if (overrideHeaderNames) {
    for (const name of overrideHeaderNames.split(',')) {
      const trimmed = name.trim()
      const val = headers.get(`x-middleware-request-${trimmed}`)
      if (val !== null) {
        result.set(trimmed, val)
      }
    }
  }
  return result
}

/**
 * Deterministically merges writes across rules based on configured strategy.
 */
export function mergeWrites(
  writes: EntryWrite[],
  strategy: MergeStrategy,
  onConflict?: (key: string, winner: string, loser: string) => void
): Map<string, string> {
  const resolved = new Map<string, string>()
  const setBy = new Map<string, string>()

  for (const write of writes) {
    for (const [key, value] of write.items) {
      const existing = resolved.get(key)
      if (existing === undefined) {
        resolved.set(key, value)
        setBy.set(key, write.ruleName)
        continue
      }

      const previousRule = setBy.get(key)!

      if (typeof strategy === 'function') {
        const result = strategy(key, existing, value)
        if (result === null || result === undefined) resolved.delete(key)
        else resolved.set(key, result)
        setBy.set(key, write.ruleName)
        continue
      }

      if (strategy === 'first-write-wins') {
        onConflict?.(key, previousRule, write.ruleName)
        continue
      }

      onConflict?.(key, write.ruleName, previousRule)
      resolved.set(key, value)
      setBy.set(key, write.ruleName)
    }
  }

  return resolved
}

/**
 * Applies merged headers and deduplicated cookies onto an outgoing response.
 */
export function applyMergedToResponse(
  res: Response,
  headers: Map<string, string>,
  cookies: Map<string, string>,
  dropHeaders?: Iterable<string>
): void {
  if (dropHeaders) {
    for (const key of dropHeaders) {
      if (!headers.has(key)) res.headers.delete(key)
    }
  }
  for (const [key, value] of headers) {
    res.headers.set(key, value)
  }

  res.headers.delete('set-cookie')
  for (const cookie of cookies.values()) {
    res.headers.append('set-cookie', cookie)
  }
}
