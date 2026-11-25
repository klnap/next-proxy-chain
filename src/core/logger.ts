import type { ChainLogger, LogLevel } from './types'

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
