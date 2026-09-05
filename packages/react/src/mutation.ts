import { Mutation, type MutationDefinition, type QueryService } from "@wthw7/effect-query"
import { Effect, Exit, Fiber, Runtime } from "effect"
import { useCallback, useEffect, useMemo, useState } from "react"

export interface MutationResult<Args extends readonly unknown[], A, E> {
  readonly mutate: (...args: Args) => Promise<Exit.Exit<A, E>>
  readonly isPending: boolean
}

export const makeUseMutation = <R>(runtime: Runtime.Runtime<R | QueryService>) =>
  function useMutation<Args extends readonly unknown[], A, E, E2>(
    definition: MutationDefinition<Args, A, E, R, E2>
  ): MutationResult<Args, A, E | E2> {
    const lifecycle = useMemo(() => ({
      active: false,
      fibers: new Set<Fiber.RuntimeFiber<A, E | E2>>()
    }), [definition])
    const [state, setState] = useState({ lifecycle, count: 0 })

    useEffect(() => {
      lifecycle.active = true
      return () => {
        lifecycle.active = false
        for (const fiber of lifecycle.fibers) {
          Runtime.runFork(runtime)(Fiber.interrupt(fiber))
        }
      }
    }, [lifecycle])

    const mutate = useCallback((...args: Args): Promise<Exit.Exit<A, E | E2>> => {
      if (!lifecycle.active) return Effect.runPromiseExit(Effect.interrupt)
      const fiber = Runtime.runFork(runtime)(Effect.suspend(() => Mutation.execute(definition, ...args)))
      lifecycle.fibers.add(fiber)
      setState({ lifecycle, count: lifecycle.fibers.size })
      return new Promise((resolve) => {
        fiber.addObserver((exit) => {
          lifecycle.fibers.delete(fiber)
          if (lifecycle.active) setState({ lifecycle, count: lifecycle.fibers.size })
          resolve(exit)
        })
      })
    }, [definition, lifecycle])

    return { mutate, isPending: state.lifecycle === lifecycle && state.count > 0 }
  }
