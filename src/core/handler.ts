import type { NextFetchEvent, NextRequest } from 'next/server'
import type { HandlerDebugOptions } from './diagnostics/types'
import { compileScopes } from './matching'
import type { ProxyContext, ProxyRule } from './types'

/**
 * Defines a native-signature handler with optional chain rules and local settings.
 */
export function defineHandler<TContext = ProxyContext>(
  options: HandlerDebugOptions<TContext>
): ProxyRule<TContext> {
  const include = compileScopes(options.rules?.include)
  const exclude = compileScopes(options.rules?.exclude)
  const rule = {
    run: (request: NextRequest, context: TContext, event: NextFetchEvent) =>
      options.handler(request, event, context),
    name: options.name,
    include,
    exclude,
    debug: options.debug,
    timeout: options.timeout,
    when: options.rules?.when,
    onError: options.onError,
    diagnosticRules: {
      include: options.rules?.include,
      exclude: options.rules?.exclude,
    },
  }
  return rule as ProxyRule<TContext>
}
