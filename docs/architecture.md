# Architecture

## Purpose

Effect Query is a small, UI-agnostic cache module. Its external seam is the `QueryService` context tag. Applications provide one `queryLayer()` per cache lifetime, and query definitions remain plain data plus typed Effect-producing functions.

## Modules

### Query and Mutation definitions

`Query.make` and `Mutation.make` are intentionally thin constructors. A query owns key creation, execution, freshness, retention, and retry policy. A mutation owns execution and may run an Effect-based `onSuccess` handler. Neither module imports React or creates a runtime.

### QueryService implementation

`queryLayer()` creates an isolated in-memory `Map` keyed by a JSON representation of the readonly key tuple. Each entry stores the last successful value, its timestamp, timing policy, and a shared in-flight Effect. `Effect.cached` provides structured deduplication: concurrent callers await one execution and preserve the caller’s typed error and requirements.

The service applies this decision sequence:

1. Remove entries past `cacheTime` (lazy garbage collection).
2. Return a fresh value immediately.
3. Return stale data immediately and fork one daemon revalidation.
4. If no value exists, execute and cache the request result.

Failures are never cached as data. A failed revalidation leaves the previous successful value available.

### Public operations

`Query.fetch` resolves the service from Effect’s context. `Query.getData`, `Query.setData`, and `Query.invalidate` operate on the same structural key space. Invalidation marks an entry stale without requiring callers to know the cache implementation.

## First-version decisions

- Keys must be JSON-serializable readonly arrays; custom hashers are deferred.
- Cache expiration is lazy rather than timer-driven, avoiding background runtime ownership.
- `refetchOnFocus` and `refetchOnReconnect` are stored as forward-compatible query options but have no runtime adapter yet.
- React bindings, persistence, pagination, SSR hydration, and devtools remain out of scope.

## Verification surface

The tests exercise the public seam rather than private maps: fresh caching, in-flight deduplication, retries, manual cache operations, and mutation success handling.
