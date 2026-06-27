# Contributing

## Commit Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

| Prefix | When to use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `perf` | Performance improvement |
| `refactor` | Code change that is neither a fix nor a feature |
| `ci` | CI/CD configuration |
| `chore` | Tooling, deps, other non-source changes |

Breaking changes: append `!` after the prefix (`feat!:`, `fix!:`) and add a `BREAKING CHANGE:` footer in the commit body.

## How Releases Work

Releases are automated with [release-please](https://github.com/googleapis/release-please).

1. Commits to `main` are analysed by release-please
2. A "Release PR" is opened that bumps `package.json`, updates `CHANGELOG.md`, and prepares a git tag
3. Merging the Release PR triggers the publish workflow, which publishes to npm

Do not manually bump version numbers or edit `CHANGELOG.md` — these are managed by the release pipeline.

## Running Tests

```bash
pnpm test
```

Pre-push hooks run typecheck and the full test suite automatically via [lefthook](https://github.com/evilmartians/lefthook). Do not skip hooks (`--no-verify`).

## Building Docs

```bash
pnpm docs:dev    # local dev server with hot reload
pnpm docs:build  # production build — must pass with zero dead links
```

## Opening a PR

- Target `main`
- One PR per logical change
- All tests must pass
- Docs must build without errors or dead links
- Follow the commit format above for all commits in the PR
