# Effect Query

Client-side data-fetching library built on Effect. The first implementation is
available in `src/` and is intentionally UI-agnostic.

Replaces React Query / SWR / Apollo-style caches with typed, interruptible, composable queries.

## Goal

Provide a small, Effect-native API for:
- Declarative queries & mutations
- Automatic cancellation on unmount / key change
- Typed errors + retries
- Fine-grained cache control
- Zero React-specific runtime (works with any UI or plain Effect)

## Core API

```ts
import { Query, Mutation } from "effect-query"
import { Effect } from "effect"

// Define a query
const userQuery = Query.make({
  key: (id: string) => ["user", id] as const,
  execute: (id) =>
    Effect.gen(function* () {
      const res = yield* HttpClient.get(`/api/users/${id}`)
      return yield* Schema.decodeUnknown(User)(res)
    }),
  staleTime: "30 seconds",
  retry: { times: 3, schedule: Schedule.exponential("100 millis") }
})

// Use it
const program = Effect.gen(function* () {
  const user = yield* Query.fetch(userQuery, "123")
  // user is typed, errors are typed
})
```

### Query

```ts
interface QueryOptions<A, E, R, Key extends readonly unknown[]> {
  readonly key: (...args: any[]) => Key
  readonly execute: (...args: any[]) => Effect.Effect<A, E, R>
  readonly hash?: (key: Key) => string
  readonly staleTime?: Duration.DurationInput
  readonly cacheTime?: Duration.DurationInput
  readonly retry?: RetryPolicy
  readonly refetchOnFocus?: boolean
  readonly refetchOnReconnect?: boolean
}

declare const make: <A, E, R, Key extends readonly unknown[]>(
  options: QueryOptions<A, E, R, Key>
) => Query<A, E, R, Key>

declare const fetch: <A, E, R, Key extends readonly unknown[]>(
  query: Query<A, E, R, Key>,
  ...args: Parameters<Query["key"]>
) => Effect.Effect<A, E, R | QueryService>
```

### Mutation

```ts
const updateUser = Mutation.make({
  execute: (id: string, data: UpdateUser) =>
    HttpClient.patch(`/api/users/${id}`, data).pipe(
      Effect.flatMap(Schema.decodeUnknown(User))
    ),
  onSuccess: (user) => Query.invalidate(["user", user.id])
})
```

### Cache / Service

- Single `QueryService` Layer that owns the in-memory cache
- Keys are structural (readonly arrays) hashed by `JSON.stringify` by default;
  `Query.make({ hash })` overrides hashing for `fetch`. Raw-key operations
  (`getData`, `setData`, `invalidate`, `cancel`) always use the default
  hasher. Unhashable keys fail typed with `KeyHashError`, never throw.
- Lazy garbage collection via `cacheTime`
- `Query.invalidate(key)` / `Query.setData(key, data)` / `Query.getData(key)`
- `Query.prefetch(query, ...args)` warms the cache without awaiting data
- `Query.cancel(key)` interrupts the in-flight request for a key, if any
- `Query.notifyFocus()` / `Query.notifyReconnect()` revalidate entries whose
  queries opt in via `refetchOnFocus` / `refetchOnReconnect`

## Key Behaviors

- **Cancellation**: Interrupting the caller Effect interrupts its wait; the underlying shared Effect follows Effect's fiber lifecycle
- **Deduping**: Identical in-flight keys share the same fiber
- **Stale-while-revalidate**: Returns cached data immediately, refetches in background when stale
- **Typed everything**: Success, error, and requirements flow through Effect
- **No React binding required**: Core is pure Effect; a React adapter is future work

## React Adapter (future)

```ts
const { data, error, isPending } = useQuery(userQuery, "123")
const { mutate } = useMutation(updateUser)
```

The adapter is not included in v0.1. A future package may build on Effect fibers and React concurrent features while keeping the core package React-free.

## Out of Scope (v0.1)

- Normalized cache / entity relations
- Infinite queries / pagination helpers
- SSR / hydration helpers
- Devtools
- Offline persistence

## Success Criteria

- `Query.fetch` is a pure Effect
- Interrupting a fetch cancels the underlying HTTP request
- Identical concurrent fetches are deduped
- Cache respects `staleTime` and `cacheTime`
- Errors remain fully typed
- Works in plain Effect programs without requiring React
