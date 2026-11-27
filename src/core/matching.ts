import type {
  BaseHandlerRule,
  CompiledScope,
  HostMatcher,
  PathMatcher,
  RouteScopeList,
} from "./types";

const RESERVED_FN_NAMES = new Set(["", "proxy", "anonymous", "run", "next"]);

function extractMeaningfulName(value: string | undefined): string | undefined {
  if (!value || RESERVED_FN_NAMES.has(value)) return undefined;
  return value;
}

/**
 * Strips sticky and global flags (g, y) from RegExp instances.
 * On Edge runtimes, compiled regex instances can be shared across requests;
 * sticky and global flags mutate stateful indices, causing non-deterministic matching.
 */
export function toStatelessRegExp(re: RegExp): RegExp {
  const flags = re.flags.replace(/[gy]/g, "");
  return flags === re.flags ? re : new RegExp(re.source, flags);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `*` in a host string matches exactly one DNS label (`[^.]+`).
 * `*.example.com` matches `foo.example.com`, not `example.com` or `a.b.example.com`.
 */
function hostGlobToRegex(value: string): string {
  return escapeRegex(value.toLowerCase()).replace(/\\\*/g, "[^.]+");
}

/**
 * Compiles each host alternative separately. Joining sources would renumber capture groups,
 * so a backreference would bind to another alternative's group. Each alternative is anchored
 * to the whole hostname and matched case-insensitively, as the host contract requires.
 */
export function host(matcher: HostMatcher): RegExp[] {
  const list = (Array.isArray(matcher) ? matcher : [matcher]) as (string | RegExp)[];
  return list.map((m) => {
    const source = m instanceof RegExp ? m.source : hostGlobToRegex(m);
    return new RegExp(`^(?:${source})$`, "i");
  });
}

function isScopeObject(
  value: object,
): value is { host?: HostMatcher; path?: PathMatcher | PathMatcher[] } {
  return "host" in value || "path" in value;
}

function segmentToRegex(segment: string): string {
  if (segment.includes("*") && segment !== "*" && segment !== "**") {
    throw new Error(
      `[proxy-chain] path segment "${segment}" mixes a wildcard with other characters. Use a whole-segment * or **.`,
    );
  }
  if (segment === "**") return "(?:[\\s\\S]*)";
  if (segment === "*") return "[^/]+";
  if (segment.startsWith(":")) return "[^/]+";
  return escapeRegex(segment);
}

function hasEndAnchor(source: string): boolean {
  if (!source.endsWith("$")) return false;
  let slashes = 0;
  for (let i = source.length - 2; i >= 0 && source[i] === "\\"; i--) slashes++;
  return slashes % 2 === 0;
}

function compileRegexPath(pattern: RegExp): RegExp {
  let source = pattern.source;
  const hasStart = source.startsWith("^");
  const hasEnd = hasEndAnchor(source);
  if (hasStart) source = source.slice(1);
  if (hasEnd) source = source.slice(0, -1);

  const wrapFull = !hasStart && !hasEnd;
  const start = hasStart || wrapFull ? "^" : "";
  const end = hasEnd || wrapFull ? "$" : "";

  // Group the body so top-level alternation stays inside the anchors.
  return toStatelessRegExp(new RegExp(`${start}(?:${source})${end}`, pattern.flags));
}

function compileStringPath(pattern: string): RegExp {
  const normalized = (pattern.startsWith("/") ? pattern : `/${pattern}`).replace(/\/$/, "") || "/";
  const segments = normalized === "/" ? [] : normalized.slice(1).split("/");
  const last = segments[segments.length - 1];
  const trailingStar = last === "*";
  const trailingGlobstar = last === "**";

  let pathPattern: string;
  if (normalized === "/") {
    pathPattern = "/";
  } else if (trailingStar) {
    const prefix = segments.slice(0, -1).map(segmentToRegex).join("/");
    pathPattern = prefix ? `/${prefix}/[^/]+` : `/[^/]+`;
  } else if (trailingGlobstar) {
    const prefix = segments.slice(0, -1).map(segmentToRegex).join("/");
    pathPattern = prefix ? `/${prefix}(?:/[\\s\\S]*)?` : `/(?:[\\s\\S]*)?`;
  } else {
    pathPattern = `/${segments.map(segmentToRegex).join("/")}`;
  }

  return new RegExp(`^${pathPattern}$`);
}

/**
 * Compiles a path pattern (glob string, param pattern, or RegExp) into a stateless regular expression.
 *
 * - `*` — exactly one path segment
 * - `**` — zero or more subsequent segments
 */
export function path(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) return compileRegexPath(pattern);
  return compileStringPath(pattern);
}

/** Compiles each alternative separately: joining sources would drop per-alternative flags such as `i`. */
function toPathRegexes(matcher: PathMatcher | PathMatcher[]): RegExp[] {
  const list = (Array.isArray(matcher) ? matcher : [matcher]) as (string | RegExp)[];
  return list.map((m) => toStatelessRegExp(path(m)));
}

/**
 * Compiles route scoping declarations into normalized regex clauses.
 */
