import type { ChainOutcome, ChainTrace, DebugLevel, HandlerTrace } from './types'
import { safeDiagnosticText } from './sanitize'

type Runtime = {
  env?: Record<string, string | undefined>
  stdout?: { isTTY?: boolean; getColorDepth?: () => number }
}

function runtime(): Runtime | undefined {
  return (globalThis as typeof globalThis & { process?: Runtime }).process
}

export function shouldUseColor(): boolean {
  const process = runtime()
  const env = process?.env
  if (env?.NO_COLOR) return false
  if (env?.FORCE_COLOR) return env.FORCE_COLOR !== '0'
  if (env?.CI || env?.TERM === 'dumb' || !process?.stdout?.isTTY) return false
  try {
    return process.stdout.getColorDepth?.() !== 1
  } catch {
    return false
  }
}

export function supportsUnicode(): boolean {
  const process = runtime()
  if (!process?.env) return false
  const env = process.env
  const locale = (env.LC_ALL || env.LC_CTYPE || env.LANG || '').toLowerCase()
  return !/(^|\s)(c|posix)(\.|$|\s)/.test(locale) && !locale.includes('ascii')
}

function paint(text: string, code: number, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text
}

function duration(ms: number): string {
  return `${ms.toFixed(2)}ms`
}

function handlerLabel(handler: HandlerTrace): { symbol: string; text: string; color: number } {
  switch (handler.outcome) {
    case 'continue':
      return { symbol: '✓', text: 'continue', color: 32 }
    case 'rewrite':
      return { symbol: '↪', text: 'rewrite', color: 36 }
    case 'redirect':
      return { symbol: '↗', text: 'redirect', color: 33 }
    case 'response':
      return { symbol: '✓', text: `response ${handler.status}`, color: 32 }
    case 'skipped':
      return { symbol: '○', text: 'skipped', color: 2 }
    case 'not-reached':
      return { symbol: '–', text: 'not reached', color: 2 }
    case 'recovered':
      return { symbol: '!', text: 'recovered', color: 33 }
    case 'timeout':
      return { symbol: '×', text: 'timeout', color: 31 }
    case 'failed':
      return { symbol: '×', text: 'failed', color: 31 }
  }
}

function outcomeText(outcome: ChainOutcome): string {
  switch (outcome.type) {
    case 'next':
      return 'NEXT'
    case 'rewrite':
      return `REWRITE ${outcome.destination}`
    case 'redirect':
      return `REDIRECT ${outcome.status}${outcome.destination ? ` ${outcome.destination}` : ''}`
    case 'response':
      return `RESPONSE ${outcome.status}`
    case 'error':
      return `ERROR ${outcome.status}`
    case 'timeout':
      return `ERROR ${outcome.status} · timeout ${outcome.timeoutMs}ms`
  }
}

function outcomeColor(outcome: ChainOutcome): number {
  switch (outcome.type) {
    case 'next':
      return 32
    case 'rewrite':
      return 36
    case 'redirect':
      return 33
    case 'error':
    case 'timeout':
      return 31
    case 'response':
      return outcome.status >= 500 ? 31 : 32
  }
}

