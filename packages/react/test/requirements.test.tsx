import { Mutation, Query, queryLayer } from "@wthw7/effect-query"
import { act, cleanup, renderHook } from "@testing-library/react"
import { Context, Effect, Exit, Layer, ManagedRuntime } from "effect"
import { expect, it } from "vitest"
import { createQueryHooks } from "../src/index.js"

class Api extends Context.Tag("Api")<Api, { readonly value: string }>() {}

it("provides application services to both query and mutation fibers", async () => {
  const managed = ManagedRuntime.make(Layer.merge(queryLayer(), Layer.succeed(Api, { value: "injected" })))
  try {
    const { useQuery, useMutation } = createQueryHooks(await managed.runtime())
    const execute = () => Effect.map(Api, (api) => api.value)
    const query = Query.make({ key: () => ["api"], execute })
    const mutation = Mutation.make({ execute })
    const view = renderHook(() => ({ query: useQuery(query), mutation: useMutation(mutation) }))
    await act(async () => {
      expect(await view.result.current.mutation.mutate()).toEqual(Exit.succeed("injected"))
    })
    expect(view.result.current.query.data).toBe("injected")
  } finally {
    cleanup()
    await managed.dispose()
  }
})
