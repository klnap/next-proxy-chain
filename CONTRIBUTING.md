# Contributing

Open short-lived branches and pull requests against `main`. Use squash merges and Conventional
Commit pull request titles.

Install the pinned dependencies and run the package checks before opening a pull request:

```sh
bun install --frozen-lockfile
bun run check
```

The checks cover formatting, linting, typechecking, tests, the dual ESM/CJS build, `publint`, and
Are the Types Wrong. CI also packs the package, installs that tarball in isolated consumers, and
tests its types and runtime against the supported Next.js and Node.js versions.

Add a changeset for consumer-visible changes:

```sh
bun run changeset
```

Use `patch` for compatible fixes, `minor` for compatible features, and `major` for breaking changes.
Documentation-only, test-only, and internal infrastructure changes do not need a changeset.

## Release process

Changesets opens or updates a release pull request after changes merge to `main`. Merging that
release pull request packs and verifies the package, then publishes the verified artifact through
npm Trusted Publishing. The workflow creates the matching Git tag and GitHub Release afterward.

The trusted publisher workflow is `.github/workflows/release.yml`. Keep its filename synchronized
with the package's npm Trusted Publisher configuration.
