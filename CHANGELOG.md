# Changelog

All notable changes to `@klnap/next-proxy-chain` will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `**` path scopes match decoded control characters such as `%0A` and `%E2%80%A8` (a regression from 1.0.6, where `.` skipped them).
- An engine-level `onError` (after all rules ran) returning `NextResponse.next()` now returns `500` instead of passing the request through without later rules.
- Next.js routing headers (`x-middleware-override-headers`, `x-middleware-request-*`) are removed from responses returned by `onError`, as they already were for rule responses.

### Security

- Bare object scopes (`{ run, include }` with a RegExp instead of `path()`/`host()`) throw at startup. Before, they matched every request.
- Plain `Response` objects cannot continue the chain or request a rewrite through `x-middleware-next` or `x-middleware-rewrite`. Only `NextResponse` can. Relayed upstream responses keep their body.
- Path segments that mix a wildcard with other characters (for example `/files/*.pdf`) throw at startup. Before, they matched a literal and silently never ran the rule.
- `ruleTimeoutMs` rejects negative values. Before, they silently disabled the timeout.

### Documentation

- Example 02 no longer gates admin routes on cookie presence or host. Example 05 has a matcher.
- API notes: `headers` on proxy responses, one-sided RegExp anchors, `-1` error index, `*` and `**` as whole segments, Server Functions and matchers.

- README rewritten around adoption: what the package does, when to use it, a quick start that puts the security header first.
- New `docs/` section: concepts (execution model), guides, API reference, security notes.
- `examples/` contains type-checked examples, each tested in `tests/docs/`.

## [1.0.6] - 2026-11-22

### Fixed

- `onError` returning `NextResponse.next()` continues the pipeline at rule level, as `next()` does. Previously it stopped the chain and skipped later rules (including auth) while still returning `next`.
- Engine-level `onError` responses merge headers and cookies from earlier rules.
- Scope matching uses the percent-decoded, trailing-slash-free path. `include: path("/admin/**")` no longer misses `/%61dmin/…` or `/admin/`.
- Malformed percent-encoding returns `400` instead of skipping rules.
- Regex path patterns keep top-level alternation inside their anchors (`path(/\/public|\/static/)` no longer matches `/admin/static`).
- A trailing dot in the `Host` header is ignored when matching host scopes.

### Security

- CI workflow: read-only `GITHUB_TOKEN` permissions, no persisted checkout credentials, actions pinned to commit SHAs.

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
