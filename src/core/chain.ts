import type { NextFetchEvent, NextRequest } from 'next/server'
import { CONTEXT_RULE } from './constants'
import { proxyChain } from './engine'
import { withPaths } from './matching'
import type {
  ContextRuleEntry,
  DefinedProxy,
  Entry,
  NativeProxy,
  PathMatcher,
  ProxyChainOptions,
  ProxyContext,
  ProxyFn,
  ProxyPathFilter,
  ProxyRule,
  RouteScopeList,
} from './types'

/** Scope for a tuple entry: `[handler, scope]`. A string, RegExp, or array is shorthand for `include`. */
export type ChainScope = Omit<ProxyPathFilter, 'name'> | PathMatcher | readonly PathMatcher[]

/** One entry of chain(): a native handler, a defineProxy() rule, a rule object, or a scoped tuple. */
export type ChainEntry<TContext = ProxyContext> =
  | NativeProxy<TContext>
  | ContextRuleEntry<TContext>
  | ProxyRule<TContext>
  | readonly [NativeProxy<TContext> | ContextRuleEntry<TContext>, ChainScope]

function isContextRule(value: unknown): value is DefinedProxy<ProxyContext> {
  return (
    typeof value === 'function' &&
    (value as unknown as Record<symbol, unknown>)[CONTEXT_RULE] === true
  )
}

function isScopeObject(value: ChainScope): value is Omit<ProxyPathFilter, 'name'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof RegExp) &&
    !Array.isArray(value)
  )
}

function toFilter(scope: ChainScope): ProxyPathFilter {
  if (isScopeObject(scope)) return { include: scope.include, exclude: scope.exclude }
  return { include: scope as RouteScopeList }
}

/** Adapts a native (req, event) handler to the internal (req, ctx, event) rule signature. */
function fromNative(handler: NativeProxy<ProxyContext>): ProxyRule {
  const run: ProxyFn = (req, ctx, event: NextFetchEvent) => handler(req, event, ctx)
  const name = handler.name && handler.name !== 'proxy' ? handler.name : undefined
  return { run, name }
}

function toEntry(entry: ChainEntry<ProxyContext>): Entry<ProxyContext> {
  if (Array.isArray(entry)) {
    const [target, scope] = entry as readonly [
      NativeProxy<ProxyContext> | DefinedProxy<ProxyContext>,
      ChainScope,
    ]
    const filter = toFilter(scope)
    if (isContextRule(target)) return target(filter)
    return withPaths(fromNative(target as NativeProxy<ProxyContext>), filter)
  }
  if (isContextRule(entry)) return entry
  if (typeof entry === 'function') return fromNative(entry as NativeProxy<ProxyContext>)
  return entry as ProxyRule<ProxyContext>
}

/**
 * Composes native Next.js proxy handlers and optional rules into one proxy.
 *
 * - A plain function receives `(request, event)`, exactly like a native `proxy.ts` export.
 * - A `defineProxy()` rule receives `(request, context, event)`.
 * - `[handler, scope]` runs the handler only for matching paths or hosts.
 *
 * @example
 * export default chain([intlProxy, [authProxy, { include: '/dashboard/**' }]])
 */
export function chain(
  entries: readonly ChainEntry<ProxyContext>[],
  options?: ProxyChainOptions<ProxyContext>
): ReturnType<typeof proxyChain>
export function chain<TContext>(
  entries: readonly ChainEntry<TContext>[],
  options: ProxyChainOptions<TContext> & {
    createContext: (req: NextRequest, event: NextFetchEvent) => TContext
  }
): ReturnType<typeof proxyChain>
export function chain<TContext>(
  entries: readonly ChainEntry<TContext>[],
  options?: ProxyChainOptions<TContext>
): ReturnType<typeof proxyChain> {
  const normalized = entries.map((entry) => toEntry(entry as ChainEntry<ProxyContext>))
  return proxyChain((options ?? {}) as ProxyChainOptions<ProxyContext>, normalized)
}
