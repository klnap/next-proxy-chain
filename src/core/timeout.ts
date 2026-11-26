const MAX_TIMEOUT_MS = 2_147_483_647;

export class RuleTimeoutError extends Error {
  readonly ruleName: string;
  readonly timeoutMs: number;

  constructor(ruleName: string, timeoutMs: number) {
    super(`[proxy-chain] ${ruleName} timed out after ${timeoutMs}ms`);
    this.name = "RuleTimeoutError";
    this.ruleName = ruleName;
    this.timeoutMs = timeoutMs;
  }
}

export class RequestCancellationError extends Error {
  constructor() {
    super("[proxy-chain] incoming request was cancelled");
    this.name = "AbortError";
  }
}

export function assertValidTimeout(timeoutMs: unknown): asserts timeoutMs is number | undefined {
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 0 ||
      timeoutMs > MAX_TIMEOUT_MS)
  ) {
    throw new RangeError(
      `[proxy-chain] timeout must be an integer from 0 through ${MAX_TIMEOUT_MS} milliseconds`,
    );
  }
}

export async function runInExecutionScope<T>(
  requestSignal: AbortSignal,
  timeoutMs: number,
  ruleName: string,
  run: (signal: AbortSignal, assertActive: () => void) => T | Promise<T>,
): Promise<T> {
  assertValidTimeout(timeoutMs);
  const controller = new AbortController();
  if (requestSignal.aborted) {
    controller.abort();
    throw new RequestCancellationError();
  }

  const scopeStartedAt = performance.now();
  const timeoutError = timeoutMs > 0 ? new RuleTimeoutError(ruleName, timeoutMs) : undefined;
  let failure: RuleTimeoutError | RequestCancellationError | undefined;
  let rejectCancelled!: (reason: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject;
  });
  const cancel = (error: RuleTimeoutError | RequestCancellationError) => {
    if (failure) return;
    failure = error;
    controller.abort();
    rejectCancelled(error);
  };
  const assertActive = () => {
    if (requestSignal.aborted) cancel(new RequestCancellationError());
    else if (timeoutError && !failure && performance.now() - scopeStartedAt >= timeoutMs) {
      cancel(timeoutError);
    }
    if (failure) throw failure;
  };
  const onRequestAbort = () => cancel(new RequestCancellationError());
  requestSignal.addEventListener("abort", onRequestAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutError) {
    timer = setTimeout(() => cancel(timeoutError), timeoutMs);
  }

  const work = Promise.resolve().then(async () => {
    if (controller.signal.aborted) throw failure ?? new RequestCancellationError();
    try {
      const result = await run(controller.signal, assertActive);
      if (timeoutError && !failure && performance.now() - scopeStartedAt >= timeoutMs) {
        cancel(timeoutError);
      }
      if (failure) throw failure;
      return result;
    } catch (error) {
      if (timeoutError && !failure && performance.now() - scopeStartedAt >= timeoutMs) {
        cancel(timeoutError);
      }
      throw failure ?? error;
    }
  });

  try {
    return await Promise.race([work, cancelled]);
  } catch (error) {
    throw failure ?? error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    requestSignal.removeEventListener("abort", onRequestAbort);
    void work.catch(() => {});
  }
}

export async function runInRecoveryScope<T>(
  requestSignal: AbortSignal,
  run: (signal: AbortSignal) => T | Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (requestSignal.aborted) controller.abort();
  else requestSignal.addEventListener("abort", abort, { once: true });

  try {
    return await run(controller.signal);
  } finally {
    requestSignal.removeEventListener("abort", abort);
  }
}