export function formatTrace(
  trace: ChainTrace,
  level: Exclude<DebugLevel, false | true>,
  color = shouldUseColor(),
  unicode = true
): string {
  const path = trace.pathname ? ` ${safeDiagnosticText(trace.pathname)}` : ''
  const header = `proxy-chain ${safeDiagnosticText(trace.method)}${path}`
  const rows: string[] = []
  const handlers = trace.handlers
  if (level === 'compact') {
    const executed = handlers.filter(
      (handler) => handler.outcome !== 'skipped' && handler.outcome !== 'not-reached'
    ).length
    const skipped = handlers.filter((handler) => handler.outcome === 'skipped').length
    return `${header} ${unicode ? '→' : '->'} ${paint(outcomeText(trace.outcome), outcomeColor(trace.outcome), color)} · ${executed} executed · ${skipped} skipped · ${paint(duration(trace.durationMs), 2, color)}`
  }

  rows.push(`${header.padEnd(52)} ${duration(trace.durationMs)}`)
  const shown = handlers
  const symbols = unicode
    ? {
        pass: '│',
        last: '└',
        continue: '✓',
        rewrite: '↪',
        redirect: '↗',
        skip: '○',
        missing: '–',
        error: '×',
        recovered: '!',
      }
    : {
        pass: '|',
        last: '`-',
        continue: '+',
        rewrite: '->',
        redirect: '->',
        skip: 'o',
        missing: '-',
        error: 'x',
        recovered: '!',
      }

  for (let index = 0; index < shown.length; index++) {
    const handler = shown[index]!
    const label = handlerLabel(handler)
    const symbol =
      handler.outcome === 'continue'
        ? symbols.continue
        : handler.outcome === 'rewrite'
          ? symbols.rewrite
          : handler.outcome === 'redirect'
            ? symbols.redirect
            : handler.outcome === 'skipped'
              ? symbols.skip
              : handler.outcome === 'not-reached'
                ? symbols.missing
                : handler.outcome === 'recovered'
                  ? symbols.recovered
                  : symbols.error
    const prefix = symbols.pass
    const name = safeDiagnosticText(handler.name, 32)
    const time = 'durationMs' in handler ? paint(duration(handler.durationMs), 2, color) : ''
    rows.push(
      `${prefix} ${paint(symbol, label.color, color)} ${name.padEnd(16)} ${label.text.padEnd(14)} ${time}`.trimEnd()
    )
    if (level === 'verbose') {
      if (handler.details?.timeoutMs !== undefined) {
        rows.push(
          `${symbols.pass}   timeout: ${handler.details.timeoutMs}ms (${handler.details.timeoutSource ?? 'chain'})`
        )
      }
      if (handler.details?.include) {
        rows.push(
          `${symbols.pass}   include: ${handler.details.include.join(', ')}${handler.details.includeResult ? ` (${handler.details.includeResult})` : ''}`
        )
      }
      if (handler.details?.exclude) {
        rows.push(
          `${symbols.pass}   exclude: ${handler.details.exclude.join(', ')}${handler.details.excludeResult ? ` (${handler.details.excludeResult})` : ''}`
        )
      }
      if (handler.details?.when) {
        rows.push(
          `${symbols.pass}   when: ${handler.details.when === 'matched' ? 'true' : handler.details.when === 'false' ? 'false' : 'not evaluated'}`
        )
      }
      if (handler.outcome === 'continue') rows.push(`${symbols.pass}   source: ${handler.source}`)
      if (handler.outcome === 'skipped') rows.push(`${symbols.pass}   reason: ${handler.reason}`)
      if (handler.outcome === 'rewrite') {
        rows.push(`${symbols.pass}   destination: ${handler.destination}`)
      }
      if (handler.outcome === 'redirect' && handler.destination) {
        rows.push(`${symbols.pass}   destination: ${handler.destination}`)
      }
    }
    if (
      handler.outcome === 'recovered' ||
      handler.outcome === 'failed' ||
      handler.outcome === 'timeout'
    ) {
      const policy = handler.policy === 'none' ? 'chain default' : handler.policy
      rows.push(`${symbols.pass}   error policy: ${policy}`)
    }
    if (handler.outcome === 'timeout' && handler.details?.timeoutMs !== undefined) {
      rows.push(`${symbols.pass}   deadline: ${handler.details.timeoutMs}ms`)
    }
  }
  rows.push(
    `${symbols.last} ${paint(outcomeText(trace.outcome), outcomeColor(trace.outcome), color)}`
  )
  const output = rows.join('\n')
  if (output.length <= 16_384) return output
  const safeBoundary = output.lastIndexOf('\n', 16_384)
  return `${output.slice(0, safeBoundary < 0 ? 16_384 : safeBoundary)}\n${unicode ? '…' : '...'} diagnostics truncated`
}
