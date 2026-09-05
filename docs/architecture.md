# Architecture

## Purpose

Effect Query is a small, UI-agnostic cache module. Its external seam is the `QueryService` context tag. Applications provide one `queryLayer()` per cache lifetime, and query definitions remain plain data plus typed Effect-producing functions.

## Modules

### Query and Mutation definitions

`Query.make` and `Mutation.make` are intentionally thin constructors. A query owns key creation, execution, freshness, retention, and retry policy. A mutation owns execution and may run an Effect-based `onSuccess` handler. Neither module imports React or creates a runtime.

### QueryService implementation

`queryLayer()` creates an isolated in-memory `Map` keyed by a hash of the readonly key tuple (`JSON.stringify` by default, overridable per query via `Query.make({ hash })`). Each entry stores the last successful value, its timestamp, timing policy, focus/reconnect flags, a revalidation effect, and the current in-flight joiner plus winner fiber. Deduplication is an explicit Deferred-based single flight: the first caller (winner) forks the request into a supervised child fiber, while concurrent callers (joiners) await the same Deferred. The child caches successful values; the winner funnels every outcome through the Deferred in an `onExit` finalizer, so joiners are always released and failures are never cached.

The service applies this decision sequence:

1. Remove entries past `cacheTime` (lazy garbage collection).
2. Return a fresh value immediately.
3. Return stale data immediately and fork one daemon revalidation.
4. If no value exists, execute and cache the request result.

Failures are never cached as data. A failed revalidation leaves the previous successful value available.

### Public operations

`Query.fetch` resolves the service from Effect’s context. `Query.getData`, `Query.setData`, and `Query.invalidate` operate on the same structural key space. Invalidation marks an entry stale without requiring callers to know the cache implementation.

## First-version decisions

- Keys must be JSON-serializable readonly arrays by default; per-query `hash`
  overrides hashing for `fetch`, while raw-key operations keep structural
  identity. Hashing failures surface as typed `KeyHashError`, never throws.
- Cache expiration is lazy rather than timer-driven, avoiding background runtime ownership.
- `notifyFocus` / `notifyReconnect` revalidate opted-in entries in background
  daemons; queries needing services beyond `QueryService` fail silently there
  without touching cached data.
- Persistence, pagination, SSR hydration, and devtools remain
  out of scope (see `docs/roadmap.md`).

## Interruption semantics per operation

- `fetch` (winner): interrupting the caller interrupts the supervised request
  fiber through normal Effect supervision, cancelling the underlying effect.
- `fetch` (joiner): interrupting a concurrent caller only cancels its own
  wait on the shared Deferred; the request continues for the others.
- `cancel(key)`: interrupts the winner fiber for that key, if one is running.
  Waiters observe interruption; nothing is cached; the slot is cleared so the
  next fetch starts fresh work. Cancelling an idle or missing key is a no-op.
- `prefetch`: fire-and-forget by design; the caller's fiber never touches the
  request, so it cannot be cancelled through the returned `void`. Failures die
  with the daemon and are never cached.
- Stale-while-revalidate and focus/reconnect daemons behave like `prefetch`:
  detaching the caller means caller interruption never cancels them.

## Verification surface

### React adapter

`packages/react` is a separate workspace package with a one-way dependency on
core and React/Effect peer dependencies. `createQueryHooks` captures a supplied
`Runtime<QueryService | R>` once; it does not own runtime disposal. This keeps
injected application requirements checked at the hook boundary without erasing
them through a React context. The application disposes its managed runtime after
unmounting the React tree.

Each query hook forks a core fetch after commit. A hashed key plus the stable
definition determines request identity. Cleanup marks the observer inactive and
interrupts its fiber. A new request awaits the previous fiber's finalizers before
starting, so React StrictMode replay cannot join the request it just cancelled.
Results carry their request identity to prevent displaying old-key data between
render and effect setup. Causes preserve both typed errors and defects.

Mutation hooks track concurrent fibers per definition and settle promises with
typed `Exit` values. Cleanup disables that definition's callbacks and interrupts
its outstanding fibers; late completions do not update inactive React state.

The adapter delegates cache behavior and request ownership to core. In particular,
cancelling the winning hook interrupts surviving joiners, and detached stale
revalidation outlives hook cleanup. There is no reactive cache subscription in
this phase: hooks display fetch snapshots, so background cache changes do not
automatically rerender consumers. Core cache semantics and coverage gates are
unchanged. React behavior tests run separately in jsdom, with fake timers for
mount, key change, cleanup, StrictMode, errors, and concurrent mutations.

### Core

The tests exercise the public seam rather than private maps: fresh caching, in-flight deduplication, key isolation, custom hashers and typed hash failures, retries and exhaustion, manual cache operations, stale-while-revalidate, cache-time garbage collection, failure visibility, winner/joiner interruption, cancellation and slot reuse, prefetch warming, focus/reconnect triggers, and mutation success and failure handling. `pnpm test` enforces 100% line/function coverage thresholds (see `vitest.config.ts`).
