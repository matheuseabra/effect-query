import { Mutation, Query } from "@wthw7/effect-query"
import { act, renderHook } from "@testing-library/react"
import { Cause, Effect, Exit, Option } from "effect"
import { describe, expect, it, vi } from "vitest"
import { advance, setup } from "./support.js"

describe("useMutation", () => {
  const { hooks, run } = setup()

  it("tracks pending work through the core onSuccess handler", async () => {
    const { useMutation } = await hooks()
    const mutation = Mutation.make({
      execute: (value: number) => Effect.delay(Effect.succeed(value), 20),
      onSuccess: (value) => Query.setData(["saved"], value)
    })
    const view = renderHook(() => useMutation(mutation))
    expect(view.result.current.isPending).toBe(false)
    let outcome!: Promise<Exit.Exit<number, unknown>>
    act(() => { outcome = view.result.current.mutate(42) })
    expect(view.result.current.isPending).toBe(true)
    await advance(20)
    expect(await outcome).toEqual(Exit.succeed(42))
    expect(view.result.current.isPending).toBe(false)
    expect(await run(Query.getData(["saved"]))).toEqual(Option.some(42))
  })

  it("returns typed execution and onSuccess failures without unhandled rejection", async () => {
    const { useMutation } = await hooks()
    const mutation = Mutation.make({ execute: () => Effect.fail("offline") })
    const view = renderHook(() => useMutation(mutation))
    let outcome!: Promise<Exit.Exit<unknown, string>>
    await act(async () => { outcome = view.result.current.mutate(); await outcome })
    expect(await outcome).toEqual(Exit.fail("offline"))
    expect(view.result.current.isPending).toBe(false)
    const other = Mutation.make({ execute: () => Effect.succeed(1), onSuccess: () => Effect.fail("save") })
    const handler = renderHook(() => useMutation(other))
    await act(async () => { outcome = handler.result.current.mutate(); await outcome })
    expect(await outcome).toEqual(Exit.fail("save"))
  })

  it("stays pending until all concurrent mutations finish", async () => {
    const { useMutation } = await hooks()
    const mutation = Mutation.make({ execute: (delay: number) => Effect.delay(Effect.succeed(delay), delay) })
    const view = renderHook(() => useMutation(mutation))
    act(() => { void view.result.current.mutate(10); void view.result.current.mutate(30) })
    await advance(10)
    expect(view.result.current.isPending).toBe(true)
    await advance(20)
    expect(view.result.current.isPending).toBe(false)
  })

  it("interrupts on unmount and refuses work through a retained callback", async () => {
    const { useMutation } = await hooks()
    const cancelled = vi.fn()
    const mutation = Mutation.make({ execute: () => Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(cancelled))) })
    const view = renderHook(() => useMutation(mutation))
    const mutate = view.result.current.mutate
    let outcome!: Promise<Exit.Exit<unknown, never>>
    act(() => { outcome = mutate() })
    await advance()
    view.unmount()
    await advance()
    expect(cancelled).toHaveBeenCalledOnce()
    const exit = await outcome
    expect(Exit.isFailure(exit) && Cause.isInterrupted(exit.cause)).toBe(true)
    const retained = await mutate()
    expect(Exit.isFailure(retained) && Cause.isInterrupted(retained.cause)).toBe(true)
  })

  it("cancels the previous definition and resets pending when the definition changes", async () => {
    const { useMutation } = await hooks()
    const old = Mutation.make({ execute: (): Effect.Effect<number> => Effect.never })
    const next = Mutation.make({ execute: () => Effect.succeed(2) })
    const view = renderHook(({ definition }) => useMutation(definition), { initialProps: { definition: old } })
    act(() => { void view.result.current.mutate() })
    await advance()
    view.rerender({ definition: next })
    expect(view.result.current.isPending).toBe(false)
    await act(async () => { expect(await view.result.current.mutate()).toEqual(Exit.succeed(2)) })
  })
})
