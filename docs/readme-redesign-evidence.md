# README redesign: evidence and coverage

Research snapshot: 2026-11-26. Published baseline: `@klnap/next-proxy-chain` v2.0.0 at commit `5f7e188e28c73521864323e51fed5c45c818f1ea`. The original README redesign findings below describe that published baseline; the API migration addendum records current local work separately.

## Coverage matrix

| Reader need                                     | README location                          | Evidence checked                                                                                                                                                                  | Boundary                                                                                           |
| ----------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Understand why the package exists               | Intro and “Why?”                         | Next.js one-file convention; [Next.js issue #74700](https://github.com/vercel/next.js/issues/74700) discusses composing independently maintained middleware modules and matchers. | The package is an optional composition layer; it does not claim Next.js composition is impossible. |
| Compose existing handlers                       | Quick example; Get started               | `src/index.ts`, `src/core/engine.ts`, `tests/consumer/consumer.cjs`; Next.js 15 Middleware and current Proxy conventions.                                                         | `config.matcher` remains owned by Next.js.                                                         |
| Understand continue, stop, and rewrite behavior | Feature list; Get started; Concepts link | `src/core/pipeline.ts`, `src/core/engine.ts`, `tests/integration/chain.test.ts`, `tests/unit/headers.test.ts`.                                                                    | A terminal response stops later handlers; a rewrite is staged while the chain continues.           |
| Scope handlers by path, host, and predicate     | Conditional handlers                     | `src/core/matching.ts`, `docs/api.md`, `tests/unit/matching.test.ts`, `tests/unit/path.test.ts`.                                                                                  | Scopes cannot widen the framework matcher; host values are untrusted routing input.                |
| Share request metadata and app state            | Request context                          | `src/core/context.ts`, `dist/index.d.ts`, `tests/unit/context.test.ts`, `tests/integration/request-context.test.ts`.                                                              | Context is request-local and is not forwarded to route code automatically.                         |
| Set deadlines and recover failures              | Timeouts, cancellation, and recovery     | `src/core/timeout.ts`, `src/core/engine.ts`, `tests/unit/timeout.test.ts`, `tests/integration/on-error-continuation.test.ts`.                                                     | Cancellation is cooperative; timeout and cancellation recovery accept only terminal responses.     |
| Inspect request behavior                        | Debugging and observability              | `src/core/diagnostics/formatter.ts`, `tests/unit/diagnostics.test.ts`, captured output in `docs/guides.md`.                                                                       | Request IDs and timing values vary; paths may still contain private data.                          |
| Install and resolve package support             | Install; Compatibility                   | `package.json`, export map, `.github/workflows/ci.yml`, packed-consumer checks, and v2.0.0 live fixtures on Next.js 15.5.29 and 16.3.2.                                           | Edge runtime and client-disconnect behavior are not verified.                                      |
| Upgrade from v1                                 | Migration link and `docs/migration.md`   | `CHANGELOG.md` v2.0.0 notes and the published v1.2.0 declaration snapshot.                                                                                                        | v2 is a breaking upgrade; no automated codemod is claimed.                                         |

## Package and release evidence

- `package.json` declares version `2.0.0`, peer `next >=15.0.0`, Node.js `>=20.0.0`, and zero runtime dependencies.
- npm registry metadata reports `2.0.0` as both the current version and the `latest` dist-tag.
- Public exports in `src/index.ts` and `dist/index.d.ts` include `chain`, `defineHandler`, `next`, `isNextResult`, `path`, `host`, `RuleTimeoutError`, and public types. `ChainEntry` accepts native handlers, `defineHandler()` results, and `[handler, scope]` tuples; inline configuration objects are not supported.
- The v2.0.0 npm tarball was fetched and inspected. Its integrity is `sha512-N7Zh0zk2TGGIyuWMUVWqzU5acaHwSXARiIVJzZ98SMMcIDokPI6t67daAiUOU11cX3ExGahWPmJ/FHNve19lQA==`.
- The published manifest and ESM, CommonJS, and declaration files are byte-identical to local release artifacts. Its README differs from the redesigned local README; the tarball does not include `docs/`.
- The published README still shows an unverified user cookie as an authenticated session and says handler durations include recovery. The current security and API docs correctly warn against the former and say handler duration excludes recovery.
- The v1.2.0 npm tarball was fetched and its declarations inspected for removed v1 APIs. The release notes independently list the v2 removals and replacements.
- CI installs the exact package tarball into isolated consumers with Next.js 15.5.29 and 16.3.2. It checks TypeScript, ESM, CommonJS, then CommonJS on Node.js 20, 22, 24, and 26.
- Retained fixtures under `/tmp/opencode/next-proxy-chain-live-*` use v1.2.0. Separate acceptance fixtures installed the published v2.0.0 package and exercised live Next.js 15.5.29 Middleware and Next.js 16.3.2 Proxy.

## Upstream research

- [Next.js 15 Middleware convention](https://nextjs.org/docs/15/app/api-reference/file-conventions/middleware) and [current Proxy convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) establish the filenames, exports, matcher ownership, and runtime notes used here.
- [NextResponse](https://nextjs.org/docs/app/api-reference/functions/next-response) documents request-header forwarding separately from response headers. Its warning against `NextResponse.next({ headers })` informs the README's limited response-header advice.
- [next-intl composition guide](https://next-intl.dev/docs/routing/middleware), [Auth.js protection guide](https://authjs.dev/getting-started/session-management/protecting), [Clerk middleware guide](https://clerk.com/docs/reference/nextjs/clerk-middleware), and [WorkOS AuthKit guide](https://workos.com/docs/authkit/nextjs) informed native integration examples and the authorization boundary.
- [Next.js issue #88730](https://github.com/vercel/next.js/issues/88730) and [WorkOS AuthKit issue #361](https://github.com/workos/authkit-nextjs/issues/361) report request-header merging gaps across composed handlers. These are issue reports, not framework guarantees.
- Additional first-party history: [next-intl PR #261](https://github.com/amannn/next-intl/pull/261), [Next.js issue #59888](https://github.com/vercel/next.js/issues/59888), and [Auth.js issue #13083](https://github.com/nextauthjs/next-auth/issues/13083).

Vendor docs are rolling pages. The issue and PR statements describe the linked page snapshots and do not prove current framework defects.

## README hierarchy check

- Identity and quick example preserve the package title, tagline, native-first positioning, and `chain()` entrypoint example.
- Why, features, and installation follow the opening example; Bun and npm commands remain separate.
- Usage progresses through native integration, conditional handlers, configured handlers, context, timeouts, and diagnostics.
- Configuration, compatibility, documentation links, and license close the README. Detailed semantics remain in concepts, guides, API, security, and migration docs.
- Return semantics match the implementation: `undefined` and `NextResponse.next()` continue, terminal responses stop, and rewrites remain staged while later handlers run.

## Historical README scope decision

The earlier README redesign omitted the repository `examples/` link. The current API migration supersedes its decision to leave tuple-based examples unchanged; affected examples and tests now use configured handler objects.

## Verification record

- The final `bun run check` passed after the README return-semantics edit: format, lint, typecheck, 166 tests, build, `publint --strict`, and Are The Types Wrong. Lint reported 39 warnings.
- The published 2.0.0 package passed representative TypeScript consumer checks on Next.js 15.5.29 and 16.3.2, including native handlers, scoped tuples, context, timeout, and trace types. ESM and CommonJS entrypoints expose the same seven runtime exports.
- Live fixtures using Node.js 26.13.1 passed native composition, conditional scopes, request identity forwarding, response headers and cookies, staged rewrites, terminal responses, redirects, timeout abort and recovery, and structured traces on both Next.js versions.
- Direct published-package checks also verified pre-aborted request signals prevent handler execution and permit terminal recovery. Client-disconnect propagation was not tested.
- The package gate's tarball checks pass for Node 16 ESM, CommonJS, and bundler resolution. The configured `node10` resolution is intentionally ignored.
- GitHub's GFM API rendered the local README: two tables, 15 code blocks, and 11 TypeScript-highlighted blocks. The npm page returned HTTP 403; npm's page CSS and mobile layout were not inspected.
- Local Markdown links and the README-linked anchors were checked. GitHub `main` does not yet contain `docs/migration.md` or the new `inspect-a-request` heading; those absolute links resolve after the local documentation changes land.
- Detailed diagnostics were captured from the published package; the README's ASCII sample matches output under `LC_ALL=C`. Earlier compact and verbose samples came from local source, whose generated bundles match the published artifact byte-for-byte.
- Lint reports 39 warnings in unchanged source, tests, and examples: 25 non-null assertions, six `void` union, six explicit `any`, one unused parameter, and one `useConst`. No documentation warnings or lint errors occurred.

## Canonical handler API migration

- The approved contract in `specs/v2-final-contract.md` defines one `HandlerConfig<TContext>` accepted inline by `chain()` or passed unchanged through `defineHandler()`. Configured handlers require a non-empty `name` and `handle`; `rules`, `timeout`, `debug`, and `onError` remain optional.
- Tuple entries and the public types `ChainScope`, `DefinedHandler`, and `HandlerDebugOptions` are removed. Runtime checks reject tuple entries, malformed configurations, and nested `config` or `options` objects.
- Matching remains inside the package's handler pipeline. Next.js `config.matcher` retains invocation ownership; include scopes use OR, exclude scopes use OR and take precedence, and host plus path in one scope use AND.
- The engine matches each handler against the active request for that turn. A regression test and live fixtures verify a continued rewrite changes later matching while original request metadata remains unchanged.
- Current local docs, examples, package allowlist, AI guidance, contributor `AGENTS.md`, and CI tarball allowlist use the canonical contract. The local tarball contains README, `llms.txt`, and four consumer guides.
- Package verification passes: `bun run check` passes formatting, lint, typecheck, all 165 reported test cases, build, and package validation. Lint reports 41 warnings; intentionally unused positional parameters use `_` without artificial usage or lint suppression.
- Packed local consumers pass TypeScript, ESM, and CommonJS checks with Next.js 15.5.29 and 16.3.2 installed.
- Live Next.js 15.5.29 Middleware and Next.js 16.3.2 Proxy fixtures both verify that `/source` rewrites to `/target`, a later `/target` rule adds its response header, and `/target` or `/outside` requests do not run the `/source` native matcher.
- Next.js 15's official Middleware documentation says matcher values must be static constants. The Next.js 16.3.2 installed package and live Proxy fixture confirm the corresponding native matcher contract for this release. Context7 was unavailable because its request quota was exhausted; official Next.js docs and installed version-matched sources were used instead.
- The release workflow still requires removed `docs/migration.md` at lines 135 and 148. It remains unchanged under the task's release-workflow constraint and blocks that workflow until separately corrected.
- No version bump, commit, push, merge, tag, or publication occurred. The manifest remains at v2.0.0 pending the major Changeset; npm `latest` remains the published v2.0.0 baseline.

## Final documentation acceptance

Verification snapshot: 2026-11-27. The checks below use the current local package implementation and its packed artifact, not the previously published v2.0.0 baseline.

- `npm pack` produced an unpublished local v2.0.0 tarball at `/tmp/opencode/next-proxy-chain-callback-final-20261127/klnap-next-proxy-chain-2.0.0.tgz`, 45,569 bytes, SHA-512 `6MkyMORbqBpPf6LyLbxp4XgzwcJAo3EU+6LwcE2AMdRhL8b4Sz9XOyS+Vx4Ep47ZAeSQb0ApAZqrbjTmizbv/w==`. The final package gate passed `publint --strict` and Are The Types Wrong.
- The packed tarball contains README, `llms.txt`, four consumer docs, ESM/CommonJS bundles, and both declaration files. It contains no migration guide.
- Packed consumer fixtures type-check inline and reusable `HandlerConfig`, positional callback inference, custom-context variance, native request-header forwarding, and removed-API negative cases with TypeScript 5.7.3 on both Next.js versions. ESM and CommonJS runtime fixtures pass.
- `HandlerConfig.handle` remains a function-valued property. Under `strict: true`, a negative type assertion rejects assigning a custom-context handler to an incompatible context; native two-argument and three-argument handlers retain positional compatibility.
- `next build` passes for Next.js 15.5.29 / React 18.2.0 and Next.js 16.3.2 / React 19.2.8 packed consumers.
- Live requests on both versions pass native request-header addition, update, deletion, successive cloned replacement, context propagation, response-header composition, and request/response header separation.
- The full package gate passes with 165 reported tests and 41 lint warnings. The chain benchmark passes: one native handler 23.38 µs/request, three native handlers 42.48, one configured handler 28.75–62.52 depending on context and timeout, and chain initialization 9.17 µs/call.
- Diagnostics benchmarks pass: debug disabled 24.94 µs/request, compact 38.09, detailed 30.90, verbose 44.15, structured trace 27.23, and detailed concurrent 30.88. Formatting costs ranged from 1.26 to 4.89 µs/trace.
- An isolated integrating-agent check used only the extracted package docs and declarations, with no source-repository or network access. It completed all requested integration tasks correctly; it noted that Next.js 15 Edge runtime behavior remains unverified.
- Core API docs are included in the tarball and navigate through relative links offline. Upstream Next.js reference links need internet access. The prior npm package-page request returned HTTP 403, so npm-hosted rendering could not be inspected; GitHub GFM rendered the README in the earlier verification snapshot.
- `.github/workflows/ci.yml` no longer requires `docs/migration.md`. `.github/workflows/release.yml` still requires that removed file at lines 135 and 148. It was left unchanged under the instruction not to edit release workflows; this blocks the corresponding release until that stale allowlist is corrected separately.
