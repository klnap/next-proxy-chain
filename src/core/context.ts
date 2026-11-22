import type { ProxyContext } from './types'

/**
 * Creates an isolated per-request context instance.
 * Backed by Map to eliminate prototype pollution risks.
 */
export function createProxyContext(): ProxyContext {
  return new Map<string, unknown>()
}

/** A typed slot in the request context. Create it once at module level, then set and read it from any rule. */
export type ContextKey<T> = {
  readonly name: string
  set(ctx: ProxyContext, value: T): void
  get(ctx: ProxyContext): T | undefined
}

/**
 * Creates a typed key for the request context, without createContext.
 * A rule sets the value, and later rules in the same chain read it. Each key is private to its
 * declaration, so keys with the same name never collide.
 *
 * @example
 * const session = contextKey<Session>('session')
 * // in a rule: session.set(ctx, { user: 'ada' })
 * // in a later rule: session.get(ctx)?.user
 */
export function contextKey<T>(name: string): ContextKey<T> {
  const slot = Symbol(name)
  return {
    name,
    set(ctx, value) {
      ctx.set(slot, value)
    },
    get(ctx) {
      return ctx.get(slot) as T | undefined
    },
  }
}
