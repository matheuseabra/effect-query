# @wthw7/effect-query-react

React 18/19 hooks for [Effect Query](../../README.md). The adapter depends on
the core package; the core has no React dependency.

## Install

```sh
pnpm add @wthw7/effect-query-react@beta @wthw7/effect-query@beta effect react react-dom
```

Version `0.3.0-beta.0` is prepared for release; the install command works once
both packages have been published.

## Example

Create the runtime and hooks once during application startup. Merge application
service layers with `queryLayer()` before obtaining the runtime; the hooks only
accept definitions whose requirements that runtime provides.

```tsx
import { Mutation, Query, queryLayer } from "@wthw7/effect-query"
import { createQueryHooks } from "@wthw7/effect-query-react"
import { Cause, Effect, Exit, ManagedRuntime } from "effect"
import { createRoot } from "react-dom/client"

const managed = ManagedRuntime.make(queryLayer())
const { useQuery, useMutation } = createQueryHooks(await managed.runtime())

const userQuery = Query.make({
  key: (id: string) => ["user", id] as const,
  execute: (id) => Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`/api/users/${id}`, { signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.text()
    },
    catch: (error) => String(error)
  }),
  staleTime: "30 seconds"
})

const saveName = Mutation.make({
  execute: (name: string) => Effect.tryPromise({
    try: (signal) => fetch("/api/name", { method: "PUT", body: name, signal }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return name
    }),
    catch: (error) => String(error)
  }),
  onSuccess: () => Query.invalidate(["user", "123"])
})

function User() {
  const { data, error, isPending } = useQuery(userQuery, "123")
  const { mutate, isPending: isSaving } = useMutation(saveName)
  if (isPending) return <p>Loading…</p>
  if (error) return <pre>{Cause.pretty(error)}</pre>
  return <button disabled={isSaving} onClick={async () => {
    const exit = await mutate("Ada")
    if (Exit.isFailure(exit)) console.error(Cause.pretty(exit.cause))
  }}>{data}</button>
}

const root = createRoot(document.getElementById("root")!)
root.render(<User />)

// At application shutdown (not after each render):
// root.unmount()
// await managed.dispose()
```

## Contract

- `createQueryHooks(runtime)` returns `useQuery` and `useMutation`; no global
  runtime or provider is installed. Create separate hook sets for separate caches.
- `useQuery(definition, ...args)` returns `{ data, error, isPending }`.
  `error` is `Cause<E | KeyHashError> | undefined`, preserving typed failures,
  defects, and interruption. Inspect typed failures with `Cause.failureOption`.
- Keep definitions stable (module scope or `useMemo`). Request identity is the
  definition plus the hashed key. Fresh argument objects with the same hash do
  not restart a request. Include every input affecting the result in the key;
  custom hashers and key functions must be pure and deterministic.
- Mount, definition changes, and key changes start a `Query.fetch` fiber. Key
  changes immediately show pending state without displaying the previous key's
  data. Cleanup interrupts the hook's fiber and ignores its late completion.
- The core's winner/joiner semantics apply: removing the winning observer cancels
  the shared request, and surviving joiners receive an interruption cause.
  Removing a joiner cancels only its own wait. This adapter does not introduce
  reference-counted request ownership.
- Results are snapshots of `Query.fetch`, not cache subscriptions. A stale cache
  hit returns stale data while core revalidation runs independently. Background
  completion, `setData`, and invalidation do not update mounted hook results;
  remount or change the query key/definition to read again. Background core
  daemons are not owned or cancelled by hook cleanup.
- `useMutation(definition)` returns `{ mutate, isPending }`. `mutate(...args)`
  returns `Promise<Exit<A, E | E2>>`, which resolves for typed failures, defects,
  and interruption as well as success. Pending remains true until all concurrent
  invocations (including `onSuccess`) complete. Cleanup interrupts outstanding
  mutation fibers; retained callbacks resolve with interruption without starting
  work. Interruption cannot undo a write already received by a server.
- SSR/hydration and automatic browser focus/reconnect listeners are outside this
  adapter's scope. Effects start after commit; server rendering remains pending.

## Development

From the repository root, run `pnpm install` then `pnpm check`. Turborepo runs
both packages' checks, builds core before the adapter's dependent tasks, and
caches build and coverage artifacts. For the adapter suite alone, run
`pnpm exec turbo run test --filter=@wthw7/effect-query-react` from the root;
this also builds core when needed. The fake-timer harness in
`test/query.test.tsx` proves mount → fetch → unmount cancellation, key changes,
StrictMode replay, and shared-request behavior. Mutation tests cover concurrency,
typed outcomes, cleanup, and core success handlers. Each package independently
enforces 100% line/function coverage.

## Release

Both packages are versioned at `0.3.0-beta.0`. Before pushing the release tag,
configure npm Trusted Publishing for `@wthw7/effect-query-react` using this
repository's `.github/workflows/release.yml` workflow (bootstrap the package if
npm requires it). The release workflow packs with pnpm so `workspace:^` becomes
a registry version, then publishes core followed by the adapter through npm OIDC.
Opening a PR does not publish either package.
