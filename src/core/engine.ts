import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server.js";

import { createApplicationState, createHandlerContext, createRequestMetadata } from "./context";
import { cookieItemsFromHeaders, headersDiffer, responseHeaderItems } from "./headers";
import { createConsoleLogger } from "./logger";
import { formatTrace, shouldUseColor, supportsUnicode } from "./diagnostics/formatter";
import { safeDestination, safeDiagnosticText } from "./diagnostics/sanitize";
import type {
  ChainOutcome,
  ChainTrace,
  DebugLevel,
  HandlerTrace,
  NormalizedDebugLevel,
} from "./diagnostics/types";
import {
  assertIncludeExcludeNoOverlap,
  canonicalPathname,
  normalizeHost,
  ruleLabel,
  ruleMatchReason,
  toRule,
} from "./matching";
import {
  assertOverrideMechanismSupported,
  finalizeResponse,
  type ResolvedOutcome,
  resolveRuleResult,
  safeInternalError,
} from "./pipeline";
import {
  assertValidTimeout,
  RequestCancellationError,
  RuleTimeoutError,
  runInExecutionScope,
  runInRecoveryScope,
} from "./timeout";
import type {
  ChainConfig,
  ChainLogger,
  BaseHandlerRule,
  EntryWrite,
  ChainOptions,
  HandlerRule,
  RouteScopeInput,
  RouteScopeList,
} from "./types";

function monotonicNow(): number {
  return performance.now();
}

function normalizeDebugLevel(level: DebugLevel): NormalizedDebugLevel {
  return level === true ? "detailed" : level;
}

function responseOutcome(response: Response): ChainOutcome {
  const rewrite = response.headers.get("x-middleware-rewrite");
  if (rewrite) {
    return { type: "rewrite", destination: safeDestination(rewrite) ?? "/" };
  }
  const location = response.headers.get("location");
  if (location && response.status >= 300 && response.status < 400) {
    return {
      type: "redirect",
      status: response.status,
      destination: safeDestination(location),
    };
  }
  if (response instanceof NextResponse && response.headers.get("x-middleware-next") === "1") {
    return { type: "next" };
  }
  return { type: "response", status: response.status };
}

function scopeNames(scopeList: RouteScopeList | undefined): string[] | undefined {
  if (scopeList === undefined) return undefined;
  const scopes = Array.isArray(scopeList) ? scopeList : [scopeList];
  return scopes.map((scope) => {
    if (typeof scope === "string") return safeDiagnosticText(scope, 96);
    if (scope instanceof RegExp) return safeDiagnosticText(scope.toString(), 96);
    if (typeof scope !== "object" || scope === null) return "";
    const value = scope as Exclude<RouteScopeInput, string | RegExp>;
    const parts = [
      value.path === undefined
        ? undefined
        : Array.isArray(value.path)
          ? value.path.map(String).join("|")
          : String(value.path),
      value.host === undefined
        ? undefined
        : Array.isArray(value.host)
          ? value.host.map(String).join("|")
          : String(value.host),
    ].filter(Boolean);
    return safeDiagnosticText(parts.join(" @ "), 96);
  });
}

function handlerDetails<TFn, TContext extends object>(
  rule: BaseHandlerRule<TFn, TContext>,
  chainTimeout: number,
  when: "matched" | "false" | "not-evaluated",
  includeResult?: "matched" | "mismatch",
  excludeResult?: "not-matched" | "matched",
): HandlerTrace["details"] {
  const include = scopeNames(rule.diagnosticRules?.include);
  const exclude = scopeNames(rule.diagnosticRules?.exclude);
  return {
    ...(include ? { include, includeResult } : {}),
    ...(exclude ? { exclude, excludeResult } : {}),
    ...(rule.when ? { when } : {}),
    timeoutMs: rule.timeout ?? chainTimeout,
    timeoutSource: rule.timeout === undefined ? "chain" : "handler",
  };
}

