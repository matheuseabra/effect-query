import type { QueryService } from "@wthw7/effect-query"
import type { Runtime } from "effect"
import { makeUseMutation } from "./mutation.js"
import { makeUseQuery } from "./query.js"

/** Create once per application/cache lifetime, outside React render. */
export const createQueryHooks = <R>(runtime: Runtime.Runtime<R | QueryService>) => ({
  useQuery: makeUseQuery(runtime),
  useMutation: makeUseMutation(runtime)
})

export type { QueryResult } from "./query.js"
export type { MutationResult } from "./mutation.js"
