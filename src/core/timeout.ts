export class RuleTimeoutError extends Error {
  readonly ruleName: string
  readonly timeoutMs: number

  constructor(ruleName: string, timeoutMs: number) {
    super(`[proxy-chain] ${ruleName} timed out after ${timeoutMs}ms`)
    this.name = 'RuleTimeoutError'
    this.ruleName = ruleName
    this.timeoutMs = timeoutMs
  }
}

/** Fail fast when ruleTimeoutMs is a non-finite number (NaN / ±Infinity). */
export function assertFiniteRuleTimeoutMs(ruleTimeoutMs: number | undefined): void {
  if (ruleTimeoutMs != null && !Number.isFinite(ruleTimeoutMs)) {
    throw new RangeError(
      `[proxy-chain] ruleTimeoutMs must be a finite positive number, got ${ruleTimeoutMs}`
    )
  }
}

/**
 * Enforces a strict execution time budget on an asynchronous rule operation.
 */
export async function withRuleTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  ruleName: string
): Promise<T> {
  assertFiniteRuleTimeoutMs(timeoutMs)
  if (timeoutMs == null || timeoutMs <= 0) return promise

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RuleTimeoutError(ruleName, timeoutMs)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    // Timeout does not cancel the rule. Swallow a later rejection so it is not unhandled.
    void promise.catch(() => {})
  }
}
