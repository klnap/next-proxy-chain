# API reference

The runtime entry exports two functions:

```ts
import { chain, defineHandler } from "@klnap/next-proxy-chain";
```

Next.js owns HTTP responses. Use `NextResponse` from `next/server` and standard Web `Response`, `Headers`, and `AbortSignal`.

## `chain()`

```ts
chain<TContext extends object = object>(
  entries: readonly ChainEntry<TContext>[],
  options?: ChainOptions<TContext>,
): (request: NextRequest, event: NextFetchEvent) => Promise<NextResponse | Response>
```

`chain()` accepts native handler functions and configured handler objects. Entries run sequentially. A `NextResponse.next()` or `undefined` continues; redirects and terminal responses stop.

## `defineHandler()`

```ts
defineHandler<TContext extends object = object>(
  options: HandlerConfig<TContext>,
): HandlerConfig<TContext>
```

It validates and returns the same configuration object. Inline and reusable configurations have the same type and normalization behavior.

## Configured handler

```ts
type HandlerConfig<TContext extends object = object> = {
  name: string;
  rules?: {
    include?: RouteScopeList;
    exclude?: RouteScopeList;
    when?: HandlerWhen<TContext>;
  };
  timeout?: number;
  debug?: DebugLevel;
  onError?: OnErrorHandler<TContext>;
  handle: NativeProxy<TContext>;
};
```

`name` must be a non-empty string. `handle` must be a function. `rules`, `timeout`, `debug`, and `onError` are optional. `handle` appears last in examples by convention, not requirement.

```ts
defineHandler({
  name: "authentication",
  rules: { include: "/dashboard/**" },
  timeout: 500,
  debug: true,
  onError: handleError,
  handle: async (request, event, context) => {
    return authenticate(request, event, context.signal);
  },
});
```

Arrow functions are the primary convention for `handle`, `when`, and `onError`. Async functions, function references, and object method syntax also satisfy the contract.

## Native handler

```ts
type NativeProxy<TContext extends object = object> = (
  request: NextRequest,
  event: NextFetchEvent,
  context: HandlerContext<TContext>,
) =>
  | NextResponse
  | Response
  | undefined
  | void
  | Promise<NextResponse | Response | undefined | void>;
```

Two-argument Next.js handlers remain composable. The chain adds context as the optional third callback argument and passes through the original `event`.

## Matching

`Next.js config.matcher` filters whether the entrypoint runs. Handler `rules` filter configured handlers after entrypoint invocation.

- `include` and `exclude` accept a path string, `RegExp`, or objects with `path` and/or `host`.
- `*` matches one path segment. `**` matches zero or more segments.
- `exclude` takes precedence over `include`.
- `when(request, event, context)` may return a boolean or `Promise<boolean>`.
- Matching uses the effective request at each handler's turn. A continued rewrite changes later path matching and the query visible to predicates; original context metadata remains unchanged.
- Rewrites do not change the host used for matching. Host scopes read the effective `host` header, falling back to `x-forwarded-host`; a prior native request-header replacement of either header changes later host matching.

