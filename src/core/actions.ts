import { NEXT } from './constants'
import type { NextOptions, NextResult } from './types'

/**
 * Creates a continuation action instructing the proxy chain to proceed to subsequent rules.
 *
 * @param options - Optional request and response header mutations.
 * @returns NextResult token indicating pipeline continuation.
 */
export function next(options: NextOptions = {}): NextResult {
  return { [NEXT]: true, ...options }
}

/**
 * Type guard verifying whether a returned value is a proxy continuation token.
 *
 * @param value - Value to test.
 * @returns True if value is a NextResult continuation token.
 */
export function isNextResult(value: unknown): value is NextResult {
  return typeof value === 'object' && value !== null && NEXT in value
}
