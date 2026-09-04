# effect-query

[![npm version](https://img.shields.io/npm/v/@matheuseabra%2Feffect-query.svg)](https://www.npmjs.com/package/@matheuseabra/effect-query)
[![CI](https://github.com/matheuseabra/effect-query/actions/workflows/ci.yml/badge.svg)](https://github.com/matheuseabra/effect-query/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/matheuseabra/effect-query.svg)](./LICENSE)

Typed, interruptible query caching for [Effect](https://effect.website/).

The first version provides a UI-agnostic `QueryService` with structural keys,
fresh/stale cache handling, in-flight deduplication, typed retries, manual
invalidation, and mutation success hooks.

```ts
import { Effect } from "effect"
import { Query, queryLayer } from "@matheuseabra/effect-query"

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
bun add @matheuseabra/effect-query
```

Requires Bun (or Node 18 and later) and `effect` 3 as a runtime dependency
(installed automatically as a direct dependency).

## Usage

### Define and fetch a query

```ts
import { Effect } from "effect"
import { Query, queryLayer } from "@matheuseabra/effect-query"

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
import { Mutation } from "@matheuseabra/effect-query"

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

## Development

```sh
pnpm install
pnpm check
```

See [`docs/spec.md`](docs/spec.md) for the product contract and
[`docs/architecture.md`](docs/architecture.md) for implementation decisions.
