# v2 request context and cancellation contract

Status: approved implementation contract

This specification records the final v2 decisions for request metadata, handler
context, cooperative cancellation, timeout handling, diagnostics, and removal of
application-specific host-folder behavior. It supplements the current API,
concepts, security, and guide documents.

## Public context

Each chain invocation creates one request identity and immutable request
metadata. The public types are:

```ts
export type RequestMetadata = {
  readonly requestId: string;
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly originalUrl: string;
  readonly originalPathname: string;
  readonly originalHostname: string;
};

export type HandlerContext<TContext extends object = {}> = RequestMetadata &
  Omit<Partial<TContext>, keyof RequestMetadata | "signal"> & {
    readonly signal: AbortSignal;
  };
```

`RequestMetadata` is a primitive snapshot from the incoming `NextRequest`.
`startedAt` is Unix epoch milliseconds from `Date.now()`. `elapsedMs` is a
dynamic, read-only value measured from invocation start with `performance.now()`.
`originalPathname` and `originalHostname` use `request.nextUrl`; the original
URL uses `request.url`. Metadata never changes after handlers begin.

The default application context has no application properties. A consumer may
provide `chain<AppContext>(...)`; those properties are optional until written,
mutable between handlers, and isolated to one request. No context factory is
public or required. Reusable descriptors, plain handlers, predicates, and error
recovery use `HandlerContext<TContext>`.

The seven reserved properties are `requestId`, `startedAt`, `elapsedMs`,
`originalUrl`, `originalPathname`, `originalHostname`, and `signal`. Consumer
types cannot replace them. Runtime writes, deletes, redefinitions, or prototype
changes to reserved properties fail. Context views use null-prototype backing
state; application properties remain mutable. Predicates and their handler
share one view and signal. Different execution scopes may receive different
view objects while sharing request metadata and application state.

## Request identity and privacy

Each invocation creates exactly one `req_${crypto.randomUUID()}` identifier.
It is independent of incoming headers and contains no user data. The ID is
stable across handlers, predicates, rewrites, reconstruction, recovery, and
traces. It is not a distributed tracing identifier.

The package does not add request or response headers. It does not serialize the
context, original URL, query, headers, cookies, bodies, errors, or cancellation
reasons into diagnostics. Consumers may forward the ID explicitly with native
Next.js request-header APIs.

## Cancellation and timeout

Each matched handler gets an execution scope with a fresh native
`AbortController`. Its predicate and handler share that scope and one effective
deadline. The scope signal follows `request.signal` and the handler timeout.
Different handlers never share a signal. Successful completion does not abort
the signal. Owned timers and request-signal listeners are removed when a scope
settles.

The chain-level v2 option is `timeout`; handler-level `defineHandler({timeout})`
overrides it. An omitted handler timeout inherits the chain timeout. Zero
disables that timeout. The default is disabled. Values must be finite integers
from zero through `2_147_483_647` milliseconds; invalid values throw before
request processing. The timeout covers the predicate and handler together.

Timeout aborts the execution signal, records a timeout classification, and
stops the chain. The engine stops waiting at the deadline even if user code
ignores the signal. A predicate that finishes after timeout cannot start its
handler. Ordinary handler errors retain explicit `onError` recovery, including
continuation. Timeout recovery uses a separate context view linked only to the
native request signal; only a terminal `Response` is accepted. Missing,
throwing, or continuing recovery fails closed with status 500.

When the native request signal is already aborted, no handler starts. If it
aborts during a predicate or handler, the active scope is aborted and no later
chain handler starts. Cancellation is classified separately from timeout and
ordinary `AbortError` exceptions. Error recovery receives a separate context
view linked to the native request signal; only a terminal response is accepted.
Without one, the chain returns `NextResponse.next()` as the framework-native
handoff. This does not guarantee that the framework will skip downstream route
work after a client disconnect.

Recovery has no separate timeout. Cooperative cancellation cannot stop
synchronous JavaScript, force operations that ignore `AbortSignal` to stop,
undo side effects, revoke references held by user code, or provide transaction
isolation. It does not automatically cancel promises registered with
`event.waitUntil()`. Native client-disconnect propagation depends on the
Next.js runtime and deployment platform.

The original `NextFetchEvent` is passed through unchanged. Handler timeout
supervises the awaited predicate and handler result only; it does not supervise
background work registered with `waitUntil()`. A signal explicitly passed to
background work has the handler scope's lifecycle.

## Timing and traces

`startedAt` uses wall-clock time once per invocation. `elapsedMs`, handler
durations, and trace `durationMs` use monotonic time. Handler duration covers
predicate plus handler execution until completion, timeout, or cancellation;
it excludes recovery. Trace duration covers the full chain, including recovery
and response finalization.

Every emitted structured `ChainTrace` contains `requestId`, `startedAt`, and
`durationMs`. Traces distinguish timeout, native request cancellation, ordinary
failure, recovery, skipped handlers, and handlers not reached. They never
contain signal/controller instances or raw cancellation reasons. `tracePath`
continues to control pathname disclosure.

Every enabled built-in debug mode includes the request ID. Compact mode remains
one line; detailed and verbose modes include a request line and handler status.
Existing color, Unicode, sanitization, truncation, local debug overrides, and
logger/callback failure isolation remain in force.

## Routing and removed functionality

The package remains a generic native Next.js composition layer. It retains host
normalization, wildcard host matching, host/path combinations, native rewrites,
and request/response composition.

The v2 package removes tenant concepts, host-folder configuration, internal
host-folder headers, automatic folder prefixes, and their helper module,
exports, tests, examples, and active documentation. Ordinary user-defined
handlers remain the way to implement application-specific routing.

## Timeout option migration

The current implementation uses chain option `ruleTimeoutMs`. The requested v2
API standardizes this as `timeout`, matching the existing handler-level option.
The v2 major release removes `ruleTimeoutMs`; it is not retained as an alias.

## Runtime and verification boundary

The package keeps zero runtime dependencies and supports its existing Next.js
15 Middleware and Next.js 16 Proxy integrations. Request and response
reconstruction must preserve the native request signal. `AbortSignal.any()` is
not required; cancellation composition uses supported native
`AbortController`/`AbortSignal` listener APIs.

Tests cover the public handler seam, request isolation, cancellation races,
timeout recovery, diagnostics, and routing. Packed consumers cover ESM,
CommonJS, TypeScript, and the supported Next.js versions. Live runtime
compatibility is reported separately from mocked `NextRequest` tests; client
disconnect behavior is not claimed unless verified in a live runtime.
