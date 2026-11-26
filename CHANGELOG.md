# Changelog

## 2.0.0

### Major Changes

- 6d431b2: Remove `proxyChain()`, `defineProxy()`, context-first handlers, manually constructed rule objects, legacy public types, and host-folder routing. Use `chain()` with native handlers or `defineHandler()` results. Scoped entries use `[handler, scope]`; chain options use `chain(entries, options)`.

  Replace Map-backed context and `createContext` with immutable request metadata, generated request IDs, cooperative per-handler cancellation, and typed mutable application state. Rename chain-level `ruleTimeoutMs` to `timeout`; timeout recovery now accepts only terminal responses.

## 1.2.0

### Minor Changes

- d78ef24: Add configurable request diagnostics, structured traces, and named native handlers.

All notable changes to `@klnap/next-proxy-chain` will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-11-23

### Documentation

- README context section explains `ctx.set` and `ctx.get` with a tested example, and `createContext` as an optional object.

## [1.1.0] - 2026-11-22

### Added

- `chain(entries, options?)`: the recommended entry point. Plain functions receive the native `(request, event)` arguments. `defineProxy()` rules receive `(request, context, event)`.
- Scoped tuples: `[handler, scope]`, where `scope` is a path string, an array, a RegExp, or an object `{ include?, exclude? }`. Include objects accept `host`.
- Exported types `ChainEntry`, `ChainScope`, and `NativeProxy`.
- `chain()` passes the request context to plain handlers as an optional third argument: `(request, event, context)`.

### Deprecated

- `proxyChain()` is deprecated in favor of `chain()`. It keeps its behavior. Its removal would be a major release.

### Fixed

- A native Next.js handler passed to `proxyChain()` received the context instead of `event`, so `event.waitUntil()` failed and the request returned `500`. `chain()` avoids this. `proxyChain()` keeps its signature.

### Documentation

- README rewritten to start with `chain()`. Advanced features follow in separate sections.
- `docs/api.md` and `docs/concepts.md` describe native handlers and context rules.

## [1.0.7] - 2026-11-22

### Fixed

- Responses with immutable headers (`Response.redirect()`, `fetch()` responses) are copied before headers are merged. Before, a rule returning them produced a `500` on Node.js.
- A fail-closed `500` keeps the headers and cookies that earlier rules set, such as a CSP header.
- Request overrides go to Next.js only when a rule changed a request header. Before, every request header was encoded as `x-middleware-request-*` on every request.
- `hostFolderHeader` matches whole path segments: `/tenant-other` is not treated as inside `/tenant`.
- `strictOverrideCheck` verifies that Next.js applies request overrides, not only the continuation flag.

## [1.0.6] - 2026-11-22

### Fixed

- `onError` returning `NextResponse.next()` continues the pipeline at rule level, as `next()` does. Previously it stopped the chain and skipped later rules (including auth) while still returning `next`.
- Engine-level `onError` responses merge headers and cookies from earlier rules.
- Scope matching uses the percent-decoded, trailing-slash-free path. `include: path("/admin/**")` no longer misses `/%61dmin/…` or `/admin/`.
- `**` path scopes match decoded control characters such as `%0A` and `%E2%80%A8`. Before this fix, `/admin/%0Asecret` skipped an auth rule on a live Next.js 16.3.2 app.
- Malformed percent-encoding returns `400` instead of skipping rules.
- Regex path patterns keep top-level alternation inside their anchors (`path(/\/public|\/static/)` no longer matches `/admin/static`).
- A trailing dot in the `Host` header is ignored when matching host scopes.
- A malformed rule return (for example a string) is reported to `onError` with that rule's index instead of `-1`.
- Next.js routing headers (`x-middleware-override-headers`, `x-middleware-request-*`) are removed from responses returned by `onError`, as they already were for rule responses.

### Security

