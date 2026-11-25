import type { NextFetchEvent } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'

import { isNextResult } from './actions'
import { createProxyContext } from './context'
import { cookieItemsFromHeaders, headersDiffer, responseHeaderItems } from './headers'
import { applyFolderPrefix, isInsideFolder, physicalFolderPrefix } from './host-folder-prefix'
import { createConsoleLogger } from './logger'
import { formatTrace, shouldUseColor, supportsUnicode } from './diagnostics/formatter'
import { safeDestination, safeDiagnosticText } from './diagnostics/sanitize'
import type {
  ChainOutcome,
  ChainTrace,
  DebugLevel,
  HandlerTrace,
  NormalizedDebugLevel,
} from './diagnostics/types'
import {
  assertIncludeExcludeNoOverlap,
  canonicalPathname,
  normalizeHost,
  ruleLabel,
  ruleMatchReason,
  toRule,
} from './matching'
import {
  assertOverrideMechanismSupported,
  finalizeResponse,
  type ResolvedOutcome,
  resolveRuleResult,
  safeInternalError,
} from './pipeline'
import { assertFiniteRuleTimeoutMs, RuleTimeoutError, withRuleTimeout } from './timeout'
import type {
  ChainConfig,
  ChainLogger,
  BaseHandlerRule,
  EntryWrite,
  NextResult,
  ChainOptions,
  ProxyContext,
  HandlerRule,
  RouteScopeInput,
  RouteScopeList,
} from './types'

function monotonicNow(): number {
  try {
    if (typeof globalThis.performance?.now === 'function') return globalThis.performance.now()
  } catch {
    // Some edge runtimes expose performance but reject access to it.
  }
  return Date.now()
}

function normalizeDebugLevel(level: DebugLevel): NormalizedDebugLevel {
  return level === true ? 'detailed' : level
}

function responseOutcome(response: Response): ChainOutcome {
  const rewrite = response.headers.get('x-middleware-rewrite')
  if (rewrite) {
    return { type: 'rewrite', destination: safeDestination(rewrite) ?? '/' }
  }
  const location = response.headers.get('location')
  if (location && response.status >= 300 && response.status < 400) {
    return {
      type: 'redirect',
      status: response.status,
      destination: safeDestination(location),
    }
  }
  if (response instanceof NextResponse && response.headers.get('x-middleware-next') === '1') {
    return { type: 'next' }
  }
  return { type: 'response', status: response.status }
}

function scopeNames(scopeList: RouteScopeList | undefined): string[] | undefined {
  if (scopeList === undefined) return undefined
  const scopes = Array.isArray(scopeList) ? scopeList : [scopeList]
  return scopes.map((scope) => {
    if (typeof scope === 'string') return safeDiagnosticText(scope, 96)
    if (scope instanceof RegExp) return safeDiagnosticText(scope.toString(), 96)
    if (typeof scope !== 'object' || scope === null) return ''
    const value = scope as Exclude<RouteScopeInput, string | RegExp>
    const parts = [
      value.path === undefined
        ? undefined
        : Array.isArray(value.path)
          ? value.path.map(String).join('|')
          : String(value.path),
      value.host === undefined
        ? undefined
        : Array.isArray(value.host)
          ? value.host.map(String).join('|')
          : String(value.host),
    ].filter(Boolean)
    return safeDiagnosticText(parts.join(' @ '), 96)
  })
}

function handlerDetails<TFn, TContext>(
  rule: BaseHandlerRule<TFn, TContext>,
  chainTimeout: number,
  when: 'matched' | 'false' | 'not-evaluated',
  includeResult?: 'matched' | 'mismatch',
  excludeResult?: 'not-matched' | 'matched'
): HandlerTrace['details'] {
  const include = scopeNames(rule.diagnosticRules?.include)
  const exclude = scopeNames(rule.diagnosticRules?.exclude)
  return {
    ...(include ? { include, includeResult } : {}),
    ...(exclude ? { exclude, excludeResult } : {}),
    ...(rule.when ? { when } : {}),
    timeoutMs: rule.timeout ?? chainTimeout,
    timeoutSource: rule.timeout === undefined ? 'chain' : 'handler',
  }
}

function safeLogger(logger: ChainLogger): ChainLogger {
  const wrap =
    (method: keyof ChainLogger) =>
    (...args: [unknown, string?]) => {
      try {
        const result = logger[method](...args) as unknown
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          void Promise.resolve(result).catch(() => {})
        }
      } catch {
        // Logging integrations must not affect request behavior.
      }
    }
  return {
    debug: wrap('debug'),
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
  }
}

