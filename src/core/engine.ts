import type { NextFetchEvent } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'

import { isNextResult } from './actions'
import { createProxyContext } from './context'
import { cookieItemsFromHeaders, headersDiffer, responseHeaderItems } from './headers'
import { applyFolderPrefix, physicalFolderPrefix } from './host-folder-prefix'
import { createConsoleLogger, formatPipelineLine } from './logger'
import {
  assertIncludeExcludeNoOverlap,
  normalizeHost,
  ruleLabel,
  ruleMatches,
  toRule,
  withPaths,
} from './matching'
import {
  assertOverrideMechanismSupported,
  finalizeResponse,
  resolveRuleResult,
  safeInternalError,
} from './pipeline'
import { assertFiniteRuleTimeoutMs, withRuleTimeout } from './timeout'
import type {
  ChainConfig,
  DefinedProxy,
  Entry,
  EntryWrite,
  NextResult,
  ProxyChainOptions,
  ProxyContext,
  ProxyFn,
  ProxyPathFilter,
  ProxyRule,
} from './types'

function isPathFilter(value: unknown): value is ProxyPathFilter {
  if (value === null || typeof value !== 'object') return false
  if ('nextUrl' in value) return false
  return 'include' in value || 'exclude' in value || 'name' in value
}

/**
 * Creates a reusable, scope-aware proxy rule function.
 *
 * @example
 * const authRule = defineProxy("auth", async (req, ctx) => next())
 * const scopedAuthRule = authRule({ include: path("/admin/*") })
 */
export function defineProxy<TContext = ProxyContext>(run: ProxyFn<TContext>): DefinedProxy<TContext>
export function defineProxy<TContext = ProxyContext>(
  name: string,
  run: ProxyFn<TContext>
): DefinedProxy<TContext>
export function defineProxy<TContext = ProxyContext>(
  nameOrRun: string | ProxyFn<TContext>,
  maybeRun?: ProxyFn<TContext>
): DefinedProxy<TContext> {
  const defaultName = typeof nameOrRun === 'string' ? nameOrRun : undefined
  const run: ProxyFn<TContext> =
    typeof nameOrRun === 'function' ? nameOrRun : (maybeRun as ProxyFn<TContext>)

  const proxy = ((
    reqOrFilter: NextRequest | ProxyPathFilter,
    eventOrCtx?: NextFetchEvent | TContext,
    maybeEvent?: NextFetchEvent
  ) => {
    if (isPathFilter(reqOrFilter)) {
      return withPaths(run, {
        ...reqOrFilter,
        name: reqOrFilter.name ?? defaultName,
      }) as ProxyRule<TContext>
    }

    return run(reqOrFilter, eventOrCtx as TContext, maybeEvent as NextFetchEvent)
  }) as DefinedProxy<TContext>

  Object.defineProperty(proxy, 'name', {
    value: defaultName ?? '',
    configurable: true,
  })
  return proxy
}

type ProxyHandler = (req: NextRequest, event: NextFetchEvent) => Promise<NextResponse | Response>

function resolveConfig<TContext>(
  overrides: ProxyChainOptions<TContext>,
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
    ...rest,
    ...(debug !== undefined ? { debug } : {}),
    logger: logger ?? createConsoleLogger(debug ? 'debug' : 'info'),
  } satisfies ChainConfig<TContext>

  assertFiniteRuleTimeoutMs(config.ruleTimeoutMs)
  return config
}

/**
 * Composes independent proxy rules into a single pipeline for Next.js 15 (middleware.ts) and Next.js 16 (proxy.ts).
 *
 * Custom `TContext` requires `createContext`. Without it, context is `ProxyContext` (`Map`).
 *
 * @example
 * export default proxyChain({ debug: true }, [
 *   requestIdRule,
 *   authRule({ include: path("/dashboard/*") }),
 *   i18nRule,
 * ])
 */
