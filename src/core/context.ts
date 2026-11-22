import type { ProxyContext } from './types'

/**
 * Creates an isolated per-request context instance.
 * Backed by Map to eliminate prototype pollution risks.
 */
export function createProxyContext(): ProxyContext {
  return new Map<string, unknown>()
}
