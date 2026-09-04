# effect-query

Typed, interruptible query caching for [Effect](https://effect.website/).

The first version provides a UI-agnostic `QueryService` with structural keys,
fresh/stale cache handling, in-flight deduplication, typed retries, manual
invalidation, and mutation success hooks.

```ts
import { Effect } from "effect"
import { Query, queryLayer } from "effect-query"

const user = Query.make({
  key: (id: string) => ["user", id] as const,
  execute: (id) => Effect.succeed({ id }),
  staleTime: "30 seconds"
})

const program = Query.fetch(user, "123").pipe(
  Effect.provide(queryLayer())
)
```

## Development

```sh
pnpm install
pnpm check
```

See [`docs/spec.md`](docs/spec.md) for the product contract and
[`docs/architecture.md`](docs/architecture.md) for implementation decisions.