type RuleRaw = NextResponse | Response | NextResult | undefined | void

/** NextResponse.next() sets x-middleware-next; it continues the pipeline. */
function isNextResponse(value: unknown): boolean {
  return value instanceof NextResponse && value.headers.get('x-middleware-next') === '1'
}

/** Terminal responses must not carry Next.js request-override headers into routing. */
function stripRoutingOverrides(res: Response): void {
  // A plain Response is not a Next.js continuation, so every x-middleware-* control header goes.
  const plain = !(res instanceof NextResponse)
  for (const key of [...res.headers.keys()]) {
    const lower = key.toLowerCase()
    if (
      lower === 'x-middleware-override-headers' ||
      lower.startsWith('x-middleware-request-') ||
      (plain && (lower === 'x-middleware-next' || lower === 'x-middleware-rewrite'))
    ) {
      res.headers.delete(key)
    }
  }
}

type ProxyHandler = (req: NextRequest, event: NextFetchEvent) => Promise<NextResponse | Response>

function resolveConfig<TContext>(
  overrides: ChainOptions<TContext>,
  fallbackCreateContext: ChainConfig<TContext>['createContext']
): ChainConfig<TContext> {
  const { logger, debug, createContext, ...rest } = overrides

  const config = {
    createContext: createContext ?? fallbackCreateContext,
    cookieMergeStrategy: 'last-write-wins',
    headerMergeStrategy: 'last-write-wins',
    debug: false,
    ruleTimeoutMs: 0,
    requestHeaderPolicy: {},
    strictOverrideCheck: false,
    hostFolderHeader: undefined,
    tracePath: true,
    ...rest,
    ...(debug !== undefined ? { debug } : {}),
    logger: safeLogger(logger ?? createConsoleLogger('info')),
  } satisfies ChainConfig<TContext>

  assertFiniteRuleTimeoutMs(config.ruleTimeoutMs)
  return config
}