export function compileScopes(input: RouteScopeList | undefined): CompiledScope[] | undefined {
  if (input == null) return undefined;
  const list = Array.isArray(input) ? input : [input];

  const compilePath = (matcher: PathMatcher | PathMatcher[]): RegExp[] => toPathRegexes(matcher);

  const compiled: CompiledScope[] = [];
  for (const item of list) {
    if (typeof item === "string" || item instanceof RegExp) {
      compiled.push({ path: compilePath(item) });
      continue;
    }
    if (item && typeof item === "object" && isScopeObject(item)) {
      if (item.host == null && item.path == null) {
        throw new Error("[proxy-chain] scope needs at least `host` or `path`");
      }
      compiled.push({
        host: item.host != null ? host(item.host) : undefined,
        path: item.path != null ? compilePath(item.path) : undefined,
      });
      continue;
    }
    throw new Error("[proxy-chain] invalid include/exclude scope");
  }
  return compiled;
}

function scopeMatches(pathname: string, hostname: string | null, scope: CompiledScope): boolean {
  if (scope.host) {
    if (!hostname || !scope.host.some((alternative) => alternative.test(hostname))) return false;
  }
  if (scope.path) {
    if (!scope.path.some((alternative) => alternative.test(pathname))) return false;
  }
  return true;
}

export function toRule<TFn, TContext extends object = object>(
  entry: TFn | BaseHandlerRule<TFn, TContext>,
): BaseHandlerRule<TFn, TContext> {
  if (typeof entry === "function") {
    const name = extractMeaningfulName((entry as { name?: string }).name);
    return name ? { run: entry, name } : { run: entry };
  }

  const rule = entry as BaseHandlerRule<TFn, TContext>;
  const runName =
    typeof rule.run === "function"
      ? extractMeaningfulName((rule.run as { name?: string }).name)
      : undefined;
  const name = extractMeaningfulName(rule.name) ?? runName;

  // Plain objects bypass the TypeScript check. A scope without host or path would match everything.
  const harden = (scopes: CompiledScope[] | undefined) =>
    scopes?.map((s) => {
      if (!s.host && !s.path) {
        throw new Error(
          "[proxy-chain] include/exclude scope needs a path, host, or host/path object.",
        );
      }
      return {
        host: s.host?.map(toStatelessRegExp),
        path: s.path?.map(toStatelessRegExp),
      };
    });

  return {
    ...rule,
    name: name ?? undefined,
    include: harden(rule.include),
    exclude: harden(rule.exclude),
  };
}

export function ruleLabel<TFn, TContext extends object = object>(
  rule: BaseHandlerRule<TFn, TContext>,
  index: number,
): string {
  const runName =
    typeof rule.run === "function"
      ? extractMeaningfulName((rule.run as { name?: string }).name)
      : undefined;
  return extractMeaningfulName(rule.name) ?? runName ?? `rule#${index}`;
}

/**
 * Determines whether a given request matches a rule's scoping constraints.
 */
export function ruleMatches<TFn, TContext extends object = object>(
  pathname: string,
  hostname: string | null,
  rule: BaseHandlerRule<TFn, TContext>,
): boolean {
  if (rule.exclude?.some((scope) => scopeMatches(pathname, hostname, scope))) return false;
  if (rule.include && !rule.include.some((scope) => scopeMatches(pathname, hostname, scope))) {
    return false;
  }
  return true;
}

export function ruleMatchReason<TFn, TContext extends object = object>(
  pathname: string,
  hostname: string | null,
  rule: BaseHandlerRule<TFn, TContext>,
): "include-mismatch" | "exclude-match" | undefined {
  if (rule.exclude?.some((scope) => scopeMatches(pathname, hostname, scope))) {
    return "exclude-match";
  }
  if (rule.include && !rule.include.some((scope) => scopeMatches(pathname, hostname, scope))) {
    return "include-mismatch";
  }
  return undefined;
}

export function pathMatches<TFn, TContext extends object = object>(
  pathname: string,
  rule: BaseHandlerRule<TFn, TContext>,
): boolean {
  return ruleMatches(pathname, null, rule);
}

/**
 * Normalizes Host or X-Forwarded-Host header values to lower-case hostname without port.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim().toLowerCase();
  if (!first) return null;
  if (first.startsWith("[")) {
    const end = first.indexOf("]");
    return end === -1 ? first : first.slice(1, end);
  }
  const withoutPort = first.replace(/:\d+$/, "").replace(/\.$/, "");
  return withoutPort || null;
}

/**
 * Path used for scope matching: percent-decoded, without trailing slashes.
 * This is the form Next.js resolves to a page. Returns null for malformed encoding.
 */
export function canonicalPathname(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  return decoded.length > 1 ? decoded.replace(/\/+$/, "") || "/" : decoded;
}

function scopeKey(scope: CompiledScope): string {
  const path = scope.path
    ?.map((alternative) => `${alternative.source}::${alternative.flags}`)
    .join("&");
  const hostKey = scope.host
    ?.map((alternative) => `${alternative.source}::${alternative.flags}`)
    .join("&");
  return `${hostKey ?? "*"}|${path ?? "*"}`;
}

/**
 * Validates that an identical scope is not declared simultaneously in include and exclude.
 */
export function assertIncludeExcludeNoOverlap(
  include: CompiledScope[] | undefined,
  exclude: CompiledScope[] | undefined,
  label: string,
): void {
  if (!include?.length || !exclude?.length) return;
  const excluded = new Set(exclude.map(scopeKey));
  for (const scope of include) {
    if (excluded.has(scopeKey(scope))) {
      throw new Error(
        `[proxy-chain] ${label}: include and exclude share an identical scope. Remove one.`,
      );
    }
  }
}
