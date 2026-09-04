# Repository Guidelines

## Project Structure & Module Organization

This repository is currently specification-first. The product direction and public API examples live in [`docs/spec.md`](docs/spec.md). There is not yet an implementation, test suite, asset directory, or package manifest.

As code is added, keep the core Effect-native library separate from integrations:

- `src/` — core queries, mutations, cache, and service layers.
- `src/react/` or a separate adapter package — optional React bindings; do not put React dependencies in core.
- `test/` or `tests/` — unit and integration tests mirroring `src/` paths.
- `docs/` — API and design documentation.

Preserve the boundaries described in the spec: typed errors and requirements should flow through Effect, and cancellation, deduplication, stale-time handling, and cache garbage collection belong to the core service.

## Build, Test, and Development Commands

No build or test scripts are configured yet. Once a package manager and toolchain are introduced, record the canonical commands here (for example, `pnpm build`, `pnpm test`, and `pnpm lint`). During documentation-only changes, use `git diff --check` to catch whitespace errors and review the rendered Markdown.

## Coding Style & Naming Conventions

Use TypeScript with strict typing and immutable data by default. Follow the formatter and linter selected by the project rather than introducing local style exceptions. Prefer `camelCase` for functions and variables, `PascalCase` for types and service abstractions, and descriptive names such as `QueryService` and `RetryPolicy`. Keep core modules UI-agnostic; use readonly tuple keys for structural cache identity.

## Testing Guidelines

Tests are not present yet. Add tests alongside each core behavior, including interrupted requests, concurrent deduplication, stale and cache expiration, typed failures, invalidation, and mutation success handling. Name tests after observable behavior (for example, `dedupes concurrent fetches`). Include React adapter tests separately when that package is introduced.

## Commit & Pull Request Guidelines

There is no Git history yet, so no existing commit convention can be inferred. Use concise imperative subjects, preferably Conventional Commit prefixes such as `feat:`, `fix:`, `test:`, and `docs:`. Pull requests should explain the behavior changed, link the relevant issue or spec section, include tests (or explain why none apply), and call out API or cache-semantics changes explicitly.

## Security & Configuration Tips

Do not commit credentials, API tokens, or environment-specific endpoints. Keep HTTP clients and runtime configuration injectable through Effect requirements so consumers can provide secure environments without coupling the library to a particular transport.
