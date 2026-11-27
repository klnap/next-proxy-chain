import type { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import type { HandlerContext } from "./context";
import type { DebugLevel, HandlerWhen, TraceCallback } from "./diagnostics/types";

export type PathMatcher = RegExp | string;

export type HostMatcher = string | RegExp | readonly (string | RegExp)[];

/**
 * Scoping configuration for rule inclusion or exclusion.
 */
export type RouteScopeInput =
  | PathMatcher
  | {
      host: HostMatcher;
      path?: PathMatcher | PathMatcher[];
    }
  | {
      path: PathMatcher | PathMatcher[];
      host?: HostMatcher;
    };

export type RouteScopeList = RouteScopeInput | RouteScopeInput[];

/** Compiled route scope evaluated during request execution. */
export type CompiledScope = {
  host?: RegExp;
  path?: RegExp;
};

export interface BaseHandlerRule<TFn, TContext extends object = object> {
  run: TFn;
  include?: CompiledScope[];
  exclude?: CompiledScope[];
  name?: string;
  debug?: DebugLevel;
  timeout?: number;
  when?: HandlerWhen<TContext>;
  onError?: OnErrorHandler<TContext>;
  diagnosticRules?: {
    include?: RouteScopeList;
    exclude?: RouteScopeList;
  };
}

/**
 * A chain handler callback uses `(request, event, context)`. Native Next.js `(request, event)` handlers also work.
 */
export type NativeProxy<TContext extends object = object> = (
  request: NextRequest,
  event: NextFetchEvent,
  /** Request context added by chain(); Next.js continues to pass its native event unchanged. */
  context: HandlerContext<TContext>,
) =>
  | NextResponse
  | Response
  | undefined
  | void
  | Promise<NextResponse | Response | undefined | void>;

/**
 * A single proxy execution function.
 */
export type HandlerFn<TContext extends object = object> = (
  request: NextRequest,
  context: HandlerContext<TContext>,
  event: NextFetchEvent,
) =>
  | NextResponse
  | Response
  | undefined
  | void
  | Promise<NextResponse | Response | undefined | void>;

export type HandlerRule<TContext extends object = object> = BaseHandlerRule<
  HandlerFn<TContext>,
  TContext
>;

export type MergeStrategy =
  | "last-write-wins"
  | "first-write-wins"
  | ((key: string, existing: string, incoming: string) => string | null);

export interface EntryWrite {
  ruleIndex: number;
  ruleName: string;
  items: Map<string, string>;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ChainLogger {
  debug: (metaOrMsg: unknown, maybeMsg?: string) => void;
  info: (metaOrMsg: unknown, maybeMsg?: string) => void;
  warn: (metaOrMsg: unknown, maybeMsg?: string) => void;
  error: (metaOrMsg: unknown, maybeMsg?: string) => void;
}

/**
 * Value returned from `onError`.
 *
 * - `Response` — stop the pipeline and return it
 * - `NextResponse.next()` — continue after an ordinary rule error only
 * - `undefined` / `void` / `null` — fail closed (`500`)
 */
export type OnErrorResult = NextResponse | Response | undefined | void | null;

export type OnErrorHandler<TContext extends object = object> = (
  error: unknown,
  /**
   * 0-based index of the rule that threw.
   * `-1` means the error originated in the pipeline engine.
   * Engine-level errors cannot continue; only a `Response` is honored.
   */
  ruleIndex: number,
  request: NextRequest,
  context: HandlerContext<TContext>,
) => OnErrorResult | Promise<OnErrorResult>;

export type HandlerConfig<TContext extends object = object> = {
  name: string;
  rules?: {
    include?: RouteScopeList;
    exclude?: RouteScopeList;
    when?: HandlerWhen<TContext>;
  };
  timeout?: number;
  debug?: DebugLevel;
  onError?: OnErrorHandler<TContext>;
  handle: NativeProxy<TContext>;
};

export interface ChainConfig<TContext extends object = object> {
  cookieMergeStrategy: MergeStrategy;
  /**
   * How conflicting **response** headers from different rules are resolved.
   * Request header overrides always use last-write-wins and ignore this option.
   */
  headerMergeStrategy: MergeStrategy;
  onError?: OnErrorHandler<TContext>;
  debug: DebugLevel;
  logger: ChainLogger;
  onTrace?: TraceCallback;
  tracePath?: boolean;
  /** Maximum execution time per handler, including its predicate, in milliseconds. 0 disables timeout. */
  timeout: number;
  /** Throw an error on startup if the runtime platform does not support request header overrides. */
  strictOverrideCheck?: boolean;
}

export type ChainOptions<TContext extends object = object> = Partial<ChainConfig<TContext>>;