function safeLogger(logger: ChainLogger): ChainLogger {
  const wrap =
    (method: keyof ChainLogger) =>
    (...args: [unknown, string?]) => {
      try {
        const result = logger[method](...args) as unknown;
        if (result && typeof (result as { then?: unknown }).then === "function") {
          void Promise.resolve(result).catch(() => {});
        }
      } catch {
        // Logging integrations must not affect request behavior.
      }
    };
  return {
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
  };
}

type RuleRaw = NextResponse | Response | undefined | void;

/**
 * Timeout, cancellation, and engine recovery must end routing. A continuation or successful
 * rewrite classified by resolveRuleResult would resume it, so only a stop response qualifies.
 */
function isTerminalRecovery(value: unknown): value is Response {
  return value instanceof Response && resolveRuleResult(value).kind === "stop";
}

/** Ordinary error recovery that continues: a native continuation or a successful rewrite. */
function isContinuingRecovery(value: unknown): boolean {
  return value instanceof Response && resolveRuleResult(value).kind === "continue";
}

type RecoveredRule = {
  durationMs: number;
  policy: "handler" | "chain";
  details: HandlerTrace["details"];
};

/** Terminal responses must not carry Next.js request-override headers into routing. */
function stripRoutingOverrides(res: Response): Response {
  // A plain Response is not a Next.js continuation, so every x-middleware-* control header goes.
  const plain = !(res instanceof NextResponse);
  const keys = [...res.headers.keys()];
  const remove = keys.filter((key) => {
    const lower = key.toLowerCase();
    return (
      lower === "x-middleware-override-headers" ||
      lower.startsWith("x-middleware-request-") ||
      (plain && (lower === "x-middleware-next" || lower === "x-middleware-rewrite"))
    );
  });
  if (!remove.length) return res;
  try {
    for (const key of remove) res.headers.delete(key);
    return res;
  } catch {
    const headers = new Headers(res.headers);
    for (const key of remove) headers.delete(key);
    const init = { headers, status: res.status, statusText: res.statusText };
    return res instanceof NextResponse
      ? new NextResponse(res.body, init)
      : new Response(res.body, init);
  }
}

type ProxyHandler = (req: NextRequest, event: NextFetchEvent) => Promise<NextResponse | Response>;

function resolveConfig<TContext extends object>(
  overrides: ChainOptions<TContext>,
): ChainConfig<TContext> {
  const { logger, debug, ...rest } = overrides;

  const config = {
    cookieMergeStrategy: "last-write-wins",
    headerMergeStrategy: "last-write-wins",
    debug: false,
    timeout: 0,
    strictOverrideCheck: false,
    tracePath: true,
    ...rest,
    ...(debug !== undefined ? { debug } : {}),
    logger: safeLogger(logger ?? createConsoleLogger("info")),
  } satisfies ChainConfig<TContext>;

  assertValidTimeout(config.timeout);
  return config;
}

