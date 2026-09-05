# effect-query

[![version](https://img.shields.io/badge/version-0.3.0--beta.0-blue)](https://www.npmjs.com/package/@wthw7/effect-query)
[![CI](https://github.com/matheuseabra/effect-query/actions/workflows/ci.yml/badge.svg)](https://github.com/matheuseabra/effect-query/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/matheuseabra/effect-query.svg)](./LICENSE)

Typed, interruptible query caching for [Effect](https://effect.website/) is
a TanStack Query-style cache that is plain Effect all the way down, with no
React (or any UI) dependency.

## Why

Client caches like TanStack Query, SWR, and Apollo own their own runtime:
framework-coupled lifecycles, untyped errors, and cancellation and
deduplication rules you cannot compose. When your program is already Effect,
the cache should be Effect too — a query should just be an `Effect` with
typed success, typed failure, and interruption that cancels the request.

`effect-query` is that cache: one UI-agnostic `QueryService` layer, queries
as data plus typed `Effect` constructors, and cache semantics (freshness,
retention, deduplication, retries) expressed through fibers instead of a
parallel runtime.

## Features

- UI-agnostic core — works in any Effect program; UI bindings stay out of core
- Optional [React adapter](./packages/react/README.md) with runtime-bound query
  and mutation hooks, typed outcomes, and unmount cancellation
- Structural readonly-tuple keys shared by reads, writes, and invalidation
- Fresh/stale caching with stale-while-revalidate and background refresh
- Single-flight in-flight deduplication across concurrent fetches
- Fully typed success, error, and requirements channels via Effect
- Retries with Effect `Schedule`s; failures are never cached
- Interruptible fetches: cancelling the winner cancels the request, cancelling
  a joiner only cancels its own wait
- Manual `getData` / `setData` / `invalidate` over the same key space
- Custom key hashers with typed `KeyHashError` instead of throws
- Fire-and-forget `prefetch` and per-key `cancel`
- Focus/reconnect revalidation triggers for opted-in queries
- Mutations with `QueryService`-backed `onSuccess` hooks
- Lazy `cacheTime` garbage collection with no background timers
- Strict TypeScript with 100% line test coverage

## Quick start

```ts
import { Effect } from "effect"
import { Query, queryLayer } from "@wthw7/effect-query"

const user = Query.make({
  key: (id: string) => ["user", id] as const,
  execute: (id) => Effect.succeed({ id }),
  staleTime: "30 seconds"
})

const program = Query.fetch(user, "123").pipe(
  Effect.provide(queryLayer())
)
```

## Install

```sh
bun add @wthw7/effect-query
```

Requires Bun (or Node 18 and later) and `effect` 3 as a runtime dependency
(installed automatically as a direct dependency).

## Usage

### Define and fetch a query

```ts
import { Effect } from "effect"
import { Query, queryLayer } from "@wthw7/effect-query"

const userQuery = Query.make({
  key: (id: string) => ["user", id] as const,
  execute: (id: string) =>
    Effect.tryPromise({
      try: () => fetch(`/api/users/${id}`).then((res) => res.json()),
      catch: () => new Error("request failed")
    }),
  staleTime: "30 seconds"
})

const program = Effect.gen(function* () {
  const user = yield* Query.fetch(userQuery, "123")
  return user
}).pipe(Effect.provide(queryLayer()))
```

Keys are readonly tuples, so `["user", "123"]` built anywhere in the program
addresses the same cache entry. Concurrent fetches for one key share a single
in-flight request.

### Freshness and retention

```ts
const postsQuery = Query.make({
  key: () => ["posts"] as const,
  execute: () => Effect.promise(() => fetch("/api/posts").then((res) => res.json())),
  staleTime: "1 minute",
  cacheTime: "10 minutes"
})
```

While data is fresh, `fetch` returns the cached value without executing.
Once stale, `fetch` returns the cached value immediately and revalidates in
the background. Entries unused for longer than `cacheTime` are garbage
collected.

### Retries

```ts
import { Schedule } from "effect"

const resilientQuery = Query.make({
  key: () => ["status"] as const,
  execute: () => Effect.promise(() => fetch("/api/status").then((res) => res.json())),
  retry: { times: 3, schedule: Schedule.exponential("100 millis") }
})
```

Failures are never cached: when retries are exhausted the typed error
propagates to the caller and the next fetch starts over.

### Manual cache access

```ts
import { Option } from "effect"

const program = Effect.gen(function* () {
  yield* Query.setData(["user", "123"], { id: "123", name: "Ada" })

  const cached = yield* Query.getData<{ id: string; name: string }>(["user", "123"])
  const name = Option.match(cached, {
    onNone: () => "unknown",
    onSome: (user) => user.name
  })

  yield* Query.invalidate(["user", "123"])
  return name
}).pipe(Effect.provide(queryLayer()))
```

### Mutations that refresh queries

```ts
import { Mutation } from "@wthw7/effect-query"

const updateUser = Mutation.make({
  execute: (id: string, name: string) =>
    Effect.promise(() =>
      fetch(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }).then((res) =>
        res.json()
      )
    ),
  onSuccess: (user: { id: string }) => Query.invalidate(["user", user.id])
})

const program = Mutation.execute(updateUser, "123", "Ada").pipe(Effect.provide(queryLayer()))
```

The `onSuccess` hook runs with access to the `QueryService`, so a mutation can
invalidate or seed exactly the keys it affects. If the mutation fails, the
hook does not run and the typed error propagates.

### Custom key hashers

```ts
const userQuery = Query.make({
  key: (id: number, stamp: number) => ["user", id, stamp] as const,
  hash: (key) => `user:${key[1]}`,
  execute: (id: number) => Effect.succeed({ id }),
  staleTime: "1 minute"
})
```

`fetch` hashes with `hash` when provided (`JSON.stringify` otherwise), so
keys that differ only in volatile parts share one entry. Raw-key operations
(`getData`, `setData`, `invalidate`, `cancel`) always use the default hasher.
Keys that cannot be hashed fail typed with `KeyHashError`.

### Prefetch, cancel, and focus triggers

```ts
const program = Effect.gen(function* () {
  yield* Query.prefetch(postsQuery)
  yield* Query.notifyFocus()
  yield* Query.cancel(["posts"])
}).pipe(Effect.provide(queryLayer()))
```

`prefetch` warms the cache without awaiting data. `cancel` interrupts the
in-flight request for a key, if any. `notifyFocus` / `notifyReconnect`
revalidate entries whose queries opt in via `refetchOnFocus` /
`refetchOnReconnect`:

```ts
const postsQuery = Query.make({
  key: () => ["posts"] as const,
  execute: () => Effect.promise(() => fetch("/api/posts").then((res) => res.json())),
  refetchOnFocus: true
})
```

### Typed errors

```ts
class UserNotFound {
  readonly _tag = "UserNotFound"
  constructor(readonly id: string) {}
}

const strictQuery = Query.make({
  key: (id: string) => ["user", id] as const,
  execute: (id: string) => Effect.fail(new UserNotFound(id))
})

const result = await Effect.runPromiseExit(
  Query.fetch(strictQuery, "missing").pipe(Effect.provide(queryLayer()))
)
// result is Exit.fail(new UserNotFound("missing"))
```

## Contributing

Contributions are welcome — bug reports, real-world use cases, docs, and pull
requests.

```sh
pnpm install
pnpm check
```

`pnpm check` uses Turborepo to run typecheck, lint, coverage tests, and build
for core and the React adapter. pnpm manages workspace dependencies; Turbo
orders tasks and caches successful results in `.turbo/cache`. The adapter's
build, typecheck, and tests wait for core's build. Shared TypeScript and lint
configuration changes invalidate the cache, and build/coverage artifacts are
restored on cache hits. CI retains the task cache with GitHub Actions caching;
no remote-cache account is required.

Core stays at the repository root, with its commands registered as Turbo root
tasks in `turbo.json`; the adapter lives in `packages/react`. `pnpm build`,
`pnpm test`, `pnpm lint`, and `pnpm typecheck` at the root still target core.
Use `pnpm exec turbo run build` to build both packages, or
`pnpm exec turbo run test --filter=@wthw7/effect-query-react` for adapter tests
with core built first. `pnpm check --force` reruns all tasks without cache hits.
Watch mode remains available through `pnpm test:watch` for core.

Please keep 100% line coverage, name tests after observable
behavior, and use concise imperative commit subjects (`feat:`, `fix:`,
`test:`, `docs:`). For larger changes, open an issue first so the design can
be discussed before code.

See [`docs/spec.md`](docs/spec.md) for the product contract and
[`docs/architecture.md`](docs/architecture.md) for implementation decisions.

## License

MIT — see [LICENSE](./LICENSE).