/** Internal executor for the public chain() composition helper. */
export function executeChain<TContext>(
  options: ChainOptions<TContext>,
  entries: HandlerRule<TContext>[]
): ProxyHandler {
  const fallbackCreateContext =
    createProxyContext as unknown as ChainConfig<TContext>['createContext']
  const config = resolveConfig(options, fallbackCreateContext)

  const rules = entries.map(toRule)
  const {
    logger,
    debug: debugLevel,
    cookieMergeStrategy,
    headerMergeStrategy,
    ruleTimeoutMs,
    requestHeaderPolicy,
    strictOverrideCheck,
    hostFolderHeader,
  } = config
  const debug = debugLevel !== false
  const hasHandlerDebug = rules.some((rule) => rule.debug != null && rule.debug !== false)
  const hasDetailedHandlerDebug = rules.some(
    (rule) => rule.debug === true || rule.debug === 'detailed' || rule.debug === 'verbose'
  )
  const diagnosticsEnabled = debug || config.onTrace !== undefined || hasHandlerDebug

  assertOverrideMechanismSupported(strictOverrideCheck)

  for (let i = 0; i < rules.length; i++) {
    assertIncludeExcludeNoOverlap(rules[i]!.include, rules[i]!.exclude, ruleLabel(rules[i]!, i))
    assertFiniteRuleTimeoutMs(rules[i]!.timeout)
  }

  return async function proxy(req: NextRequest, event: NextFetchEvent) {
    const startedAt = diagnosticsEnabled ? monotonicNow() : 0
    const diagnostics: HandlerTrace[] | null = diagnosticsEnabled ? [] : null
    let nextHandlerIndex = 0
    const finish = (
      response: NextResponse | Response,
      forcedOutcome?: ChainOutcome
    ): NextResponse | Response => {
      if (!diagnostics) return response
      for (let i = nextHandlerIndex; i < rules.length; i++) {
        diagnostics.push({
          name: safeDiagnosticText(ruleLabel(rules[i]!, i), 64),
          outcome: 'not-reached',
        })
      }
      const trace: ChainTrace = {
        method: safeDiagnosticText(req.method, 16),
        pathname: config.tracePath === false ? undefined : safeDiagnosticText(req.nextUrl.pathname),
        durationMs: monotonicNow() - startedAt,
        outcome: forcedOutcome ?? responseOutcome(response),
        handlers: diagnostics,
      }
      if (config.onTrace) {
        try {
          void Promise.resolve(config.onTrace(trace)).catch(() => {})
        } catch {
          // Observability must not change the request outcome.
        }
      }
      const globalLevel = normalizeDebugLevel(debugLevel)
      if (globalLevel !== false || hasHandlerDebug) {
        const visible = diagnostics.filter((_handler, index) => {
          const local = rules[index]?.debug
          if (local === false) return false
          if (local === 'compact') return globalLevel === 'compact'
          if (local != null) return true
          return globalLevel !== false && !(globalLevel === 'compact' && hasDetailedHandlerDebug)
        })
        const level =
          (globalLevel === 'compact' || globalLevel === false) && hasDetailedHandlerDebug
            ? 'detailed'
            : globalLevel === false
              ? 'compact'
              : globalLevel
        try {
          config.logger.info(
            formatTrace(
              level === 'compact' ? trace : { ...trace, handlers: visible },
              level,
              shouldUseColor(),
              supportsUnicode()
            )
          )
        } catch {
          // A custom logger is an external integration, not part of request execution.
        }
      }
      return response
    }

    let ctx: TContext
    try {
      ctx = config.createContext(req, event)
    } catch {
      if (!diagnosticsEnabled) logger.error('request context creation failed')
      return finish(safeInternalError(), { type: 'error', status: 500, classification: 'engine' })
    }

    let currentReq = req
    let pendingRequestOverrides: Headers | null = null
    let pendingRewriteUrl: string | null = null

    const headerWrites: EntryWrite[] = []
    const cookieWrites: EntryWrite[] = []

    // Fail-closed 500 that keeps the headers and cookies earlier rules set (for example CSP).
    const failClosed = () =>
      finalizeResponse(
        safeInternalError(),
        headerWrites,
        cookieWrites,
        headerMergeStrategy,
        cookieMergeStrategy,
        logger,
        debug
      )

    const materializeRequest = (): NextRequest => {
      if (!pendingRequestOverrides) return currentReq
      if (!headersDiffer(currentReq.headers, pendingRequestOverrides)) {
        pendingRequestOverrides = null
        return currentReq
      }
      const merged = new Headers(currentReq.headers)
      pendingRequestOverrides.forEach((v, k) => {
        merged.set(k, v)
      })
      pendingRequestOverrides = null
      currentReq = new NextRequest(currentReq, { headers: merged })
      return currentReq
    }

    const appliedRequestOverrides = new Headers()

    const queueRequestOverrides = (overrides: Headers) => {
      if (!pendingRequestOverrides) pendingRequestOverrides = new Headers()
      const target = pendingRequestOverrides
      overrides.forEach((v, k) => {
        target.set(k, v)
        appliedRequestOverrides.set(k, v)
      })
    }

    // Handles an error thrown by rule `i` (or while reading its return value).
    // Returns the raw result to continue with, or the final response.
    const recoverRuleError = async (
      err: unknown,
      i: number,
      label: string,
      req: NextRequest,
      startedAt: number
    ): Promise<{ raw: RuleRaw } | { response: NextResponse | Response }> => {
      const timeoutError = err instanceof RuleTimeoutError
      const durationMs = () => (diagnosticsEnabled ? monotonicNow() - startedAt : 0)
      const errorHandler = rules[i]!.onError ?? config.onError
      const errorPolicy = rules[i]!.onError ? 'handler' : 'chain'
      if (!errorHandler) {
        if (!diagnosticsEnabled) logger.error('handler failed')
        diagnostics?.push({
          name: safeDiagnosticText(label, 64),
          outcome: timeoutError ? 'timeout' : 'failed',
          durationMs: durationMs(),
          policy: 'none',
          details: handlerDetails(rules[i]!, ruleTimeoutMs, 'matched', 'matched', 'not-matched'),
        })
        nextHandlerIndex = i + 1
        return {
          response: finish(
            failClosed(),
            timeoutError
              ? {
                  type: 'timeout',
                  status: 500,
                  timeoutMs: err instanceof RuleTimeoutError ? err.timeoutMs : ruleTimeoutMs,
                }
              : { type: 'error', status: 500, classification: 'handler' }
          ),
        }
      }
      try {
        const recovered = await errorHandler(err, i, req, ctx)
        if (recovered == null) {
          diagnostics?.push({
            name: safeDiagnosticText(label, 64),
            outcome: timeoutError ? 'timeout' : 'failed',
            durationMs: durationMs(),
            policy: errorPolicy,
            details: handlerDetails(rules[i]!, ruleTimeoutMs, 'matched', 'matched', 'not-matched'),
          })
          nextHandlerIndex = i + 1
          return {
            response: finish(
              failClosed(),
              timeoutError
                ? {
                    type: 'timeout',
                    status: 500,
                    timeoutMs: err instanceof RuleTimeoutError ? err.timeoutMs : ruleTimeoutMs,
                  }
                : { type: 'error', status: 500, classification: 'handler' }
            ),
          }
        }
        // NextResponse.next() is a Response; treat it as continuation, not a stop.
        if (isNextResult(recovered) || isNextResponse(recovered)) {
          diagnostics?.push({
            name: safeDiagnosticText(label, 64),
            outcome: 'recovered',
            durationMs: durationMs(),
            recovery: 'continue',
            policy: errorPolicy,
            details: handlerDetails(rules[i]!, ruleTimeoutMs, 'matched', 'matched', 'not-matched'),
          })
          nextHandlerIndex = i + 1
          return { raw: recovered }
        }
        if (!(recovered instanceof Response)) {
          diagnostics?.push({
            name: safeDiagnosticText(label, 64),
            outcome: timeoutError ? 'timeout' : 'failed',
            durationMs: durationMs(),
            policy: errorPolicy,
            details: handlerDetails(rules[i]!, ruleTimeoutMs, 'matched', 'matched', 'not-matched'),
          })
          nextHandlerIndex = i + 1
          return {
            response: finish(failClosed(), {
              type: 'error',
              status: 500,
              classification: 'handler',
            }),
          }
        }

        stripRoutingOverrides(recovered)
        headerWrites.push({
          ruleIndex: i,
          ruleName: label,
          items: responseHeaderItems(recovered.headers),
        })
        cookieWrites.push({
          ruleIndex: i,
          ruleName: label,
          items: cookieItemsFromHeaders(recovered.headers),
        })
        diagnostics?.push({
          name: safeDiagnosticText(label, 64),
          outcome: 'recovered',
          durationMs: durationMs(),
          recovery:
            responseOutcome(recovered).type === 'redirect'
              ? 'redirect'
              : responseOutcome(recovered).type === 'rewrite'
                ? 'rewrite'
                : 'response',
          policy: errorPolicy,
          details: handlerDetails(rules[i]!, ruleTimeoutMs, 'matched', 'matched', 'not-matched'),
        })
        nextHandlerIndex = i + 1
        return {
          response: finish(
            finalizeResponse(
              recovered,
              headerWrites,
              cookieWrites,
              headerMergeStrategy,
              cookieMergeStrategy,
              logger,
              debug
            )
          ),
        }
      } catch {
        if (!diagnosticsEnabled) logger.error('chain error handler failed')
        diagnostics?.push({
          name: safeDiagnosticText(label, 64),
          outcome: timeoutError ? 'timeout' : 'failed',
          durationMs: durationMs(),
          policy: errorPolicy,
          details: handlerDetails(rules[i]!, ruleTimeoutMs, 'matched', 'matched', 'not-matched'),
        })
        nextHandlerIndex = i + 1
        return {
          response: finish(failClosed(), {
            type: 'error',
            status: 500,
            classification: 'handler',
          }),
        }
      }
    }

    try {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]!
        const label = ruleLabel(rule, i)
        const activeReq = materializeRequest()

        const reqHost = normalizeHost(
          activeReq.headers.get('host') ?? activeReq.headers.get('x-forwarded-host')
        )
        // Match the decoded path Next.js resolves; a raw, encoded path would skip include-scoped rules.
        const matchPath = canonicalPathname(activeReq.nextUrl.pathname)
        if (matchPath === null) {
          return finish(
            new NextResponse('Bad Request', {
              status: 400,
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            })
          )
        }
        nextHandlerIndex = i
        const skipReason = ruleMatchReason(matchPath, reqHost, rule)
        if (skipReason) {
          diagnostics?.push({
            name: safeDiagnosticText(label, 64),
            outcome: 'skipped',
            reason: skipReason,
            details: handlerDetails(
              rule,
              ruleTimeoutMs,
              'not-evaluated',
              skipReason === 'include-mismatch' ? 'mismatch' : undefined,
              skipReason === 'exclude-match'
                ? 'matched'
                : skipReason === 'include-mismatch' && rule.exclude
                  ? 'not-matched'
                  : undefined
            ),
          })
          nextHandlerIndex = i + 1
          continue
        }

        const startedAt = diagnosticsEnabled ? monotonicNow() : 0
        let raw: RuleRaw
        try {
          const result = await withRuleTimeout(
            (async () => {
              if (rule.when && !(await rule.when(activeReq, event, ctx))) {
                return { kind: 'skipped' as const }
              }
              return { kind: 'result' as const, raw: await rule.run(activeReq, ctx, event) }
            })(),
            rule.timeout ?? ruleTimeoutMs,
            label
          )
          if (result.kind === 'skipped') {
            diagnostics?.push({
              name: safeDiagnosticText(label, 64),
              outcome: 'skipped',
              reason: 'when-false',
              details: handlerDetails(rule, ruleTimeoutMs, 'false', 'matched', 'not-matched'),
            })
            nextHandlerIndex = i + 1
            continue
          }
          raw = result.raw
        } catch (err) {
          const recovered = await recoverRuleError(err, i, label, activeReq, startedAt)
          if ('response' in recovered) return recovered.response
          raw = recovered.raw
        }

        // A malformed return value is attributed to this rule, like a thrown error.
        let outcome: ResolvedOutcome
        try {
          outcome = resolveRuleResult(raw, requestHeaderPolicy, logger, debug)
        } catch (err) {
          const recovered = await recoverRuleError(err, i, label, activeReq, startedAt)
          if ('response' in recovered) return recovered.response
          outcome = resolveRuleResult(recovered.raw, requestHeaderPolicy, logger, debug)
        }
        const duration = diagnosticsEnabled ? monotonicNow() - startedAt : 0

        if (outcome.kind === 'continue') {
          if (outcome.rewriteUrl) {
            pendingRewriteUrl = outcome.rewriteUrl
            if (currentReq === req) {
              currentReq = new NextRequest(currentReq)
            }
            try {
              const parsed = new URL(outcome.rewriteUrl)
              currentReq.nextUrl.pathname = parsed.pathname
              currentReq.nextUrl.search = parsed.search
            } catch {
              currentReq.nextUrl.pathname = outcome.rewriteUrl
            }
          }

          if (outcome.request) queueRequestOverrides(outcome.request)

          if (outcome.responseHeaders.size || outcome.cookies.size) {
            headerWrites.push({ ruleIndex: i, ruleName: label, items: outcome.responseHeaders })
            cookieWrites.push({ ruleIndex: i, ruleName: label, items: outcome.cookies })
          }

          if (diagnostics?.at(-1)?.outcome !== 'recovered') {
            diagnostics?.push(
              outcome.rewriteUrl
                ? {
                    name: safeDiagnosticText(label, 64),
                    outcome: 'rewrite',
                    durationMs: duration,
                    destination: safeDestination(outcome.rewriteUrl) ?? '/',
                    final: false,
                    details: handlerDetails(
                      rule,
                      ruleTimeoutMs,
                      'matched',
                      'matched',
                      'not-matched'
                    ),
                  }
                : {
                    name: safeDiagnosticText(label, 64),
                    outcome: 'continue',
                    source: isNextResult(raw)
                      ? 'next()'
                      : raw instanceof NextResponse && raw.headers.get('x-middleware-next') === '1'
                        ? 'NextResponse.next()'
                        : 'undefined',
                    durationMs: duration,
                    details: handlerDetails(
                      rule,
                      ruleTimeoutMs,
                      'matched',
                      'matched',
                      'not-matched'
                    ),
                  }
            )
          }
          nextHandlerIndex = i + 1
          continue
        }

        stripRoutingOverrides(outcome.response)
        headerWrites.push({
          ruleIndex: i,
          ruleName: label,
          items: responseHeaderItems(outcome.response.headers),
        })
        cookieWrites.push({
          ruleIndex: i,
          ruleName: label,
          items: cookieItemsFromHeaders(outcome.response.headers),
        })

        const terminalOutcome = responseOutcome(outcome.response)
        diagnostics?.push(
          terminalOutcome.type === 'redirect'
            ? {
                name: safeDiagnosticText(label, 64),
                outcome: 'redirect',
                durationMs: duration,
                status: terminalOutcome.status,
                destination: terminalOutcome.destination,
                details: handlerDetails(rule, ruleTimeoutMs, 'matched', 'matched', 'not-matched'),
              }
            : terminalOutcome.type === 'rewrite'
              ? {
                  name: safeDiagnosticText(label, 64),
                  outcome: 'rewrite',
                  durationMs: duration,
                  destination: terminalOutcome.destination,
                  final: true,
                  details: handlerDetails(rule, ruleTimeoutMs, 'matched', 'matched', 'not-matched'),
                }
              : {
                  name: safeDiagnosticText(label, 64),
                  outcome: 'response',
                  durationMs: duration,
                  status: outcome.response.status,
                  details: handlerDetails(rule, ruleTimeoutMs, 'matched', 'matched', 'not-matched'),
                }
        )
        nextHandlerIndex = i + 1

        const internalFolder = hostFolderHeader
          ? appliedRequestOverrides.get(hostFolderHeader)
          : null
        if (internalFolder && outcome.response.headers.has('x-middleware-rewrite')) {
          const rawRewrite = outcome.response.headers.get('x-middleware-rewrite')!
          const cleanFolder = physicalFolderPrefix(internalFolder)
          outcome.response.headers.set(
            'x-middleware-rewrite',
            applyFolderPrefix(rawRewrite, cleanFolder, currentReq.url)
          )
        }

        const finalTerminalOutcome = responseOutcome(outcome.response)
        const terminalTrace = diagnostics?.at(-1)
        if (finalTerminalOutcome.type === 'rewrite' && terminalTrace?.outcome === 'rewrite') {
          terminalTrace.destination = finalTerminalOutcome.destination
        }

        return finish(
          finalizeResponse(
            outcome.response,
            headerWrites,
            cookieWrites,
            headerMergeStrategy,
            cookieMergeStrategy,
            logger,
            debug
          ),
          finalTerminalOutcome
        )
      }

      const finalReq = materializeRequest()
      const internalHostFolder = hostFolderHeader
        ? appliedRequestOverrides.get(hostFolderHeader)
        : null

      let finalRewriteUrl: string | null = pendingRewriteUrl

      if (internalHostFolder) {
        const cleanFolder = physicalFolderPrefix(internalHostFolder)

        if (finalRewriteUrl) {
          finalRewriteUrl = applyFolderPrefix(finalRewriteUrl, cleanFolder, finalReq.url)
        } else {
          const currentPath = finalReq.nextUrl.pathname
          if (!isInsideFolder(currentPath, cleanFolder)) {
            const targetUrl = finalReq.nextUrl.clone()
            targetUrl.pathname = cleanFolder + (currentPath === '/' ? '' : currentPath)
            finalRewriteUrl = targetUrl.toString()
          }
        }
      }

      // Forwarding unchanged headers would encode every request header as x-middleware-request-*.
      const requestInit = finalReq !== req ? { request: { headers: finalReq.headers } } : undefined
      let final: NextResponse
      if (finalRewriteUrl) {
        const rewriteTarget = new URL(finalRewriteUrl, finalReq.url)
        final = NextResponse.rewrite(rewriteTarget, requestInit)
      } else {
        final = NextResponse.next(requestInit)
      }

      const finalResponse = finalizeResponse(
        final,
        headerWrites,
        cookieWrites,
        headerMergeStrategy,
        cookieMergeStrategy,
        logger,
        debug
      )
      if (finalRewriteUrl) {
        const destination = safeDestination(finalRewriteUrl) ?? '/'
        const rewrite = diagnostics?.filter((handler) => handler.outcome === 'rewrite').at(-1)
        if (rewrite?.outcome === 'rewrite') {
          rewrite.destination = destination
          rewrite.final = true
        }
      }
      return finish(finalResponse)
    } catch (err) {
      if (!diagnosticsEnabled) logger.error('proxy chain execution failed')
      if (config.onError) {
        try {
          const recovered = await config.onError(err, -1, materializeRequest(), ctx)
          // No later rule can run here, so a continuation response would skip them. Fail closed.
          if (recovered instanceof Response && !isNextResponse(recovered)) {
            stripRoutingOverrides(recovered)
            return finish(
              finalizeResponse(
                recovered,
                headerWrites,
                cookieWrites,
                headerMergeStrategy,
                cookieMergeStrategy,
                logger,
                debug
              )
            )
          }
        } catch {
          /* fall through to safe 500 */
        }
      }
      return finish(
        failClosed(),
        err instanceof RuleTimeoutError
          ? { type: 'timeout', status: 500, timeoutMs: err.timeoutMs }
          : { type: 'error', status: 500, classification: 'engine' }
      )
    }
  }
}
