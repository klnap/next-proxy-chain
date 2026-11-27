import api = require("@klnap/next-proxy-chain");
import { NextResponse } from "next/server";
import type {
  ChainEntry,
  ChainLogger,
  ChainOptions,
  ChainOutcome,
  ChainTrace,
  DebugLevel,
  HandlerConfig,
  HandlerDiagnosticDetails,
  HandlerTrace,
  HandlerWhen,
  HandlerContext,
  HostMatcher,
  MergeStrategy,
  NativeProxy,
  OnErrorHandler,
  OnErrorResult,
  PathMatcher,
  RequestMetadata,
  SkipReason,
  TraceCallback,
} from "@klnap/next-proxy-chain";

type AppContext = { requestIdSeen?: string };
const inline = api.chain<AppContext>([
  {
    name: "inline-release-check",
    rules: { include: "/release/**" },
    handle(request, _event, context) {
      context.requestIdSeen = context.requestId;
      const headers = new Headers(request.headers);
      headers.set("x-request-id", context.requestId);
      return NextResponse.next({ request: { headers } });
    },
  },
]);
const reusable = api.defineHandler<AppContext>({
  name: "reusable-release-check",
  rules: { include: "/release/**", when: async (request) => request.method === "GET" },
  timeout: 250,
  debug: "compact",
  onError: () => NextResponse.next(),
  handle: async (request, _event, context) => {
    const pathname: string = request.nextUrl.pathname;
    context.requestIdSeen = context.requestId;
    return pathname ? NextResponse.next() : undefined;
  },
});
const proxy = api.chain<AppContext>([reusable], { timeout: 500, debug: false });

// @ts-expect-error Tuple entries are not part of the public chain contract.
api.chain([[() => undefined, "/release/**"]]);

// @ts-expect-error The removed `handler` property is not accepted.
api.chain([{ name: "old-property", handler: () => undefined }]);

// @ts-expect-error The package-specific continuation export is removed.
api.next();

// @ts-expect-error Invalid values are rejected as chain entries.
const invalidEntry: ChainEntry = 42;
void invalidEntry;
void proxy;
void inline;
void reusable;

type PublicTypes = [
  ChainEntry,
  ChainLogger,
  ChainOptions,
  ChainOutcome,
  ChainTrace,
  DebugLevel,
  HandlerConfig,
  HandlerDiagnosticDetails,
  HandlerTrace,
  HandlerWhen,
  HostMatcher,
  MergeStrategy,
  NativeProxy,
  OnErrorHandler,
  OnErrorResult,
  PathMatcher,
  HandlerContext,
  RequestMetadata,
  SkipReason,
  TraceCallback,
];

void (0 as unknown as PublicTypes);
