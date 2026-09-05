import { queryLayer, type QueryService } from "@wthw7/effect-query"
import { act, cleanup } from "@testing-library/react"
import { Effect, ManagedRuntime } from "effect"
import { afterEach, beforeEach, vi } from "vitest"
import { createQueryHooks } from "../src/index.js"

export const setup = () => {
  let managed: ManagedRuntime.ManagedRuntime<QueryService, never>
  beforeEach(() => {
    vi.useFakeTimers()
    managed = ManagedRuntime.make(queryLayer())
  })
  afterEach(async () => {
    cleanup()
    await advance()
    await managed.dispose()
    vi.useRealTimers()
  })
  return {
    run: <A, E>(effect: Effect.Effect<A, E, QueryService>) => managed.runPromise(effect),
    hooks: async () => createQueryHooks(await managed.runtime())
  }
}

export const advance = async (millis = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(millis) })
}