- Only `NextResponse` can continue the chain or request a rewrite through `x-middleware-next` or `x-middleware-rewrite`. A relayed plain `Response` keeps its body and cannot rewrite the request.
- Bare object scopes (`{ run, include }` with a RegExp instead of `path()`/`host()`) throw at startup. Before, they matched every request.
- Path segments that mix a wildcard with other characters (for example `/files/*.pdf`) throw at startup. Before, they matched a literal and silently never ran the rule.
- `ruleTimeoutMs` rejects negative values. Before, they silently disabled the timeout.
- CI workflow: read-only `GITHUB_TOKEN` permissions, no persisted checkout credentials, actions pinned to commit SHAs.

### Documentation

- README rewritten around adoption: what the package does, when to use it, a quick start that puts the security header first.
- New `docs/` section: concepts (execution model), guides, API reference, security notes.
- `examples/` contains type-checked examples, each tested in `tests/docs/`. The admin example no longer gates on cookie presence or host, and the locale rewrite example has a matcher.
- API notes: `headers` on proxy responses, one-sided RegExp anchors, `-1` error index, `*` and `**` as whole segments, Server Functions and matchers.

## [1.0.5] - 2026-10-29

### Changed

- Host folder prefix rewrite logic lives in a dedicated module with unit coverage; runtime behavior is unchanged.
- README lists peer requirements and trims redundant install/badge copy.

## [1.0.4] - 2026-08-27

### Breaking

- `onError` returning `undefined` / `void` / `null` now **fails closed** with a 500. Continue only by returning `next()`.
- `x-internal-host-folder` is no longer a magic routing header. Enable it with `hostFolderHeader: "x-internal-host-folder"`.
- Public exports are limited to the documented API. Internals (`mergeWrites`, `compileScopes`, `withRuleTimeout`, `./core`, …) are no longer exported.
- Custom `TContext` requires `createContext`. `proxyChain<{ user: string }>(rules)` without a factory is a type error.
- Removed `PathOptions` and `pathOptions`; `path()` no longer accepts a `locales` option. Match locale-prefixed routes in the pattern string or RegExp.
- `ruleTimeoutMs`: passing `NaN`, `Infinity`, or `-Infinity` now throws a `RangeError` at proxy-chain configuration time instead of silently disabling the timeout. If you were relying on an unvalidated computed value (e.g. from `parseInt` without a fallback) resulting in a disabled timeout, this is a breaking change — validate your config value before passing it.

### Fixed

- `path()` no longer drops `^` / `$` from user RegExp.
- Trailing `*` matches exactly one segment; `**` matches nested paths.
- `compileScopes()` runs RegExp matchers through `path()`.
- `next({ headers: { "set-cookie": … } })` reaches the final response.
- Cookies with the same name and different `Path` / `Domain` are not collapsed.
- Custom header merge returning `null` deletes the header from the terminal response.
- Rewrite continuation no longer mutates the incoming `NextRequest`.
- Timed-out rules no longer leave an unhandled rejection.
- `host("*.example.com")` matches one DNS label.
- `strictOverrideCheck` cache no longer pins the first call’s strictness for later calls.

### Changed

- `headerMergeStrategy` applies only to **response** headers. Request overrides stay last-write-wins.
- Package metadata: `repository`, `bugs`, `homepage`.
- Tests run on `bun:test`; removed Typedoc site from the package repo.

## [1.0.3] - 2026-08-26

npm patch. No detailed notes were kept for 1.0.1–1.0.3 at publish time.

## [1.0.0] - 2026-08-23

### Added

- Composable Edge-safe proxy pipeline via `proxyChain()`.
- Transparent Next.js pass-through detection on `x-middleware-next: 1` with request override extraction.
- Automatic filtering of internal `x-middleware-*` transport headers from client responses.
- Request header blocklist preventing rule injection of sensitive headers (`host`, `authorization`, `x-middleware-*`).
- Context threading via isolated per-request `Map` instances (`TContext`).
- Header and cookie accumulation with `last-write-wins`, `first-write-wins`, and custom merge strategies.
- Path and host scoping (`include`, `exclude`) with construction-time overlap validation.
- Cached startup self-test for `NextResponse.next()` request overrides.
- Error isolation with safe 500 fallback.
