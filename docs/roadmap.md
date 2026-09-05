# Roadmap

Phased, trackable milestones from the current alpha to a stable 1.0. Each
phase lists concrete tasks and a quality gate: the phase is done only when
every box is checked **and** the gate passes.

Status legend: `[x]` done, `[ ]` todo. Update boxes in the same commit that
lands the work.

Global release rules (apply to every phase):

- `pnpm check` green (typecheck, lint, coverage tests, build).
- Coverage thresholds in `vitest.config.ts` hold (100% lines/functions).
- `docs/spec.md` and `docs/architecture.md` updated when behavior changes.
- `CHANGELOG.md` entry plus version bump and tag for every publish.

## Phase 0 — Alpha release (current)

Goal: publishable core on npm as `@wthw7/effect-query`.

- [x] Core `Query` / `Mutation` / `QueryService` implementation.
- [x] 20+ behavior tests with enforced coverage thresholds.
- [x] CI workflow, provenance release workflow, MIT license.
- [x] README with Why, Features, Usage, and Contributing.
- [ ] One-time npm Trusted Publishing setup for the scoped package
  (npmjs.com Settings → Trusted Publisher). Required before the first
  tag-pushed release.
- [x] Tag `v0.1.0-alpha.0` marks the release commit (kept local: pushing it
  would re-trigger publish of the existing version; tag-push automation
  applies from the next release).
- [x] Verified the published tarball installs and imports in a blank project
  (npm and bun), including a fetch/mutation smoke test.

Quality gate: `bun add @wthw7/effect-query@alpha` works in an empty
project, badge versions resolve, and CI is green on `main`.

## Phase 1 — Core completeness (beta)

Goal: close the gaps the alpha knowingly deferred.

- [ ] Custom key hashers: `Query.make({ hash })` option, default stays
  `JSON.stringify`. Non-serializable keys must throw a typed error, not crash.
- [ ] Focus/reconnect triggers: UI-agnostic `Query.notifyFocus()` /
  `Query.notifyReconnect()` that revalidate queries opting in via
  `refetchOnFocus` / `refetchOnReconnect` (options exist today, runtime does
  not).
- [ ] `Query.prefetch(query, ...args)`: warm the cache without awaiting data.
- [ ] `Query.cancel(key)`: cancel an in-flight request and clear its slot.
- [ ] Document interruption semantics per operation in `docs/architecture.md`.

Quality gate: new behaviors covered by tests named after observable behavior,
no public API change without a spec entry, coverage thresholds still hold,
publish `0.2.0-beta.0` and verify the tarball as in Phase 0.

## Phase 2 — Framework adapters

Goal: prove the core is truly UI-agnostic with a first adapter.

- [ ] New package (e.g. `effect-query-react`) depending on core, never the
  reverse. React stays out of core `package.json`.
- [ ] `useQuery(definition, ...args)` returning `{ data, error, isPending }`
  driven by Effect fibers, with unmount cancellation.
- [ ] `useMutation(definition)` returning `{ mutate, isPending }`.
- [ ] Adapter test suite with fake timers covering mount, key change,
  unmount-cancel, and error states.
- [ ] README section with framework example; core README links to it.

Quality gate: adapter tests green in CI, core coverage thresholds untouched,
example app (or test harness) demonstrates mount → fetch → unmount-cancel,
publish `0.3.0-beta.0` for both packages.

## Phase 3 — Advanced cache

Goal: close the remaining v0.1 out-of-scope items, one at a time, each
shippable independently.

- [ ] Pagination helpers: `Query.infinite` (or equivalent) with page params
  and `fetchNextPage`, sharing the structural key space.
- [ ] SSR / hydration: `dehydrate()` / `hydrate()` over serializable entries
  with `cacheTime`-aware expiry on restore.
- [ ] Offline persistence: pluggable storage seam (default in-memory),
  rehydrate on startup, versioned payloads with typed decode failures.
- [ ] Devtools hook: read-only event stream (fetch start/success/failure,
  invalidate, GC) a devtools UI can subscribe to; core stays UI-free.
- [ ] Normalized/entity cache: only if a concrete consumer needs it; needs an
  ADR before any code.

Quality gate per item: ADR or spec entry first, behavior tests including
failure paths (corrupt payload, version mismatch), docs and changelog updated,
minor-version publish verified as in Phase 0.

## Phase 4 — Stable 1.0

Goal: freeze the API consumers can rely on.

- [ ] Mark experimental APIs stable or remove them; no `refetchOn*` stubs.
- [ ] Benchmarks: dedup under contention, SWR latency, GC under key churn.
  Record baselines in the repo and fail CI on large regressions.
- [ ] Semver policy documented (what counts as major in each package).
- [ ] Migration notes from the last beta; CHANGELOG complete.
- [ ] Security review pass: no credentials in logs/fixtures, dependency audit.

Quality gate: all prior gates hold, benchmarks recorded, `1.0.0` published,
GitHub release notes link the changelog.

## Non-goals

Ideas that stay out unless a consumer demonstrates need with an ADR:

- Normalized relational cache with entity graph updates.
- Offline-first conflict resolution / CRDT sync.
- Framework adapters beyond the Phase 2 proof (Vue, Svelte, Solid).
- Server-side cache distribution or shared cross-process stores.