export function proxyChain(entries: Entry<ProxyContext>[]): ProxyHandler
export function proxyChain(
  options: ProxyChainOptions<ProxyContext>,
  entries: Entry<ProxyContext>[]
): ProxyHandler
export function proxyChain<TContext>(
  options: ProxyChainOptions<TContext> & {
    createContext: (req: NextRequest, event: NextFetchEvent) => TContext
  },
  entries: Entry<TContext>[]
): ProxyHandler
export function proxyChain<TContext>(
  optionsOrEntries: ProxyChainOptions<TContext> | Entry<TContext>[],
  maybeEntries?: Entry<TContext>[]
): ProxyHandler {
  const options: ProxyChainOptions<TContext> = Array.isArray(optionsOrEntries)
    ? {}
    : optionsOrEntries
  const entries = (Array.isArray(optionsOrEntries) ? optionsOrEntries : maybeEntries) ?? []
  const fallbackCreateContext =
    createProxyContext as unknown as ChainConfig<TContext>['createContext']
  const config = resolveConfig(options, fallbackCreateContext)

  const rules = entries.map(toRule)
  const {
    logger,
    debug,
    cookieMergeStrategy,
    headerMergeStrategy,
    ruleTimeoutMs,
    requestHeaderPolicy,
    strictOverrideCheck,
    hostFolderHeader,
  } = config

  assertOverrideMechanismSupported(strictOverrideCheck)

  for (let i = 0; i < rules.length; i++) {
    assertIncludeExcludeNoOverlap(rules[i]!.include, rules[i]!.exclude, ruleLabel(rules[i]!, i))
  }

  return async function proxy(req: NextRequest, event: NextFetchEvent) {
    let ctx: TContext
    try {
      ctx = config.createContext(req, event)
    } catch (err) {
      logger.error({ err }, 'createContext threw')
      return safeInternalError()
    }

    const method = req.method
    const pathname = req.nextUrl.pathname
    const traceId =
      req.headers.get('x-request-id') ??
      req.headers.get('traceparent') ??
      req.headers.get('x-b3-traceid') ??
      undefined

    let currentReq = req
    let pendingRequestOverrides: Headers | null = null
    let pendingRewriteUrl: string | null = null

    const headerWrites: EntryWrite[] = []
    const cookieWrites: EntryWrite[] = []

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

    try {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]!
        const label = ruleLabel(rule, i)
        const activeReq = materializeRequest()

        const reqHost = normalizeHost(
          activeReq.headers.get('host') ?? activeReq.headers.get('x-forwarded-host')
        )
        if (!ruleMatches(activeReq.nextUrl.pathname, reqHost, rule)) continue

        const startedAt = debug ? performance.now() : 0
        let raw: NextResponse | Response | NextResult | undefined | void

        try {
          raw = await withRuleTimeout(
            Promise.resolve(rule.run(activeReq, ctx, event)),
            ruleTimeoutMs,
            label
          )
        } catch (err) {
          if (config.onError) {
            try {
              const recovered = await config.onError(err, i, activeReq, ctx)
              if (recovered == null) return safeInternalError()
              if (isNextResult(recovered)) {
                raw = recovered
              } else if (recovered instanceof Response) {
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
                if (debug) {
                  logger.debug(
                    formatPipelineLine({
                      method,
                      path: pathname,
                      name: label,
                      traceId,
                      outcome: {
                        kind: 'stop',
                        duration: performance.now() - startedAt,
                        status: recovered.status,
                      },
                    })
                  )
                }
                return finalizeResponse(
                  recovered,
                  headerWrites,
                  cookieWrites,
                  headerMergeStrategy,
                  cookieMergeStrategy,
                  logger,
                  debug
                )
              } else {
                return safeInternalError()
              }
            } catch (onErrorErr) {
              logger.error({ rule: label, err: onErrorErr }, 'onError handler threw')
              return safeInternalError()
            }
          } else {
            logger.error({ rule: label, err }, 'rule threw')
            return safeInternalError()
          }
        }

        const outcome = resolveRuleResult(raw, requestHeaderPolicy, logger, debug)
        const duration = debug ? performance.now() - startedAt : 0

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

          if (debug) {
            const mutated =
              outcome.responseHeaders.size +
              outcome.cookies.size +
              (outcome.request ? 1 : 0) +
              (outcome.rewriteUrl ? 1 : 0)
            logger.debug(
              formatPipelineLine({
                method,
                path: pathname,
                name: label,
                traceId,
                outcome:
                  mutated === 0
                    ? { kind: 'passed', duration }
                    : { kind: 'next', duration, headers: outcome.responseHeaders.size },
              })
            )
          }
          continue
        }

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

        if (debug) {
          logger.debug(
            formatPipelineLine({
              method,
              path: pathname,
              name: label,
              traceId,
              outcome: {
                kind: 'stop',
                duration,
                status: outcome.response.status,
              },
            })
          )
        }

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

        return finalizeResponse(
          outcome.response,
          headerWrites,
          cookieWrites,
          headerMergeStrategy,
          cookieMergeStrategy,
          logger,
          debug
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
          if (!currentPath.startsWith(cleanFolder)) {
            const targetUrl = finalReq.nextUrl.clone()
            targetUrl.pathname = cleanFolder + (currentPath === '/' ? '' : currentPath)
            finalRewriteUrl = targetUrl.toString()
          }
        }
      }

      let final: NextResponse
      if (finalRewriteUrl) {
        const rewriteTarget = new URL(finalRewriteUrl, finalReq.url)
        final = NextResponse.rewrite(rewriteTarget, { request: { headers: finalReq.headers } })
      } else {
        final = NextResponse.next({ request: { headers: finalReq.headers } })
      }

      return finalizeResponse(
        final,
        headerWrites,
        cookieWrites,
        headerMergeStrategy,
        cookieMergeStrategy,
        logger,
        debug
      )
    } catch (err) {
      logger.error({ err }, 'proxy chain failed')
      if (config.onError) {
        try {
          const recovered = await config.onError(err, -1, materializeRequest(), ctx)
          if (recovered instanceof Response) return recovered
        } catch {
          /* fall through to safe 500 */
        }
      }
      return safeInternalError()
    }
  }
}
