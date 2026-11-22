/**
 * Unique symbol identifying an explicit continue action in the proxy chain pipeline.
 */
export const NEXT: unique symbol = Symbol.for('proxy-chain.next')

/**
 * Protected request headers that cannot be rewritten unless explicitly permitted by policy.
 */
export const DEFAULT_BLOCKED_REQUEST_HEADERS: readonly string[] = Object.freeze([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'cookie',
  'authorization',
  'x-forwarded-host',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
  'x-middleware-next',
  'x-middleware-override-headers',
])