/** Internal executor for the public chain() composition helper. */
export function executeChain<TContext extends object = object>(
  options: ChainOptions<TContext>,
  entries: HandlerRule<TContext>[],
): ProxyHandler {
  const config = resolveConfig(options);

  const rules = entries.map(toRule);
  const {
    logger,
    debug: debugLevel,
    cookieMergeStrategy,
    headerMergeStrategy,
    timeout,
    strictOverrideCheck,
  } = config;
  const debug = debugLevel !== false;
  const hasHandlerDebug = rules.some((rule) => rule.debug != null && rule.debug !== false);
  const hasDetailedHandlerDebug = rules.some(
    (rule) => rule.debug === true || rule.debug === "detailed" || rule.debug === "verbose",
  );
  const diagnosticsEnabled = debug || config.onTrace !== undefined || hasHandlerDebug;

  assertOverrideMechanismSupported(strictOverrideCheck);

  for (let i = 0; i < rules.length; i++) {
    assertIncludeExcludeNoOverlap(rules[i]!.include, rules[i]!.exclude, ruleLabel(rules[i]!, i));
    assertValidTimeout(rules[i]!.timeout);
  }

  return async function proxy(req: NextRequest, event: NextFetchEvent) {
    const startedAt = Date.now();
    const invocationStartedAt = monotonicNow();
    const requestId = `req_${globalThis.crypto.randomUUID()}`;
    const metadata = createRequestMetadata(req, requestId, startedAt, invocationStartedAt);
    const applicationState = createApplicationState();
    const diagnostics: HandlerTrace[] | null = diagnosticsEnabled ? [] : null;
    let nextHandlerIndex = 0;
    const finish = (
      response: NextResponse | Response,
      forcedOutcome?: ChainOutcome,
    ): NextResponse | Response => {
      if (!diagnostics) return response;
      for (let i = nextHandlerIndex; i < rules.length; i++) {
        diagnostics.push({
          name: safeDiagnosticText(ruleLabel(rules[i]!, i), 64),
          outcome: "not-reached",
        });
      }
      const trace: ChainTrace = {
        requestId,
        startedAt,
        method: safeDiagnosticText(req.method, 16),
        pathname:
          config.tracePath === false ? undefined : safeDiagnosticText(metadata.originalPathname),
        durationMs: monotonicNow() - invocationStartedAt,
        outcome: forcedOutcome ?? responseOutcome(response),
        handlers: diagnostics,
      };
      if (config.onTrace) {
        try {
          void Promise.resolve(config.onTrace(trace)).catch(() => {});
        } catch {
          // Observability must not change the request outcome.
        }
      }
      const globalLevel = normalizeDebugLevel(debugLevel);
      if (globalLevel !== false || hasHandlerDebug) {
        const level =
          (globalLevel === "compact" || globalLevel === false) && hasDetailedHandlerDebug
            ? "detailed"
            : globalLevel === false
              ? "compact"
              : globalLevel;
        const visible =
          level === "compact"
            ? diagnostics
            : diagnostics.filter((_handler, index) => {
                const local = rules[index]?.debug;
                if (local === false) return false;
                if (local === "compact") return globalLevel === "compact";
                if (local != null) return true;
                return (
                  globalLevel !== false && !(globalLevel === "compact" && hasDetailedHandlerDebug)
                );
              });
        try {
          config.logger.info(
            formatTrace(
              level === "compact" ? trace : { ...trace, handlers: visible },
              level,
              shouldUseColor(),
              supportsUnicode(),
            ),
          );
        } catch {
          // A custom logger is an external integration, not part of request execution.
        }
      }
      return response;
    };

    const contextFor = (signal: AbortSignal) =>
      createHandlerContext<TContext>(metadata, applicationState, signal);

    let currentReq = req;
    let pendingRequestOverrides: Headers | null = null;
    let replaceRequestHeaders = false;
    let pendingRewriteUrl: string | null = null;

    const headerWrites: EntryWrite[] = [];
    const cookieWrites: EntryWrite[] = [];

    // Fail-closed 500 that keeps the headers and cookies earlier rules set (for example CSP).
    const failClosed = () =>
      finalizeResponse(
        safeInternalError(),
        headerWrites,
        cookieWrites,
        headerMergeStrategy,
        cookieMergeStrategy,
        logger,
        debug,
      );

    const requestCancelledResponse = () =>
      finish(
        finalizeResponse(
          NextResponse.next(),
          headerWrites,
          cookieWrites,
          headerMergeStrategy,
          cookieMergeStrategy,
          logger,
          debug,
        ),
        { type: "request-cancelled" },
      );

    const materializeRequest = (): NextRequest => {
      if (!pendingRequestOverrides) return currentReq;
      if (!replaceRequestHeaders && !headersDiffer(currentReq.headers, pendingRequestOverrides)) {
        pendingRequestOverrides = null;
        return currentReq;
      }
      const nextUrl = currentReq.nextUrl.clone();
      const merged = replaceRequestHeaders ? new Headers() : new Headers(currentReq.headers);
      pendingRequestOverrides.forEach((v, k) => {
        merged.set(k, v);
      });
      pendingRequestOverrides = null;
      replaceRequestHeaders = false;
      currentReq = new NextRequest(currentReq, { headers: merged });
      currentReq.nextUrl.pathname = nextUrl.pathname;
      currentReq.nextUrl.search = nextUrl.search;
      return currentReq;
    };

    const queueRequestOverrides = (overrides: Headers, mode?: "replace") => {
      if (mode === "replace") {
        pendingRequestOverrides = new Headers();
        replaceRequestHeaders = true;
      } else if (!pendingRequestOverrides) {
        pendingRequestOverrides = new Headers();
      }
      const target = pendingRequestOverrides;
      overrides.forEach((v, k) => {
        target.set(k, v);
      });
    };

    // Handles one failed execution without reusing its execution-scoped signal.
    const recoverRuleError = async (
      err: unknown,
      i: number,
      label: string,
      req: NextRequest,
      durationMs: number,
      phase: "before-handler" | "when" | "handler" | "result",
    ): Promise<
      { raw: RuleRaw; recovered: RecoveredRule } | { response: NextResponse | Response }
    > => {
      const timeoutError = err instanceof RuleTimeoutError;
      const requestCancelled = err instanceof RequestCancellationError;
      const errorHandler = rules[i]!.onError ?? config.onError;
      const errorPolicy = rules[i]!.onError ? "handler" : "chain";
      const diagnosticPhase = phase === "before-handler" ? "handler" : phase;
      const details = handlerDetails(rules[i]!, timeout, "matched", "matched", "not-matched");

      const stopFailure = (
        policy: "none" | "handler" | "chain",
      ): { response: NextResponse | Response } => {
        diagnostics?.push({
          name: safeDiagnosticText(label, 64),
          ...(requestCancelled
            ? {
                outcome: "request-cancelled" as const,
                durationMs,
                phase: phase === "result" ? ("handler" as const) : phase,
                policy,
              }
            : {
                outcome: timeoutError ? ("timeout" as const) : ("failed" as const),
                durationMs,
                phase: diagnosticPhase,
                policy,
                ...(timeoutError ? { timeoutMs: err.timeoutMs } : {}),
              }),
          details,
        });
        nextHandlerIndex = i + 1;
        if (requestCancelled) {
          return {
            response: finish(
              finalizeResponse(
                NextResponse.next(),
                headerWrites,
                cookieWrites,
                headerMergeStrategy,
                cookieMergeStrategy,
                logger,
                debug,
              ),
              { type: "request-cancelled" },
            ),
          };
        }
        if (timeoutError) {
          return {
            response: finish(failClosed(), {
              type: "timeout",
              status: 500,
              timeoutMs: err.timeoutMs,
            }),
          };
        }
        return {
          response: finish(failClosed(), {
            type: "error",
            status: 500,
            classification: "handler",
          }),
        };
      };

      if (!errorHandler) {
        if (!diagnosticsEnabled) logger.error("handler failed");
        return stopFailure("none");
      }

      try {
        const recovered = await runInRecoveryScope(req.signal, (signal) =>
          errorHandler(err, i, req, contextFor(signal)),
        );
        if (timeoutError || requestCancelled) {
          if (isTerminalRecovery(recovered)) {
            const response = stripRoutingOverrides(recovered);
            headerWrites.push({
              ruleIndex: i,
              ruleName: label,
              items: responseHeaderItems(response.headers),
            });
            cookieWrites.push({
              ruleIndex: i,
              ruleName: label,
              items: cookieItemsFromHeaders(response.headers),
            });
            diagnostics?.push({
              name: safeDiagnosticText(label, 64),
              ...(requestCancelled
                ? {
                    outcome: "request-cancelled" as const,
                    durationMs,
                    phase: phase === "result" ? ("handler" as const) : phase,
                    policy: errorPolicy,
                    recovery: "response" as const,
                  }
                : {
                    outcome: "timeout" as const,
                    durationMs,
                    phase: diagnosticPhase,
                    policy: errorPolicy,
                    recovery: "response" as const,
                    timeoutMs: err.timeoutMs,
                  }),
              details,
            });
            nextHandlerIndex = i + 1;
            return {
              response: finish(
                finalizeResponse(
                  response,
                  headerWrites,
                  cookieWrites,
                  headerMergeStrategy,
                  cookieMergeStrategy,
                  logger,
                  debug,
                ),
                requestCancelled
                  ? { type: "request-cancelled" }
                  : {
                      type: "timeout",
                      status: recovered.status,
                      timeoutMs: err.timeoutMs,
                    },
              ),
            };
          }
          return stopFailure(errorPolicy);
        }

        if (recovered == null) {
          return stopFailure(errorPolicy);
        }
        // Continuation and successful rewrite resume through the normal result path, which records the trace.
        if (isContinuingRecovery(recovered)) {
          return { raw: recovered, recovered: { durationMs, policy: errorPolicy, details } };
        }
        if (!(recovered instanceof Response)) {
          diagnostics?.push({
            name: safeDiagnosticText(label, 64),
            outcome: "failed",
            durationMs,
            phase: diagnosticPhase,
            policy: errorPolicy,
            details,
          });
          nextHandlerIndex = i + 1;
          return {
            response: finish(failClosed(), {
              type: "error",
              status: 500,
              classification: "handler",
            }),
          };
        }

        const response = stripRoutingOverrides(recovered);
        headerWrites.push({
          ruleIndex: i,
          ruleName: label,
          items: responseHeaderItems(response.headers),
        });
        cookieWrites.push({
          ruleIndex: i,
          ruleName: label,
          items: cookieItemsFromHeaders(response.headers),
        });
        diagnostics?.push({
          name: safeDiagnosticText(label, 64),
          outcome: "recovered",
          durationMs,
          recovery:
            responseOutcome(response).type === "redirect"
              ? "redirect"
              : responseOutcome(response).type === "rewrite"
                ? "rewrite"
                : "response",
          policy: errorPolicy,
          details,
        });
        nextHandlerIndex = i + 1;
        return {
          response: finish(
            finalizeResponse(
              response,
              headerWrites,
              cookieWrites,
              headerMergeStrategy,
              cookieMergeStrategy,
              logger,
              debug,
            ),
          ),
        };
      } catch {
        if (!diagnosticsEnabled) logger.error("chain error handler failed");
        return stopFailure(errorPolicy);
      }
    };

    try {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]!;
        const label = ruleLabel(rule, i);
        nextHandlerIndex = i;
        if (req.signal.aborted) {
          const cancelled = await recoverRuleError(
            new RequestCancellationError(),
            i,
            label,
            materializeRequest(),
            0,
            "before-handler",
          );
          if ("response" in cancelled) return cancelled.response;
          return requestCancelledResponse();
        }
        const activeReq = materializeRequest();

        const reqHost = normalizeHost(
          activeReq.headers.get("host") ?? activeReq.headers.get("x-forwarded-host"),
        );
        // Match the decoded path Next.js resolves; a raw, encoded path would skip include-scoped rules.
        const matchPath = canonicalPathname(activeReq.nextUrl.pathname);
        if (matchPath === null) {
          return finish(
            new NextResponse("Bad Request", {
              status: 400,
              headers: { "content-type": "text/plain; charset=utf-8" },
            }),
          );
        }
        const skipReason = ruleMatchReason(matchPath, reqHost, rule);
        if (skipReason) {
          diagnostics?.push({
            name: safeDiagnosticText(label, 64),
            outcome: "skipped",
            reason: skipReason,
            details: handlerDetails(
              rule,
              timeout,
              "not-evaluated",
              skipReason === "include-mismatch" ? "mismatch" : undefined,
              skipReason === "exclude-match"
                ? "matched"
                : skipReason === "include-mismatch" && rule.exclude
                  ? "not-matched"
                  : undefined,
            ),
          });
          nextHandlerIndex = i + 1;
          continue;
        }

        const executionStartedAt = monotonicNow();
        const effectiveTimeout = rule.timeout ?? timeout;
        let phase: "when" | "handler" = rule.when ? "when" : "handler";
        let result: { kind: "skipped" } | { kind: "result"; raw: RuleRaw };
        // Set only when this handler's own error recovery continued the chain.
        let recoveredRule: RecoveredRule | undefined;
        try {
          result = await runInExecutionScope(
            req.signal,
            effectiveTimeout,
            label,
            async (signal, assertActive) => {
              const context = contextFor(signal);
              if (rule.when) {
                const matches = await rule.when(activeReq, event, context);
                assertActive();
                if (!matches) return { kind: "skipped" as const };
              }
              phase = "handler";
              assertActive();
              return {
                kind: "result" as const,
                raw: await rule.run(activeReq, context, event),
              };
            },
          );
          if (result.kind === "skipped") {
            diagnostics?.push({
              name: safeDiagnosticText(label, 64),
              outcome: "skipped",
              reason: "when-false",
              details: handlerDetails(rule, timeout, "false", "matched", "not-matched"),
            });
            nextHandlerIndex = i + 1;
            continue;
          }
        } catch (err) {
          const recovered = await recoverRuleError(
            err,
            i,
            label,
            activeReq,
            monotonicNow() - executionStartedAt,
            phase,
          );
          if ("response" in recovered) return recovered.response;
          result = { kind: "result", raw: recovered.raw };
          recoveredRule = recovered.recovered;
        }

        let raw = result.raw;
        let duration = monotonicNow() - executionStartedAt;
        // A malformed return value is attributed to this rule, like a thrown error.
        let outcome: ResolvedOutcome;
        try {
          outcome = resolveRuleResult(raw);
        } catch (err) {
          const recovered = await recoverRuleError(err, i, label, activeReq, duration, "result");
          if ("response" in recovered) return recovered.response;
          raw = recovered.raw;
          recoveredRule = recovered.recovered;
          outcome = resolveRuleResult(raw);
        }

        if (outcome.kind === "continue") {
          if (outcome.rewriteUrl) {
            pendingRewriteUrl = outcome.rewriteUrl;
            if (currentReq === req) {
              currentReq = new NextRequest(currentReq);
            }
            try {
              const parsed = new URL(outcome.rewriteUrl);
              currentReq.nextUrl.pathname = parsed.pathname;
              currentReq.nextUrl.search = parsed.search;
            } catch {
              currentReq.nextUrl.pathname = outcome.rewriteUrl;
            }
          }

          if (outcome.request) queueRequestOverrides(outcome.request, outcome.requestMode);

          if (outcome.responseHeaders.size || outcome.cookies.size) {
            headerWrites.push({ ruleIndex: i, ruleName: label, items: outcome.responseHeaders });
            cookieWrites.push({ ruleIndex: i, ruleName: label, items: outcome.cookies });
          }

          // Exactly one entry per handler: the recovery entry or the normal outcome, never both.
          if (recoveredRule) {
            diagnostics?.push({
              name: safeDiagnosticText(label, 64),
              outcome: "recovered",
              durationMs: recoveredRule.durationMs,
              recovery: outcome.rewriteUrl ? "rewrite" : "continue",
              policy: recoveredRule.policy,
              details: recoveredRule.details,
            });
          } else {
            diagnostics?.push(
              outcome.rewriteUrl
                ? {
                    name: safeDiagnosticText(label, 64),
                    outcome: "rewrite",
                    durationMs: duration,
                    destination: safeDestination(outcome.rewriteUrl) ?? "/",
                    final: false,
                    details: handlerDetails(rule, timeout, "matched", "matched", "not-matched"),
                  }
                : {
                    name: safeDiagnosticText(label, 64),
                    outcome: "continue",
                    source:
                      raw instanceof NextResponse && raw.headers.get("x-middleware-next") === "1"
                        ? "NextResponse.next()"
                        : "undefined",
                    durationMs: duration,
                    details: handlerDetails(rule, timeout, "matched", "matched", "not-matched"),
                  },
            );
          }
          nextHandlerIndex = i + 1;
          continue;
        }

        const response = stripRoutingOverrides(outcome.response);
        headerWrites.push({
          ruleIndex: i,
          ruleName: label,
          items: responseHeaderItems(response.headers),
        });
        cookieWrites.push({
          ruleIndex: i,
          ruleName: label,
          items: cookieItemsFromHeaders(response.headers),
        });

        const terminalOutcome = responseOutcome(response);
        diagnostics?.push(
          terminalOutcome.type === "redirect"
            ? {
                name: safeDiagnosticText(label, 64),
                outcome: "redirect",
                durationMs: duration,
                status: terminalOutcome.status,
                destination: terminalOutcome.destination,
                details: handlerDetails(rule, timeout, "matched", "matched", "not-matched"),
              }
            : terminalOutcome.type === "rewrite"
              ? {
                  name: safeDiagnosticText(label, 64),
                  outcome: "rewrite",
                  durationMs: duration,
                  destination: terminalOutcome.destination,
                  final: true,
                  details: handlerDetails(rule, timeout, "matched", "matched", "not-matched"),
                }
              : {
                  name: safeDiagnosticText(label, 64),
                  outcome: "response",
                  durationMs: duration,
                  status: response.status,
                  details: handlerDetails(rule, timeout, "matched", "matched", "not-matched"),
                },
        );
        nextHandlerIndex = i + 1;

        const finalTerminalOutcome = responseOutcome(response);
        const terminalTrace = diagnostics?.at(-1);
        if (finalTerminalOutcome.type === "rewrite" && terminalTrace?.outcome === "rewrite") {
          terminalTrace.destination = finalTerminalOutcome.destination;
        }

        return finish(
          finalizeResponse(
            response,
            headerWrites,
            cookieWrites,
            headerMergeStrategy,
            cookieMergeStrategy,
            logger,
            debug,
          ),
          finalTerminalOutcome,
        );
      }

      const finalReq = materializeRequest();
      const finalRewriteUrl: string | null = pendingRewriteUrl;

      // Forwarding unchanged headers would encode every request header as x-middleware-request-*.
      const requestInit = finalReq !== req ? { request: { headers: finalReq.headers } } : undefined;
      let final: NextResponse;
      if (finalRewriteUrl) {
        const rewriteTarget = new URL(finalRewriteUrl, finalReq.url);
        final = NextResponse.rewrite(rewriteTarget, requestInit);
      } else {
        final = NextResponse.next(requestInit);
      }

      const finalResponse = finalizeResponse(
        final,
        headerWrites,
        cookieWrites,
        headerMergeStrategy,
        cookieMergeStrategy,
        logger,
        debug,
      );
      if (finalRewriteUrl) {
        const destination = safeDestination(finalRewriteUrl) ?? "/";
        const rewrite = diagnostics?.filter((handler) => handler.outcome === "rewrite").at(-1);
        if (rewrite?.outcome === "rewrite") {
          rewrite.destination = destination;
          rewrite.final = true;
        }
      }
      return finish(finalResponse);
    } catch (err) {
      if (!diagnosticsEnabled) logger.error("proxy chain execution failed");
      if (config.onError) {
        try {
          const recovered = await runInRecoveryScope(req.signal, (signal) =>
            config.onError!(err, -1, materializeRequest(), contextFor(signal)),
          );
          // No later rule can run here, so a continuation response would skip them. Fail closed.
          if (isTerminalRecovery(recovered)) {
            const response = stripRoutingOverrides(recovered);
            return finish(
              finalizeResponse(
                response,
                headerWrites,
                cookieWrites,
                headerMergeStrategy,
                cookieMergeStrategy,
                logger,
                debug,
              ),
            );
          }
        } catch {
          /* fall through to safe 500 */
        }
      }
      return finish(
        failClosed(),
        err instanceof RuleTimeoutError
          ? { type: "timeout", status: 500, timeoutMs: err.timeoutMs }
          : { type: "error", status: 500, classification: "engine" },
      );
    }
  };
}
