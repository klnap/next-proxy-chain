import { NextResponse } from 'next/server'
import { isNextResult } from './actions'
import {
  applyMergedToResponse,
  cookieItemsFromHeaders,
  decodeOverriddenRequestHeaders,
  headersInitToHeaders,
  mergeRequestHeaderOverrides,
  mergeWrites,
  responseHeaderItems,
} from './headers'
import type {
  ChainLogger,
  EntryWrite,
  MergeStrategy,
  NextResult,
  RequestHeaderPolicy,
} from './types'

export function safeInternalError(): NextResponse {
  return new NextResponse('Internal Server Error', {
    status: 500,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

const UNSUPPORTED_OVERRIDE_MSG =
  '[proxy-chain] Warning: platform NextResponse.next() does not support x-middleware-next header overrides.'
const VERIFY_OVERRIDE_MSG =
  '[proxy-chain] Warning: unable to verify NextResponse request override mechanism.'

type CachedOverrideProbe =
  | { kind: 'supported' }
  | { kind: 'unsupported' }
  | { kind: 'error'; err: unknown }

let cachedOverrideProbe: CachedOverrideProbe | null = null
let overrideProbeForTests: (() => boolean) | null = null

function runOverrideProbe(): boolean {
  if (overrideProbeForTests) return overrideProbeForTests()

  const testRes = NextResponse.next({
    request: { headers: new Headers({ 'x-proxy-chain-probe': '1' }) },
  })
  return testRes.headers.get('x-middleware-next') === '1'
}

function throwForCachedProbe(probe: Exclude<CachedOverrideProbe, { kind: 'supported' }>): never {
  if (probe.kind === 'unsupported') throw new Error(UNSUPPORTED_OVERRIDE_MSG)
  throw probe.err instanceof Error ? probe.err : new Error(VERIFY_OVERRIDE_MSG)
}

function resolveCachedProbe(probe: CachedOverrideProbe, strict: boolean): boolean {
  if (probe.kind === 'supported') return true
  if (strict) throwForCachedProbe(probe)
  return false
}

/** @internal Reset cached override probe between tests. */
export function resetOverrideMechanismProbeForTests(): void {
  cachedOverrideProbe = null
  overrideProbeForTests = null
}

/** @internal Inject deterministic override probe results in tests. */
export function setOverrideMechanismProbeForTests(probe: (() => boolean) | null): void {
  cachedOverrideProbe = null
  overrideProbeForTests = probe
}

export function assertOverrideMechanismSupported(strict = false): boolean {
  if (cachedOverrideProbe !== null) return resolveCachedProbe(cachedOverrideProbe, strict)

  try {
    const isSupported = runOverrideProbe()
    if (isSupported) {
      cachedOverrideProbe = { kind: 'supported' }
      return true
    }

    cachedOverrideProbe = { kind: 'unsupported' }
    if (strict) throw new Error(UNSUPPORTED_OVERRIDE_MSG)
    console.warn(UNSUPPORTED_OVERRIDE_MSG)
    return false
  } catch (err) {
    cachedOverrideProbe = { kind: 'error', err }
    if (strict) throw err instanceof Error ? err : new Error(VERIFY_OVERRIDE_MSG)
    console.warn(VERIFY_OVERRIDE_MSG, err)
    return false
  }
}

export type ResolvedOutcome =
  | {
      kind: 'continue'
      request?: Headers
      responseHeaders: Map<string, string>
      cookies: Map<string, string>
      rewriteUrl?: string
    }
  | { kind: 'stop'; response: NextResponse | Response }

export function resolveRuleResult(
  res: NextResponse | Response | NextResult | undefined | void,
  requestHeaderPolicy: RequestHeaderPolicy,
  logger: ChainLogger,
  debug: boolean
): ResolvedOutcome {
  if (res == null) {
    return { kind: 'continue', responseHeaders: new Map(), cookies: new Map() }
  }

  if (isNextResult(res)) {
    let request: Headers | undefined
    if (res.request) {
      const filtered = new Headers()
      const { dropped } = mergeRequestHeaderOverrides(
        filtered,
        headersInitToHeaders(res.request),
        requestHeaderPolicy
      )
      if (debug && dropped.length) {
        logger.warn({ dropped }, 'blocked request header mutation')
      }
      if ([...filtered.keys()].length) request = filtered
    }

    const headerInit = res.headers ? headersInitToHeaders(res.headers) : undefined
    return {
      kind: 'continue',
      request,
      responseHeaders: headerInit ? responseHeaderItems(headerInit) : new Map(),
      cookies: headerInit ? cookieItemsFromHeaders(headerInit) : new Map(),
    }
  }

  if (res.headers.get('x-middleware-next') === '1') {
    let request: Headers | undefined
    const decoded = decodeOverriddenRequestHeaders(res.headers)
    if ([...decoded.keys()].length > 0) {
      const target = new Headers()
      mergeRequestHeaderOverrides(target, decoded, requestHeaderPolicy)
      if ([...target.keys()].length) request = target
    }

    return {
      kind: 'continue',
      request,
      responseHeaders: responseHeaderItems(res.headers),
      cookies: cookieItemsFromHeaders(res.headers),
    }
  }

  const rewriteHeader = res.headers.get('x-middleware-rewrite')
  if (rewriteHeader && (res.status === 200 || !res.status)) {
    let request: Headers | undefined
    const decoded = decodeOverriddenRequestHeaders(res.headers)
    if ([...decoded.keys()].length > 0) {
      const target = new Headers()
      mergeRequestHeaderOverrides(target, decoded, requestHeaderPolicy)
      if ([...target.keys()].length) request = target
    }

    return {
      kind: 'continue',
      request,
      responseHeaders: responseHeaderItems(res.headers),
      cookies: cookieItemsFromHeaders(res.headers),
      rewriteUrl: rewriteHeader,
    }
  }

  return { kind: 'stop', response: res }
}

export function finalizeResponse(
  res: NextResponse | Response,
  headerWrites: EntryWrite[],
  cookieWrites: EntryWrite[],
  headerStrategy: MergeStrategy,
  cookieStrategy: MergeStrategy,
  logger: ChainLogger,
  debug: boolean
): NextResponse | Response {
  const headers = mergeWrites(headerWrites, headerStrategy, (key, winner, loser) => {
    if (debug) logger.debug({ header: key, winner, loser }, 'header conflict resolved')
  })
  const cookies = mergeWrites(cookieWrites, cookieStrategy, (key, winner, loser) => {
    if (debug) logger.debug({ cookie: key, winner, loser }, 'cookie conflict resolved')
  })

  const seenHeaders = new Set<string>()
  for (const write of headerWrites) {
    for (const key of write.items.keys()) seenHeaders.add(key)
  }
  const dropHeaders: string[] = []
  for (const key of seenHeaders) {
    if (!headers.has(key)) dropHeaders.push(key)
  }

  applyMergedToResponse(res, headers, cookies, dropHeaders)
  return res
}
