# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0-beta.0] - Unreleased

### Added

- Optional `@wthw7/effect-query-react` package: runtime-bound `useQuery` and
  `useMutation`, fiber cancellation on cleanup, typed Cause/Exit outcomes, and
  concurrent mutation tracking. Hooks expose fetch snapshots, not cache subscriptions.
- Separate React behavior and compile-time tests, included in `pnpm check` and CI.
- Workspace packaging and release support for both packages; core remains React-free.
- Turborepo task orchestration and local/CI caching for builds, coverage tests,
  typechecking, and linting, with pnpm retained as the workspace package manager.
- Phase 1 core additions since alpha: custom hashers and `KeyHashError`, prefetch,
  cancel, and focus/reconnect notifications.

## [0.1.0-alpha.0] - 2026-09-04

First public alpha, published as `@wthw7/effect-query`.
UI-agnostic query cache for Effect.

### Added

- `Query.make` / `Query.fetch` with structural readonly-tuple keys.
- Fresh/stale cache handling via `staleTime`, lazy garbage collection via `cacheTime`.
- In-flight deduplication: concurrent fetches for one key share a single execution.
- Typed retries through `retry: { times, schedule }`.
- `Query.invalidate`, `Query.setData`, `Query.getData` over the same key space.
- `Mutation.make` / `Mutation.execute` with `QueryService`-backed `onSuccess` hooks.
- Interruptible fetches: interrupting the winner cancels the request, interrupting
  a joiner only cancels its own wait.
- Vitest suite (20 tests) with enforced 100% line/function coverage thresholds.
- CI workflow, provenance-enabled release workflow, MIT license.
