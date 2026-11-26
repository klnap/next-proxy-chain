import type { NextFetchEvent, NextRequest } from "next/server";
import { DEFINED_HANDLER } from "./constants";
import type { HandlerDebugOptions } from "./diagnostics/types";
import { compileScopes } from "./matching";
import type { ProxyContext, HandlerRule } from "./types";

export type DefinedHandler<TContext = ProxyContext> = HandlerRule<TContext> & {
  readonly [DEFINED_HANDLER]: true;
};

/**
 * Defines a native-signature handler with optional chain rules and local settings.
 */
export function defineHandler<TContext = ProxyContext>(
  options: HandlerDebugOptions<TContext>,
): DefinedHandler<TContext> {
  const include = compileScopes(options.rules?.include);
  const exclude = compileScopes(options.rules?.exclude);
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
  };
  return { ...rule, [DEFINED_HANDLER]: true } as DefinedHandler<TContext>;
}
