import * as api from "@klnap/next-proxy-chain";
import type {
  ChainEntry,
  ChainLogger,
  ChainOptions,
  ChainOutcome,
  ChainScope,
  ChainTrace,
  DebugLevel,
  DefinedHandler,
  HandlerDebugOptions,
  HandlerDiagnosticDetails,
  HandlerTrace,
  HandlerWhen,
  HostMatcher,
  MergeStrategy,
  NativeProxy,
  NextOptions,
  NextResult,
  OnErrorHandler,
  OnErrorResult,
  PathMatcher,
  ProxyContext,
  RequestHeaderPolicy,
  SkipReason,
  TraceCallback,
} from "@klnap/next-proxy-chain";

const result: NextResult = api.next();
if (!api.isNextResult(result)) {
  throw new Error("next() must return a continuation result");
}

const proxy = api.chain([api.defineHandler({ name: "release-check", handler: () => undefined })]);

// @ts-expect-error Invalid values are rejected as chain entries.
const invalidEntry: ChainEntry = 42;
void invalidEntry;
void proxy;

type PublicTypes = [
  ChainEntry,
  ChainLogger,
  ChainOptions,
  ChainOutcome,
  ChainScope,
  ChainTrace,
  DebugLevel,
  DefinedHandler,
  HandlerDebugOptions,
  HandlerDiagnosticDetails,
  HandlerTrace,
  HandlerWhen,
  HostMatcher,
  MergeStrategy,
  NativeProxy,
  NextOptions,
  NextResult,
  OnErrorHandler,
  OnErrorResult,
  PathMatcher,
  ProxyContext,
  RequestHeaderPolicy,
  SkipReason,
  TraceCallback,
];

void (0 as unknown as PublicTypes);
