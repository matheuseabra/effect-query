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
- **No React binding required**: Core is pure Effect; React hooks live in a separate optional package

## React Adapter

```ts
const { useQuery, useMutation } = createQueryHooks(await managed.runtime())
const { data, error, isPending } = useQuery(userQuery, "123")
const { mutate } = useMutation(updateUser)
```

`@wthw7/effect-query-react` binds hooks to an application-owned Effect runtime
with `createQueryHooks`. The runtime must provide `QueryService` and the
definitions' requirements. React remains absent from the core package manifest.

`useQuery` starts a fetch fiber after commit and interrupts it on key/definition
changes or unmount. Identity is the stable definition plus its hashed key. It
returns `data: A | undefined`, `error: Cause<E | KeyHashError> | undefined`, and
`isPending: boolean`; a changed identity clears the displayed result immediately.
Core winner/joiner interruption and detached background revalidation semantics
remain unchanged. Results are fetch snapshots: mounted hooks do not subscribe
to cache writes, invalidation, or background revalidation completion.

`useMutation` returns `mutate(...args): Promise<Exit<A, E | E2>>` and `isPending`.
Pending covers all concurrent calls through completion of `onSuccess`. Unmount
or definition changes interrupt outstanding mutation fibers. Retained callbacks
cannot start work after cleanup. Outcomes preserve typed errors and defects
without unhandled promise rejections.

See the [adapter README](../packages/react/README.md) for a complete example,
runtime ownership, cancellation details, and current limitations.

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
