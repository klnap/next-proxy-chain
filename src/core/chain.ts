import type { NextFetchEvent, NextRequest } from "next/server";
import { DEFINED_HANDLER } from "./constants";
import { executeChain } from "./engine";
import { withPaths } from "./matching";
import type { DefinedHandler } from "./handler";
import type {
  NativeProxy,
  PathMatcher,
  ChainOptions,
  ProxyContext,
  HandlerFn,
  HandlerFilter,
  HandlerRule,
  RouteScopeList,
} from "./types";

/** Scope for a tuple entry: `[handler, scope]`. A string, RegExp, or array is shorthand for `include`. */
export type ChainScope = Omit<HandlerFilter, "name"> | PathMatcher | readonly PathMatcher[];

/** One entry of chain(): a native handler, a defineHandler() result, or a scoped tuple. */
export type ChainEntry<TContext = ProxyContext> =
  | NativeProxy<TContext>
  | DefinedHandler<TContext>
  | readonly [NativeProxy<TContext> | DefinedHandler<TContext>, ChainScope];

function isDefinedHandler(value: unknown): value is DefinedHandler<ProxyContext> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[DEFINED_HANDLER] === true
  );
}

function isScopeObject(value: ChainScope): value is Omit<HandlerFilter, "name"> {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof RegExp) &&
    !Array.isArray(value)
  );
}

function toFilter(scope: ChainScope): HandlerFilter {
  if (isScopeObject(scope)) return { include: scope.include, exclude: scope.exclude };
  return { include: scope as RouteScopeList };
}

/** Adapts a native (req, event) handler to the internal (req, ctx, event) rule signature. */
function fromNative(handler: NativeProxy<ProxyContext>): HandlerRule {
  const run: HandlerFn = (req, ctx, event: NextFetchEvent) => handler(req, event, ctx);
  const name = handler.name && handler.name !== "proxy" ? handler.name : undefined;
  return { run, name };
}

function toEntry(entry: ChainEntry<ProxyContext>): HandlerRule<ProxyContext> {
  if (Array.isArray(entry)) {
    const [target, scope] = entry as readonly [
      NativeProxy<ProxyContext> | DefinedHandler<ProxyContext>,
      ChainScope,
    ];
    const filter = toFilter(scope);
    if (isDefinedHandler(target)) return withPaths(target, filter);
    return withPaths(fromNative(target as NativeProxy<ProxyContext>), filter);
  }
  if (isDefinedHandler(entry)) return entry;
  if (typeof entry === "function") return fromNative(entry as NativeProxy<ProxyContext>);
  throw new TypeError(
    "[proxy-chain] chain entries must be native handlers or defineHandler() results",
  );
}

/**
 * Composes native Next.js proxy handlers and defineHandler() results into one proxy.
 *
 * - A plain function receives `(request, event)`, exactly like a native `proxy.ts` export.
 * - A `defineHandler()` handler receives `(request, event, context)`.
 * - `[handler, scope]` runs the handler only for matching paths or hosts.
 *
 * @example
 * export default chain([intlProxy, [authProxy, { include: '/dashboard/**' }]])
 */
export function chain(
  entries: readonly ChainEntry<ProxyContext>[],
  options?: ChainOptions<ProxyContext>,
): ReturnType<typeof executeChain>;
export function chain<TContext>(
  entries: readonly ChainEntry<TContext>[],
  options: ChainOptions<TContext> & {
    createContext: (req: NextRequest, event: NextFetchEvent) => TContext;
  },
): ReturnType<typeof executeChain>;
export function chain<TContext>(
  entries: readonly ChainEntry<TContext>[],
  options?: ChainOptions<TContext>,
): ReturnType<typeof executeChain> {
  const normalized = entries.map((entry) => toEntry(entry as ChainEntry<ProxyContext>));
  return executeChain((options ?? {}) as ChainOptions<ProxyContext>, normalized);
}
