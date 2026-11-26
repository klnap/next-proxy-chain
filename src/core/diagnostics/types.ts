import type { NextFetchEvent, NextRequest } from "next/server";
import type { HandlerContext } from "../context";
import type { NextResult, OnErrorHandler } from "../types";

export type DebugLevel = false | true | "compact" | "detailed" | "verbose";
export type NormalizedDebugLevel = false | "compact" | "detailed" | "verbose";
export type SkipReason = "include-mismatch" | "exclude-match" | "when-false";

export type HandlerDiagnosticDetails = {
  include?: readonly string[];
  includeResult?: "matched" | "mismatch";
  exclude?: readonly string[];
  excludeResult?: "not-matched" | "matched";
  when?: "matched" | "false" | "not-evaluated";
  timeoutMs?: number;
  timeoutSource?: "handler" | "chain";
};

type NamedHandler = { name: string; details?: HandlerDiagnosticDetails };

export type HandlerTrace =
  | (NamedHandler & {
      outcome: "continue";
      source: "undefined" | "NextResponse.next()" | "next()";
      durationMs: number;
    })
  | (NamedHandler & {
      outcome: "rewrite";
      durationMs: number;
      destination: string;
      final: boolean;
    })
  | (NamedHandler & {
      outcome: "redirect";
      durationMs: number;
      status: number;
      destination?: string;
    })
  | (NamedHandler & {
      outcome: "response";
      durationMs: number;
      status: number;
    })
  | (NamedHandler & {
      outcome: "skipped";
      reason: SkipReason;
    })
  | (NamedHandler & {
      outcome: "not-reached";
    })
  | (NamedHandler & {
      outcome: "recovered";
      durationMs: number;
      recovery: "continue" | "rewrite" | "redirect" | "response";
      policy: "handler" | "chain";
    })
  | (NamedHandler & {
      outcome: "failed" | "timeout";
      durationMs: number;
      policy: "none" | "handler" | "chain";
      phase?: "when" | "handler" | "result" | "recovery";
      recovery?: "response";
      timeoutMs?: number;
    })
  | (NamedHandler & {
      outcome: "request-cancelled";
      durationMs: number;
      phase: "before-handler" | "when" | "handler";
      policy: "none" | "handler" | "chain";
      recovery?: "response";
    });

export type ChainOutcome =
  | { type: "next" }
  | { type: "rewrite"; destination: string }
  | { type: "redirect"; status: number; destination?: string }
  | { type: "response"; status: number }
  | { type: "error"; status: number; classification: "handler" | "engine" }
  | { type: "timeout"; status: number; timeoutMs: number }
  | { type: "request-cancelled" };

export type ChainTrace = {
  requestId: string;
  startedAt: number;
  method: string;
  pathname?: string;
  durationMs: number;
  outcome: ChainOutcome;
  handlers: readonly HandlerTrace[];
};

export type TraceCallback = (trace: ChainTrace) => void | Promise<void>;

export type HandlerWhen<TContext extends object = object> = (
  request: NextRequest,
  event: NextFetchEvent,
  context: HandlerContext<TContext>,
) => boolean | Promise<boolean>;

export type HandlerDebugOptions<TContext extends object = object> = {
  name?: string;
  debug?: DebugLevel;
  timeout?: number;
  onError?: OnErrorHandler<TContext>;
  rules?: {
    include?: import("../types").RouteScopeList;
    exclude?: import("../types").RouteScopeList;
    when?: HandlerWhen<TContext>;
  };
  handler: (
    request: NextRequest,
    event: NextFetchEvent,
    context: HandlerContext<TContext>,
  ) => Response | NextResult | undefined | void | Promise<Response | NextResult | undefined | void>;
};
