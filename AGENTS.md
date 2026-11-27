# Package development and release policy

These rules govern future work in this repository. Follow repository engineering requirements and preserve unrelated user changes.

## Public handler contract

- `chain()` accepts native handler functions and configured handler objects.
- Configured handlers require a non-empty `name` and a `handle` function. `rules`, `timeout`, `debug`, and `onError` are optional.
- Use `request`, `event`, and `context` for parameters a callback uses. Prefix intentionally unused positional parameters with `_` when later arguments need their positions; omit unused trailing parameters without reordering.
- `chain()` and `defineHandler()` are the only public runtime exports. Use native `NextResponse` and Web APIs for HTTP effects.
- Inline and reusable handler configurations share one contract and normalization path. Never restore the removed `handler` property or package-specific continuation API.
- Keep inline handler objects and `defineHandler()` on the same `HandlerConfig` type and runtime path. `defineHandler()` returns its input configuration unchanged.
- Next.js `config.matcher` owns entrypoint invocation. Handler `rules.include` and `rules.exclude` only filter handlers after invocation.
- Scope matching uses the active request at each handler's turn, including prior continued rewrites and native request-header replacements. Original request metadata stays unchanged.

## Ownership and working model

- The user authorizes the full package development and release lifecycle: create task branches, implement and verify changes, commit, push, create and update PRs, approve eligible GitHub Actions runs, merge verified PRs, manage Changesets, merge generated Release PRs, complete npm Trusted Publishing, verify publication, synchronize branches, and clean up completed branches.
- Do not ask again for routine authorization covered above. Check actual permissions and stop if they are missing.
- Use GitHub Flow: start from current `origin/main`, use short-lived branches, Conventional Commits, protected `main`, and squash merges. Reuse an existing branch or PR when continuing its work.
- Preserve unrelated changes. Never force-push, indiscriminately reset the worktree, or bypass repository protections.

## End-to-end implementation lifecycle

For a completed implementation that warrants a release:

1. Inspect the repository, pending work, and all pending Changesets.
2. Implement the requested scope; run focused tests, independent review, package validation, and required documentation updates.
3. Add a Changeset with the correct SemVer impact and release scope.
4. Commit and push the task branch; create or update its PR.
5. Wait for required checks, resolve material findings, and merge the verified PR.
6. Monitor main CI and the Changesets workflow. Review the complete generated Release PR, including version, changelog, and release scope.
7. Approve held workflow runs when required and authorized. Wait for required checks; merge the verified Release PR.
8. Monitor artifact verification and npm Trusted Publishing.
9. Independently verify the expected version in the npm registry, its dist-tag, provenance where supported, Git tag, and GitHub Release. Report success only after registry verification.
10. Synchronize local `main` and safely clean up completed branches.

Do not stop halfway because another PR or workflow approval is required. Stop only for a genuine blocker: missing permissions or interactive authentication; unresolved security vulnerabilities or failing required checks; conflicting user changes; release content outside scope; an architectural decision requiring the user; or a platform restriction that cannot be resolved without bypassing security controls. Do not repeat successful checks unnecessarily or refactor without need.

## Release rules

- Changesets is the sole versioning and release-management mechanism. Never bump versions manually, create release tags manually, publish locally, or add long-lived npm publishing tokens.
- Do not create releases for infrastructure-only changes. Inspect pending Changesets before release and ensure the complete release stays within scope.
- Preserve the repository’s build-once, verify, publish architecture.
- Use `~/code/packages/npm-package-template` as the source of truth for shared engineering and release infrastructure.

## Task-scoped overrides

An explicit current-task request for local-only work, push-only, no merge, no release, or no publication overrides the default lifecycle for that task. Research, investigation, design discussion, and unfinished implementation do not trigger releases.
