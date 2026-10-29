import type {
  BaseProxyRule,
  CompiledScope,
  HostMatcher,
  PathMatcher,
  ProxyPathFilter,
  RouteScopeList,
} from './types'

const RESERVED_FN_NAMES = new Set(['', 'proxy', 'anonymous', 'run', 'next'])

function extractMeaningfulName(value: string | undefined): string | undefined {
  if (!value || RESERVED_FN_NAMES.has(value)) return undefined
  return value
}

/**
 * Strips sticky and global flags (g, y) from RegExp instances.
 * On Edge runtimes, compiled regex instances can be shared across requests;
 * sticky and global flags mutate stateful indices, causing non-deterministic matching.
 */
export function toStatelessRegExp(re: RegExp): RegExp {
  const flags = re.flags.replace(/[gy]/g, '')
  return flags === re.flags ? re : new RegExp(re.source, flags)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `*` in a host string matches exactly one DNS label (`[^.]+`).
 * `*.example.com` matches `foo.example.com`, not `example.com` or `a.b.example.com`.
 */
function hostGlobToRegex(value: string): string {
  return escapeRegex(value.toLowerCase()).replace(/\\\*/g, '[^.]+')
}

/**
 * Builds a compiled Host matcher RegExp from domain names, `*.example.com` wildcards, or regex patterns.
 */
export function host(matcher: HostMatcher): RegExp {
  const list = (Array.isArray(matcher) ? matcher : [matcher]) as (string | RegExp)[]
  const parts = list.map((m: string | RegExp) => {
    if (m instanceof RegExp) return `(?:${toStatelessRegExp(m).source})`
    return `(?:${hostGlobToRegex(m)})`
  })
  return toStatelessRegExp(new RegExp(`^(?:${parts.join('|')})$`, 'i'))
}

function isScopeObject(
  value: object
): value is { host?: HostMatcher; path?: PathMatcher | PathMatcher[] } {
  return 'host' in value || 'path' in value
}

function segmentToRegex(segment: string): string {
  if (segment === '**') return '(?:.*)'
  if (segment === '*') return '[^/]+'
  if (segment.startsWith(':')) return '[^/]+'
  return escapeRegex(segment)
}

function hasEndAnchor(source: string): boolean {
  if (!source.endsWith('$')) return false
  let slashes = 0
  for (let i = source.length - 2; i >= 0 && source[i] === '\\'; i--) slashes++
  return slashes % 2 === 0
}

function compileRegexPath(pattern: RegExp): RegExp {
  let source = pattern.source
  const hasStart = source.startsWith('^')
  const hasEnd = hasEndAnchor(source)
  if (hasStart) source = source.slice(1)
  if (hasEnd) source = source.slice(0, -1)

  const wrapFull = !hasStart && !hasEnd
  const start = hasStart || wrapFull ? '^' : ''
  const end = hasEnd || wrapFull ? '$' : ''

  return toStatelessRegExp(new RegExp(`${start}${source}${end}`, pattern.flags))
}

function compileStringPath(pattern: string): RegExp {
  const normalized = (pattern.startsWith('/') ? pattern : `/${pattern}`).replace(/\/$/, '') || '/'
  const segments = normalized === '/' ? [] : normalized.slice(1).split('/')
  const last = segments[segments.length - 1]
  const trailingStar = last === '*'
  const trailingGlobstar = last === '**'

  let pathPattern: string
  if (normalized === '/') {
    pathPattern = '/'
  } else if (trailingStar) {
    const prefix = segments.slice(0, -1).map(segmentToRegex).join('/')
    pathPattern = prefix ? `/${prefix}/[^/]+` : `/[^/]+`
  } else if (trailingGlobstar) {
    const prefix = segments.slice(0, -1).map(segmentToRegex).join('/')
    pathPattern = prefix ? `/${prefix}(?:/.*)?` : `/(?:.*)?`
  } else {
    pathPattern = `/${segments.map(segmentToRegex).join('/')}`
  }

  return new RegExp(`^${pathPattern}$`)
}

/**
 * Compiles a path pattern (glob string, param pattern, or RegExp) into a stateless regular expression.
 *
 * - `*` — exactly one path segment
 * - `**` — zero or more subsequent segments
 */
export function path(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) return compileRegexPath(pattern)
  return compileStringPath(pattern)
}

export function toPathRegex(matcher: PathMatcher | PathMatcher[]): RegExp {
  const list = (Array.isArray(matcher) ? matcher : [matcher]) as (string | RegExp)[]
  const regexes = list.map((m) => path(m))
  if (regexes.length === 1) return toStatelessRegExp(regexes[0]!)
  return toStatelessRegExp(new RegExp(`(?:${regexes.map((r) => `(?:${r.source})`).join('|')})`))
}

/**
 * Compiles route scoping declarations into normalized regex clauses.
 */
