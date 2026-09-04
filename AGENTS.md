# Repository Guidelines

## Project Structure & Module Organization

The product direction and public API examples live in [`docs/spec.md`](docs/spec.md);
implementation decisions live in [`docs/architecture.md`](docs/architecture.md).
The implementation lives in `src/` with tests in `test/`.

As code is added, keep the core Effect-native library separate from integrations:

- `src/` — core queries, mutations, cache, and service layers.
- `src/react/` or a separate adapter package — optional React bindings; do not put React dependencies in core.
- `test/` or `tests/` — unit and integration tests mirroring `src/` paths.
- `docs/` — API and design documentation.

Preserve the boundaries described in the spec: typed errors and requirements should flow through Effect, and cancellation, deduplication, stale-time handling, and cache garbage collection belong to the core service.

## Build, Test, and Development Commands

- `pnpm install` — install dependencies.
- `pnpm check` — typecheck, lint, test (with enforced coverage thresholds), and build.
- `pnpm test:watch` — rerun tests on change (no coverage).
- `pnpm build` — emit `dist/` via `tsconfig.build.json`.

During documentation-only changes, use `git diff --check` to catch whitespace errors and review the rendered Markdown.

## Coding Style & Naming Conventions

Use TypeScript with strict typing and immutable data by default. Follow the formatter and linter selected by the project rather than introducing local style exceptions. Prefer `camelCase` for functions and variables, `PascalCase` for types and service abstractions, and descriptive names such as `QueryService` and `RetryPolicy`. Keep core modules UI-agnostic; use readonly tuple keys for structural cache identity.

## Testing Guidelines

Tests live in `test/` and exercise the public seam (`Query`, `Mutation`, `queryLayer`) rather than private maps. Keep coverage at the enforced thresholds in `vitest.config.ts` (100% lines/functions). Cover each core behavior, including interrupted requests, concurrent deduplication, stale and cache expiration, typed failures, invalidation, and mutation success handling. Name tests after observable behavior (for example, `dedupes concurrent fetches`). Include React adapter tests separately when that package is introduced.

## Commit & Pull Request Guidelines

There is no Git history yet, so no existing commit convention can be inferred. Use concise imperative subjects, preferably Conventional Commit prefixes such as `feat:`, `fix:`, `test:`, and `docs:`. Pull requests should explain the behavior changed, link the relevant issue or spec section, include tests (or explain why none apply), and call out API or cache-semantics changes explicitly.

## Security & Configuration Tips

Do not commit credentials, API tokens, or environment-specific endpoints. Keep HTTP clients and runtime configuration injectable through Effect requirements so consumers can provide secure environments without coupling the library to a particular transport.
