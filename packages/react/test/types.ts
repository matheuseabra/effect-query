import { Mutation, Query, type QueryService } from "@wthw7/effect-query"
import { Context, Effect, type Runtime } from "effect"
import { createQueryHooks } from "../src/index.js"

class Missing extends Context.Tag("Missing")<Missing, { readonly value: number }>() {}

// Compile-only examples: unprovided requirements and incorrect args must fail.
export function useTypeExamples(runtime: Runtime.Runtime<QueryService>) {
  const { useQuery, useMutation } = createQueryHooks(runtime)
  const query = Query.make({ key: (id: string) => [id], execute: () => Missing })
  // @ts-expect-error Missing is not provided by this runtime.
  useQuery(query, "id")
  const mutation = Mutation.make({ execute: () => Missing })
  // @ts-expect-error Missing is not provided by this runtime.
  useMutation(mutation)
  const valid = Query.make({ key: (id: string) => [id], execute: () => Effect.succeed(1) })
  // @ts-expect-error Query arguments preserve the definition's tuple.
  useQuery(valid, 1)
  const typed = useMutation(Mutation.make({ execute: (value: number) => Effect.succeed(value) }))
  // @ts-expect-error Mutation arguments preserve the definition's tuple.
  void typed.mutate("wrong")
}
