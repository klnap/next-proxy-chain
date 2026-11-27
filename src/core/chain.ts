import { executeChain } from "./engine";
import { toHandlerRule } from "./handler";
import type { ChainOptions, HandlerConfig, HandlerFn, HandlerRule, NativeProxy } from "./types";

/** One entry of chain(): a native handler or configured handler. */
export type ChainEntry<TContext extends object = object> =
  | NativeProxy<TContext>
  | HandlerConfig<TContext>;

/** Adapts a native (req, event) handler to the internal (req, ctx, event) rule signature. */
function fromNative<TContext extends object>(handle: NativeProxy<TContext>): HandlerRule<TContext> {
  const run: HandlerFn<TContext> = (req, ctx, event) => handle(req, event, ctx);
  const name = handle.name && handle.name !== "proxy" ? handle.name : undefined;
  return { run, name };
}

function toEntry<TContext extends object>(entry: ChainEntry<TContext>): HandlerRule<TContext> {
  if (typeof entry === "function") return fromNative(entry as NativeProxy<TContext>);
  if (Array.isArray(entry)) {
    throw new TypeError("[proxy-chain] tuple entries are not supported; use a configured handler");
  }
  if (entry && typeof entry === "object") return toHandlerRule(entry as HandlerConfig<TContext>);
  throw new TypeError("[proxy-chain] chain entries must be native handlers or configured handlers");
}

/**
 * Composes native Next.js proxy handlers and configured handlers into one proxy.
 *
 * - A plain function receives native `(request, event)` arguments plus context as a third argument.
 * - A configured handler receives `(request, event, context)`.
 * - `rules.include` and `rules.exclude` scope configured handlers to paths or hosts.
 *
 * @example
 * export default chain([intlProxy, { name: 'auth', rules: { include: '/dashboard/**' }, handle: authProxy }])
 */
export function chain<TContext extends object = object>(
  entries: readonly ChainEntry<TContext>[],
  options?: ChainOptions<TContext>,
): ReturnType<typeof executeChain> {
  const normalized = entries.map((entry) => toEntry(entry));
  return executeChain(options ?? {}, normalized);
}