Host matcher strings compare case-insensitively and ignore ports. Host wildcards match one DNS label. See [Concepts](concepts.md#matching) for examples.

## Return values

| Handler returns              | Chain behavior                                    |
| ---------------------------- | ------------------------------------------------- |
| `undefined`                  | Continue to the next handler.                     |
| `NextResponse.next()`        | Compose HTTP effects and continue.                |
| `NextResponse.rewrite(url)`  | Stage the rewrite and continue to later handlers. |
| `NextResponse.redirect(url)` | Stop and redirect.                                |
| Terminal `Response`          | Stop and return the response.                     |

Only `NextResponse` routing responses are interpreted as continuation or rewrite instructions. A plain `Response` remains terminal, even if it contains Next.js routing headers.

`NextResponse.rewrite()` continues only for a successful rewrite response. Non-success responses are terminal. Redirects are terminal.

## Request headers

Use native `NextResponse.next({ request: { headers } })`. Next.js treats `headers` as the replacement request-header set, not a partial merge. Clone the effective request headers to preserve them:

```ts
const headers = new Headers(request.headers);
headers.set("x-request-id", context.requestId);
return NextResponse.next({ request: { headers } });
```

Removing a header means deleting it from the `Headers` instance before returning it. A replacement that omits a prior request header deletes that header downstream.

Each continued native override becomes the effective request seen by later rules. The engine reconstructs `NextRequest` using Next.js's encoded override metadata, while retaining staged rewrite URL state, request signal, and original chain metadata. Request headers remain separate from client-facing response headers.

There is no package-level request-header allow/deny policy. Handler code explicitly chooses the forwarded header set. Validate untrusted values before adding or changing headers.

## Response headers and cookies

Mutate the native response:

```ts
const response = NextResponse.next();
response.headers.set("x-content-type-options", "nosniff");
response.cookies.set("locale", "en");
return response;
```

Continued response headers and cookies compose onto the final response. The default merge strategy is last-write-wins. `headerMergeStrategy` and `cookieMergeStrategy` can select `"first-write-wins"` or a custom resolver; returning `null` from a resolver removes that header or cookie identity.

Cookie identity includes cookie name, domain, and path. Distinct paths remain distinct.

## Context and cancellation

`HandlerContext<TContext>` contains:

- `requestId`: generated `req_` identifier.
- `startedAt`: request start time.
- `elapsedMs`: elapsed request duration.
- `originalUrl`, `originalPathname`, and `originalHostname`: original request metadata.
- `signal`: execution-scoped `AbortSignal`.
- Custom properties from `TContext`.

Custom state is shared between handlers for one request and isolated across requests. Properties may be `undefined` until initialized. Context and request IDs are not forwarded to route handlers automatically.

## Errors and timeouts

`timeout` is a per-handler execution budget in milliseconds; `0` disables timeouts. A handler's timeout overrides the chain timeout. The handler's predicate shares its budget. Timeout aborts the execution signal and stops the chain.

Handler-level `onError` takes precedence over chain-level `onError`. For ordinary errors, returning `NextResponse.next()` or a successful `NextResponse.rewrite()` continues after the failed handler; a rewrite is staged like a normal rewrite. Returning any other `Response` terminates with that response. Returning `undefined`, `void`, or `null`, throwing, or returning an unsupported value fails closed.

For timeout, request cancellation, and engine-level failures, recovery accepts only a terminal Web `Response`, including a redirect. `NextResponse.next()` and successful `NextResponse.rewrite()` are rejected because they would resume routing. A rejected timeout or engine-level recovery returns `500`. Without recovery, timeout returns `500`. Cancellation stops the package chain and returns a native `NextResponse.next()` handoff; Next.js may continue downstream routing, so this is not a fail-closed response. Error diagnostics record the chosen recovery policy.

## Chain options

| Option                | Default             | Meaning                                                                                             |
| --------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `timeout`             | `0`                 | Per-handler deadline in milliseconds.                                                               |
| `debug`               | `false`             | Disable logs, or select `true`, `"compact"`, `"detailed"`, or `"verbose"`.                          |
| `logger`              | Console logger      | Logger with `debug`, `info`, `warn`, and `error` methods.                                           |
| `onError`             | None                | Chain-level error recovery. Handler-level `onError` takes precedence.                               |
| `onTrace`             | None                | Receives structured request traces.                                                                 |
| `tracePath`           | `true`              | Include the original request pathname in the top-level structured trace and formatted request line. |
| `headerMergeStrategy` | `"last-write-wins"` | Resolve response-header conflicts.                                                                  |
| `cookieMergeStrategy` | `"last-write-wins"` | Resolve cookie conflicts.                                                                           |
| `strictOverrideCheck` | `false`             | Throw at chain creation if native Next.js request-header override metadata cannot be verified.      |

Handler `timeout` and `debug` override their chain-level values. Chain-level `onError` is used only when a handler does not define its own.

`strictOverrideCheck` tests whether the active Next.js `NextResponse.next()` encodes a sentinel request-header override. The probe runs when the first chain is constructed and caches its result for that package module. A successful probe is silent and leaves normal native header replacement behavior unchanged.

If the probe reports unsupported behavior or throws, `strictOverrideCheck: true` throws during chain construction. With the default `false`, an uncached failed probe warns and chain construction continues; later chains reuse the result without probing again. The package does not emulate the override mechanism. Request-header replacements may then be missing from later handlers or downstream Next.js code. Use `true` to fail fast when the application depends on native request-header forwarding.

The probe checks Next.js's generated override metadata. It does not verify that the deployed runtime later applies that metadata.

`tracePath: false` removes only the original request pathname from `ChainTrace.pathname` and the formatted request line. It does not remove paths in matched scope details or rewrite and redirect destinations. Destination query values are replaced with `?[query]`.

## Public types

The package exports `ChainEntry`, `ChainOptions`, `HandlerConfig`, `NativeProxy`, `OnErrorHandler`, `OnErrorResult`, `HandlerContext`, `RequestMetadata`, matcher types, and structured diagnostic types.

It exports no helper-specific continuation token, response wrapper, or request-header policy.
