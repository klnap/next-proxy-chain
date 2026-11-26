import type { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { NEXT } from "./constants";
import type { HandlerContext } from "./context";
import type { DebugLevel, HandlerWhen, TraceCallback } from "./diagnostics/types";

/**
 * Configuration options for chain continuation.
 */
export type NextOptions = {
  /** Request header overrides visible to downstream rules and handlers. */
  request?: HeadersInit;
  /** Response headers merged into the final outgoing response. `set-cookie` is extracted as cookies. */
  headers?: HeadersInit;
};

/**
 * Continuation token indicating the pipeline should proceed to subsequent rules.
 */
export type NextResult = NextOptions & { readonly [NEXT]: true };

export type ProxyResult<TResponse = NextResponse | Response> =
  | TResponse
  | NextResult
  | undefined
  | void;

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

export type HandlerFilter = {
  include?: RouteScopeList;
  exclude?: RouteScopeList;
  name?: string;
};

/**
 * A native Next.js proxy handler: `(request, event)`. Use it in chain() without any wrapper.
 */
export type NativeProxy<TContext extends object = object> = (
  req: NextRequest,
  event: NextFetchEvent,
  /** Request context added by chain(); Next.js continues to pass its native event unchanged. */
  context: HandlerContext<TContext>,
) =>
  | NextResponse
  | Response
  | NextResult
  | undefined
  | void
  | Promise<NextResponse | Response | NextResult | undefined | void>;

/**
 * A single proxy execution function.
 */
export type HandlerFn<TContext extends object = object> = (
  req: NextRequest,
  ctx: HandlerContext<TContext>,
  event: NextFetchEvent,
) =>
  | NextResponse
  | Response
  | NextResult
  | undefined
  | void
  | Promise<NextResponse | Response | NextResult | undefined | void>;

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

export interface RequestHeaderPolicy {
  blocked?: readonly string[];
  allowed?: readonly string[];
}

/**
 * Value returned from `onError`.
 *
 * - `Response` — stop the pipeline and return it
 * - `NextResult` (`next()`) — continue after an ordinary rule error only
 * - `undefined` / `void` / `null` — fail closed (`500`)
 */
export type OnErrorResult = NextResponse | Response | NextResult | undefined | void | null;

export type OnErrorHandler<TContext extends object = object> = (
  err: unknown,
  /**
   * 0-based index of the rule that threw.
   * `-1` means the error originated in the pipeline engine.
   * Engine-level errors cannot continue; only a `Response` is honored.
   */
  ruleIndex: number,
  req: NextRequest,
  ctx: HandlerContext<TContext>,
) => OnErrorResult | Promise<OnErrorResult>;

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
  requestHeaderPolicy: RequestHeaderPolicy;
  /** Throw an error on startup if the runtime platform does not support request header overrides. */
  strictOverrideCheck?: boolean;
}

export type ChainOptions<TContext extends object = object> = Partial<ChainConfig<TContext>>;
