import type { NextFetchEvent, NextRequest, NextResponse } from 'next/server'
import { NEXT } from './constants'

/**
 * Configuration options for chain continuation.
 */
export type NextOptions = {
  /** Request header overrides visible to downstream rules and handlers. */
  request?: HeadersInit
  /** Response headers merged into the final outgoing response. `set-cookie` is extracted as cookies. */
  headers?: HeadersInit
}

/**
 * Continuation token indicating the pipeline should proceed to subsequent rules.
 */
export type NextResult = NextOptions & { readonly [NEXT]: true }

/**
 * Shared state for an individual request pipeline execution.
 * Backed by Map to eliminate prototype-pollution risks.
 */
export type ProxyContext = Map<string, unknown>

export type ProxyResult<TResponse = NextResponse | Response> =
  | TResponse
  | NextResult
  | undefined
  | void

export type PathMatcher = RegExp | string

export type HostMatcher = string | RegExp | readonly (string | RegExp)[]

/**
 * Scoping configuration for rule inclusion or exclusion.
 */
export type RouteScopeInput =
  | PathMatcher
  | {
      host: HostMatcher
      path?: PathMatcher | PathMatcher[]
    }
  | {
      path: PathMatcher | PathMatcher[]
      host?: HostMatcher
    }

export type RouteScopeList = RouteScopeInput | RouteScopeInput[]

/** Compiled route scope evaluated during request execution. */
export type CompiledScope = {
  host?: RegExp
  path?: RegExp
}

export interface BaseProxyRule<TFn> {
  run: TFn
  include?: CompiledScope[]
  exclude?: CompiledScope[]
  name?: string
}

export type ProxyPathFilter = {
  include?: RouteScopeList
  exclude?: RouteScopeList
  name?: string
}

/**
 * A single proxy execution function.
 */
export type ProxyFn<TContext = ProxyContext> = (
  req: NextRequest,
  ctx: TContext,
  event: NextFetchEvent
) =>
  | NextResponse
  | Response
  | NextResult
  | undefined
  | void
  | Promise<NextResponse | Response | NextResult | undefined | void>

export type ProxyRule<TContext = ProxyContext> = BaseProxyRule<ProxyFn<TContext>>

export type DefinedProxy<TContext = ProxyContext> = ProxyFn<TContext> &
  ((filter: ProxyPathFilter) => ProxyRule<TContext>)

export type Entry<TContext = ProxyContext> = ProxyFn<TContext> | ProxyRule<TContext>

export type MergeStrategy =
  | 'last-write-wins'
  | 'first-write-wins'
  | ((key: string, existing: string, incoming: string) => string | null)

export interface EntryWrite {
  ruleIndex: number
  ruleName: string
  items: Map<string, string>
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ChainLogger {
  debug: (metaOrMsg: unknown, maybeMsg?: string) => void
  info: (metaOrMsg: unknown, maybeMsg?: string) => void
  warn: (metaOrMsg: unknown, maybeMsg?: string) => void
  error: (metaOrMsg: unknown, maybeMsg?: string) => void
}

export type PipelineOutcome =
  | { kind: 'passed'; duration: number }
  | { kind: 'next'; duration: number; headers: number }
  | { kind: 'stop'; duration: number; status: number }

export interface RequestHeaderPolicy {
  blocked?: readonly string[]
  allowed?: readonly string[]
}

/**
 * Value returned from `onError`.
 *
 * - `Response` — stop the pipeline and return it
 * - `NextResult` (`next()`) — continue to the next rule (rule-level errors only)
 * - `undefined` / `void` / `null` — fail closed (`500`)
 */
export type OnErrorResult = NextResponse | Response | NextResult | undefined | void | null

export type OnErrorHandler<TContext = ProxyContext> = (
  err: unknown,
  /**
   * 0-based index of the rule that threw.
   * `-1` means the error originated in the pipeline engine after context creation.
   * Engine-level errors cannot continue; only a `Response` is honored.
   */
  ruleIndex: number,
  req: NextRequest,
  ctx: TContext
) => OnErrorResult | Promise<OnErrorResult>

export interface ChainConfig<TContext = ProxyContext> {
  createContext: (req: NextRequest, event: NextFetchEvent) => TContext
  cookieMergeStrategy: MergeStrategy
  /**
   * How conflicting **response** headers from different rules are resolved.
   * Request header overrides always use last-write-wins and ignore this option.
   */
  headerMergeStrategy: MergeStrategy
  onError?: OnErrorHandler<TContext>
  debug: boolean
  logger: ChainLogger
  /** Maximum wall-clock execution time per rule in milliseconds. 0 disables timeout. */
  ruleTimeoutMs: number
  requestHeaderPolicy: RequestHeaderPolicy
  /** Throw an error on startup if the runtime platform does not support request header overrides. */
  strictOverrideCheck?: boolean
  /**
   * Request header name that prefixes rewrites with a physical host folder
   * (multi-tenant `app/(sites)/shop` layouts). Unset = disabled.
   */
  hostFolderHeader?: string
}

export type ProxyChainOptions<TContext = ProxyContext> = Partial<ChainConfig<TContext>>
