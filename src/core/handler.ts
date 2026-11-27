import type { NextFetchEvent, NextRequest } from "next/server";
import type { HandlerContext } from "./context";
import { compileScopes } from "./matching";
import { assertValidTimeout } from "./timeout";
import type { HandlerConfig, HandlerRule } from "./types";

export function assertHandlerConfig<TContext extends object>(
  options: HandlerConfig<TContext>,
): void {
  if (
    !options ||
    typeof options !== "object" ||
    typeof options.name !== "string" ||
    options.name.trim() === "" ||
    typeof options.handle !== "function"
  ) {
    throw new TypeError("[proxy-chain] configured handlers require a non-empty name and handle");
  }
  if ("handler" in options) {
    throw new TypeError(
      "[proxy-chain] configured handler property 'handler' is unsupported; use 'handle'",
    );
  }
  if ("config" in options || "options" in options) {
    throw new TypeError("[proxy-chain] handler configuration must use top-level options");
  }
  assertValidTimeout(options.timeout);
}

export function toHandlerRule<TContext extends object>(
  options: HandlerConfig<TContext>,
): HandlerRule<TContext> {
  assertHandlerConfig(options);
  const { handle } = options;
  const include = compileScopes(options.rules?.include);
  const exclude = compileScopes(options.rules?.exclude);
  return {
    run: (request: NextRequest, context: HandlerContext<TContext>, event: NextFetchEvent) =>
      handle(request, event, context),
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
}

/**
 * Defines a native-signature handler with optional chain rules and local settings.
 */
export function defineHandler<TContext extends object = object>(
  options: HandlerConfig<TContext>,
): HandlerConfig<TContext> {
  assertHandlerConfig(options);
  return options;
}