export function compileScopes(input: RouteScopeList | undefined): CompiledScope[] | undefined {
  if (input == null) return undefined
  const list = Array.isArray(input) ? input : [input]

  const compilePath = (matcher: PathMatcher | PathMatcher[]): RegExp => toPathRegex(matcher)

  const compiled: CompiledScope[] = []
  for (const item of list) {
    if (typeof item === 'string' || item instanceof RegExp) {
      compiled.push({ path: compilePath(item) })
      continue
    }
    if (item && typeof item === 'object' && isScopeObject(item)) {
      if (item.host == null && item.path == null) {
        throw new Error('[proxy-chain] scope needs at least `host` or `path`')
      }
      compiled.push({
        host: item.host != null ? host(item.host) : undefined,
        path: item.path != null ? compilePath(item.path) : undefined,
      })
      continue
    }
    throw new Error('[proxy-chain] invalid include/exclude scope')
  }
  return compiled
}

function scopeMatches(pathname: string, hostname: string | null, scope: CompiledScope): boolean {
  if (scope.host) {
    if (!hostname || !scope.host.test(hostname)) return false
  }
  if (scope.path) {
    if (!scope.path.test(pathname)) return false
  }
  return true
}

export function toRule<TFn>(entry: TFn | BaseProxyRule<TFn>): BaseProxyRule<TFn> {
  if (typeof entry === 'function') {
    const name = extractMeaningfulName((entry as { name?: string }).name)
    return name ? { run: entry, name } : { run: entry }
  }

  const rule = entry as BaseProxyRule<TFn>
  const runName =
    typeof rule.run === 'function'
      ? extractMeaningfulName((rule.run as { name?: string }).name)
      : undefined
  const name = extractMeaningfulName(rule.name) ?? runName

  const harden = (scopes: CompiledScope[] | undefined) =>
    scopes?.map((s) => ({
      host: s.host ? toStatelessRegExp(s.host) : undefined,
      path: s.path ? toStatelessRegExp(s.path) : undefined,
    }))

  return {
    ...rule,
    name: name ?? undefined,
    include: harden(rule.include),
    exclude: harden(rule.exclude),
  }
}

export function ruleLabel<TFn>(rule: BaseProxyRule<TFn>, index: number): string {
  const runName =
    typeof rule.run === 'function'
      ? extractMeaningfulName((rule.run as { name?: string }).name)
      : undefined
  return extractMeaningfulName(rule.name) ?? runName ?? `rule#${index}`
}

/**
 * Decorates a proxy entry with declarative path and host inclusion/exclusion filters.
 */
export function withPaths<TFn>(
  entry: TFn | BaseProxyRule<TFn>,
  filter: ProxyPathFilter
): BaseProxyRule<TFn> {
  const base = toRule(entry)
  const include = compileScopes(filter.include)
  const exclude = compileScopes(filter.exclude)
  const name = filter.name ?? base.name
  assertIncludeExcludeNoOverlap(include, exclude, name ?? 'proxy')
  return { run: base.run, include, exclude, name }
}

/**
 * Determines whether a given request matches a rule's scoping constraints.
 */
export function ruleMatches<TFn>(
  pathname: string,
  hostname: string | null,
  rule: BaseProxyRule<TFn>
): boolean {
  if (rule.exclude?.some((scope) => scopeMatches(pathname, hostname, scope))) return false
  if (rule.include && !rule.include.some((scope) => scopeMatches(pathname, hostname, scope))) {
    return false
  }
  return true
}

export function pathMatches<TFn>(pathname: string, rule: BaseProxyRule<TFn>): boolean {
  return ruleMatches(pathname, null, rule)
}

/**
 * Normalizes Host or X-Forwarded-Host header values to lower-case hostname without port.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null
  const first = raw.split(',')[0]?.trim().toLowerCase()
  if (!first) return null
  if (first.startsWith('[')) {
    const end = first.indexOf(']')
    return end === -1 ? first : first.slice(1, end)
  }
  const withoutPort = first.replace(/:\d+$/, '')
  return withoutPort || null
}

function scopeKey(scope: CompiledScope): string {
  return `${scope.host?.source ?? '*'}::${scope.host?.flags ?? ''}|${scope.path?.source ?? '*'}::${scope.path?.flags ?? ''}`
}

/**
 * Validates that an identical scope is not declared simultaneously in include and exclude.
 */
export function assertIncludeExcludeNoOverlap(
  include: CompiledScope[] | undefined,
  exclude: CompiledScope[] | undefined,
  label: string
): void {
  if (!include?.length || !exclude?.length) return
  const excluded = new Set(exclude.map(scopeKey))
  for (const scope of include) {
    if (excluded.has(scopeKey(scope))) {
      throw new Error(
        `[proxy-chain] ${label}: include and exclude share an identical scope. Remove one.`
      )
    }
  }
}
