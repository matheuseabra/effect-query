import { KeyHashError, Query, type QueryDefinition, type QueryKey, type QueryService } from "@wthw7/effect-query"
import { Cause, Effect, Exit, Fiber, Runtime } from "effect"
import { useEffect, useMemo, useRef, useState } from "react"

export interface QueryResult<A, E> {
  readonly data: A | undefined
  readonly error: Cause.Cause<E | KeyHashError> | undefined
  readonly isPending: boolean
}

const pending = { data: undefined, error: undefined, isPending: true } as const

export const makeUseQuery = <R>(runtime: Runtime.Runtime<R | QueryService>) =>
  function useQuery<Args extends readonly unknown[], A, E, Key extends QueryKey>(
    definition: QueryDefinition<Args, A, E, R, Key>,
    ...args: Args
  ): QueryResult<A, E> {
    // Key identity, rather than fresh argument objects, controls the request.
    const identity = Effect.runSyncExit(Effect.try({
      try: () => (definition.hash ?? JSON.stringify)(definition.key(...args)),
      catch: (reason) => new KeyHashError({ key: args, reason })
    }))
    const hash = Exit.isSuccess(identity) ? identity.value : undefined
    const request = useMemo(() => ({
      effect: Exit.isFailure(identity)
        ? Effect.failCause(identity.cause)
        : Effect.suspend(() => Query.fetch(definition, ...args))
    }), [definition, hash])
    const previous = useRef<Fiber.RuntimeFiber<A, E | KeyHashError> | undefined>(undefined)
    const [state, setState] = useState<{ request: typeof request; result: QueryResult<A, E> }>(
      { request, result: pending }
    )

    useEffect(() => {
      let active = true
      setState({ request, result: pending })
      // Wait for interrupted cleanup before reusing a key (including StrictMode).
      const ready = previous.current === undefined ? Effect.void : Fiber.await(previous.current)
      const fiber = Runtime.runFork(runtime)(Effect.zipRight(ready, request.effect))
      previous.current = fiber
      fiber.addObserver((exit) => {
        if (!active) return
        const result = Exit.isSuccess(exit)
          ? { data: exit.value, error: undefined, isPending: false }
          : { data: undefined, error: exit.cause, isPending: false }
        setState({ request, result })
      })
      return () => {
        active = false
        Runtime.runFork(runtime)(Fiber.interrupt(fiber))
      }
    }, [request])

    return state.request === request ? state.result : pending
  }
