import { KeyHashError, Query } from "@wthw7/effect-query"
import { renderHook } from "@testing-library/react"
import { Cause, Effect, Option } from "effect"
import { StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"
import { advance, setup } from "./support.js"

describe("useQuery", () => {
  const { hooks } = setup()

  it("fetches on mount and reuses fresh data across mounts", async () => {
    const { useQuery } = await hooks()
    const execute = vi.fn((id: string) => id)
    const query = Query.make({ key: (id: string) => [id], execute: (id) => Effect.delay(Effect.sync(() => execute(id)), 20), staleTime: 1000 })
    const first = renderHook(() => useQuery(query, "one"))
    expect(first.result.current).toEqual({ data: undefined, error: undefined, isPending: true })
    await advance(20)
    expect(first.result.current).toEqual({ data: "one", error: undefined, isPending: false })
    first.unmount()
    const second = renderHook(() => useQuery(query, "one"))
    await advance()
    expect(second.result.current.data).toBe("one")
    expect(execute).toHaveBeenCalledOnce()
  })

  it("cancels the old key and never displays its late result", async () => {
    const { useQuery } = await hooks()
    const cancelled = vi.fn()
    const query = Query.make({
      key: (id: string) => [id],
      execute: (id) => Effect.delay(Effect.succeed(id), 20).pipe(
        Effect.onInterrupt(() => Effect.sync(() => { cancelled(id) }))
      )
    })
    const view = renderHook(({ id }) => useQuery(query, id), { initialProps: { id: "old" } })
    await advance(5)
    view.rerender({ id: "new" })
    expect(view.result.current.data).toBeUndefined()
    expect(view.result.current.isPending).toBe(true)
    await advance(20)
    expect(cancelled).toHaveBeenCalledWith("old")
    expect(view.result.current.data).toBe("new")
  })

  it("interrupts an in-flight request on unmount", async () => {
    const { useQuery } = await hooks()
    const cancelled = vi.fn()
    const query = Query.make({
      key: () => ["unmount"],
      execute: () => Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(cancelled)))
    })
    const view = renderHook(() => useQuery(query))
    await advance()
    view.unmount()
    await advance()
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it("exposes typed failures and defects as Effect causes", async () => {
    const { useQuery } = await hooks()
    const query = Query.make({ key: () => ["failure"], execute: () => Effect.fail("offline" as const) })
    const failed = renderHook(() => useQuery(query))
    await advance()
    expect(failed.result.current.isPending).toBe(false)
    expect(Cause.failureOption(failed.result.current.error!)).toEqual(Option.some("offline"))
    const defect = Query.make({ key: () => ["defect"], execute: () => Effect.die("broken") })
    const died = renderHook(() => useQuery(defect))
    await advance()
    expect(Cause.dieOption(died.result.current.error!)).toEqual(Option.some("broken"))
  })

  it("reports invalid keys without throwing during render", async () => {
    const { useQuery } = await hooks()
    const query = Query.make({ key: () => [1n], execute: () => Effect.succeed(1) })
    const view = renderHook(() => useQuery(query))
    await advance()
    expect(Option.getOrThrow(Cause.failureOption(view.result.current.error!))).toBeInstanceOf(KeyHashError)
  })

  it("uses custom structural identity without refetching for new argument objects", async () => {
    const { useQuery } = await hooks()
    const execute = vi.fn(() => 1)
    const query = Query.make({
      key: (arg: { id: bigint }) => [arg.id],
      hash: ([id]) => String(id),
      execute: () => Effect.sync(execute)
    })
    const view = renderHook(() => useQuery(query, { id: 1n }))
    await advance()
    view.rerender()
    await advance()
    expect(view.result.current.data).toBe(1)
    expect(execute).toHaveBeenCalledOnce()
  })

  it("completes after StrictMode cleanup and setup replay", async () => {
    const { useQuery } = await hooks()
    const query = Query.make({ key: () => ["strict"], execute: () => Effect.delay(Effect.succeed(1), 20) })
    const view = renderHook(() => useQuery(query), { wrapper: StrictMode })
    await advance(20)
    expect(view.result.current).toEqual({ data: 1, error: undefined, isPending: false })
  })

  it("deduplicates observers and only cancels a joining observer's wait", async () => {
    const { useQuery } = await hooks()
    const execute = vi.fn(() => 1)
    const query = Query.make({ key: () => ["shared"], execute: () => Effect.delay(Effect.sync(execute), 20) })
    const winner = renderHook(() => useQuery(query))
    await advance()
    const joiner = renderHook(() => useQuery(query))
    await advance()
    joiner.unmount()
    await advance(20)
    expect(winner.result.current.data).toBe(1)
    expect(execute).toHaveBeenCalledOnce()
  })

  it("exposes interruption to joiners when the winning observer unmounts", async () => {
    const { useQuery } = await hooks()
    const query = Query.make({ key: () => ["winner-cancel"], execute: () => Effect.never })
    const winner = renderHook(() => useQuery(query))
    await advance()
    const joiner = renderHook(() => useQuery(query))
    await advance()
    winner.unmount()
    await advance()
    expect(joiner.result.current.isPending).toBe(false)
    expect(Cause.isInterrupted(joiner.result.current.error!)).toBe(true)
  })

  it("recovers after an invalid key changes to a valid key", async () => {
    const { useQuery } = await hooks()
    const query = Query.make({ key: (id: bigint | string) => [id], execute: () => Effect.succeed(1) })
    const view = renderHook(({ id }) => useQuery(query, id), { initialProps: { id: 1n as bigint | string } })
    await advance()
    expect(view.result.current.error).toBeDefined()
    view.rerender({ id: "valid" })
    await advance()
    expect(view.result.current).toEqual({ data: 1, error: undefined, isPending: false })
  })
})
