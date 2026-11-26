import { DEFINED_HANDLER } from "./constants";
import { executeChain } from "./engine";
import { withPaths } from "./matching";
import type { DefinedHandler } from "./handler";
import type {
  NativeProxy,
  PathMatcher,
  ChainOptions,
  HandlerFn,
  HandlerFilter,
  HandlerRule,
  RouteScopeList,
} from "./types";

/** Scope for a tuple entry: `[handler, scope]`. A string, RegExp, or array is shorthand for `include`. */
export type ChainScope = Omit<HandlerFilter, "name"> | PathMatcher | readonly PathMatcher[];

/** One entry of chain(): a native handler, a defineHandler() result, or a scoped tuple. */
export type ChainEntry<TContext extends object = object> =
  | NativeProxy<TContext>
  | DefinedHandler<TContext>
  | readonly [NativeProxy<TContext> | DefinedHandler<TContext>, ChainScope];

function isDefinedHandler<TContext extends object>(
  value: unknown,
): value is DefinedHandler<TContext> {
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
function fromNative<TContext extends object>(
  handler: NativeProxy<TContext>,
): HandlerRule<TContext> {
  const run: HandlerFn<TContext> = (req, ctx, event) => handler(req, event, ctx);
  const name = handler.name && handler.name !== "proxy" ? handler.name : undefined;
  return { run, name };
}

function toEntry<TContext extends object>(entry: ChainEntry<TContext>): HandlerRule<TContext> {
  if (Array.isArray(entry)) {
    const [target, scope] = entry as readonly [
      NativeProxy<TContext> | DefinedHandler<TContext>,
      ChainScope,
    ];
    const filter = toFilter(scope);
    if (isDefinedHandler<TContext>(target)) return withPaths(target, filter);
    return withPaths(fromNative(target as NativeProxy<TContext>), filter);
  }
  if (isDefinedHandler<TContext>(entry)) return entry;
  if (typeof entry === "function") return fromNative(entry as NativeProxy<TContext>);
  throw new TypeError(
    "[proxy-chain] chain entries must be native handlers or defineHandler() results",
  );
}

/**
 * Composes native Next.js proxy handlers and defineHandler() results into one proxy.
 *
 * - A plain function receives native `(request, event)` arguments plus context as a third argument.
 * - A `defineHandler()` handler receives `(request, event, context)`.
 * - `[handler, scope]` runs the handler only for matching paths or hosts.
 *
 * @example
 * export default chain([intlProxy, [authProxy, { include: '/dashboard/**' }]])
 */
export function chain<TContext extends object = object>(
  entries: readonly ChainEntry<TContext>[],
  options?: ChainOptions<TContext>,
): ReturnType<typeof executeChain> {
  const normalized = entries.map((entry) => toEntry(entry));
  return executeChain(options ?? {}, normalized);
}
