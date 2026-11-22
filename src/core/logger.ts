import type { ChainLogger, LogLevel, PipelineOutcome } from './types'

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export function createConsoleLogger(minLevel: LogLevel = 'info'): ChainLogger {
  const min = LEVEL_RANK[minLevel]

  const write = (level: LogLevel) => (obj: unknown, msg?: string) => {
    if (LEVEL_RANK[level] < min) return
    if (typeof obj === 'string') {
      console[level](obj)
      return
    }
    const message = msg ?? ''
    if (message) console[level](`[proxy-chain] ${message}`, obj)
    else console[level]('[proxy-chain]', obj)
  }

  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  }
}

function formatDuration(ms: number): string {
  return `${ms.toFixed(2)}ms`
}

/**
 * Formats a single structured log line for an executed proxy rule.
 */
export function formatPipelineLine(input: {
  method: string
  path: string
  name: string
  traceId?: string
  outcome: PipelineOutcome
}): string {
  const trace = input.traceId ? ` [${input.traceId.slice(0, 8)}]` : ''
  const req = `${input.method} ${input.path}${trace}`
  const { name, outcome } = input

  switch (outcome.kind) {
    case 'passed':
      return `[proxy-chain] · ${req} | ${name} (${formatDuration(outcome.duration)}) -> passed`
    case 'next':
      return `[proxy-chain] ~ ${req} | ${name} (${formatDuration(outcome.duration)}) -> headers mutated (${outcome.headers})`
    case 'stop':
      return `[proxy-chain] × ${req} | ${name} (${formatDuration(outcome.duration)}) -> stop ${outcome.status}`
  }
}
