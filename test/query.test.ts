import { Effect, Exit, Fiber, Option, Schedule } from "effect"
import { describe, expect, it } from "vitest"
import { Mutation, Query, queryLayer, KeyHashError, type QueryServiceShape } from "../src/index.js"

const run = <A, E>(program: Effect.Effect<A, E, QueryServiceShape>) =>
	Effect.runPromise(program.pipe(Effect.provide(queryLayer())))

describe("Query", () => {
	it("caches fresh results by structural key", async () => {
		let calls = 0
		const query = Query.make({
			key: (id: number) => ["user", id] as const,
			execute: (id) => Effect.sync(() => ({ id, call: ++calls })),
			staleTime: "1 minute"
		})

		const result = await run(Effect.all([Query.fetch(query, 1), Query.fetch(query, 1)]))

		expect(result).toEqual([
			{ id: 1, call: 1 },
			{ id: 1, call: 1 }
		])
		expect(calls).toBe(1)
	})

	it("dedupes concurrent in-flight requests", async () => {
		let calls = 0
		const query = Query.make({
			key: (id: number) => ["slow", id] as const,
			execute: (id) => Effect.sleep("10 millis").pipe(Effect.map(() => ({ id, call: ++calls })))
		})

		const program = Effect.gen(function* () {
			const first = yield* Effect.fork(Query.fetch(query, 2))
			const second = yield* Effect.fork(Query.fetch(query, 2))
			return yield* Effect.all([Fiber.join(first), Fiber.join(second)])
		})

		expect(await run(program)).toEqual([
			{ id: 2, call: 1 },
			{ id: 2, call: 1 }
		])
		expect(calls).toBe(1)
	})

	it("retries failures using the configured policy", async () => {
		let attempts = 0
		const query = Query.make({
			key: () => ["retry"] as const,
			execute: () =>
				Effect.suspend(() =>
					attempts++ < 2 ? Effect.fail("temporary") : Effect.succeed("ready")
				),
			retry: { times: 2, schedule: Schedule.recurs(2) }
		})

		expect(await run(Query.fetch(query))).toBe("ready")
		expect(attempts).toBe(3)
	})

	it("supports set, get, and invalidate operations", async () => {
		let calls = 0
		const query = Query.make({
			key: (id: number) => ["item", id] as const,
			execute: (id) => Effect.sync(() => ({ id, call: ++calls })),
			staleTime: "1 minute"
		})

		const program = Effect.gen(function* () {
			yield* Query.setData(["item", 3], { id: 3, call: 0 })
			const seeded = yield* Query.getData<{ id: number; call: number }>(["item", 3])
			yield* Query.invalidate(["item", 3])
			const refreshed = yield* Query.fetch(query, 3)
			return { seeded, refreshed }
		})
		const result = await run(program)

		expect(Option.getOrThrow(result.seeded)).toEqual({ id: 3, call: 0 })
		expect(result.refreshed).toEqual({ id: 3, call: 1 })
	})

	it("runs mutation success handlers with the query service", async () => {
		const mutation = Mutation.make({
			execute: (id: number) => Effect.succeed({ id }),
			onSuccess: (value) => Query.invalidate(["user", value.id])
		})

		expect(await run(Mutation.execute(mutation, 7))).toEqual({ id: 7 })
	})

	it("does not share in-flight work across different keys", async () => {
		let calls = 0
		const query = Query.make({
			key: (id: number) => ["user", id] as const,
			execute: (id: number) =>
				Effect.sleep("10 millis").pipe(Effect.map(() => ({ id, call: ++calls })))
		})

		const program = Effect.gen(function* () {
			const first = yield* Effect.fork(Query.fetch(query, 1))
			const second = yield* Effect.fork(Query.fetch(query, 2))
			return yield* Effect.all([Fiber.join(first), Fiber.join(second)])
		})
		const [one, two] = await run(program)

		expect(one.id).toBe(1)
		expect(two.id).toBe(2)
		expect(calls).toBe(2)
	})

	it("revalidates in the background when data is already stale", async () => {
		let calls = 0
		const query = Query.make({
			key: () => ["live"] as const,
			execute: () => Effect.sync(() => ++calls)
		})

		const program = Effect.gen(function* () {
			const first = yield* Query.fetch(query)
			const second = yield* Query.fetch(query)
			let revalidated = yield* Query.getData<number>(["live"])
			for (let i = 0; i < 50 && !(Option.isSome(revalidated) && revalidated.value === 2); i++) {
				yield* Effect.sleep("10 millis")
				revalidated = yield* Query.getData<number>(["live"])
			}
			return { first, second, revalidated }
		})
		const result = await run(program)

		expect(result.first).toBe(1)
		expect(result.second).toBe(1)
		expect(Option.getOrThrow(result.revalidated)).toBe(2)
		expect(calls).toBe(2)
	})

	it("serves seeded data to fresh fetches without executing", async () => {
		let calls = 0
		const query = Query.make({
			key: (id: number) => ["seeded", id] as const,
			execute: (id: number) => Effect.sync(() => ({ id, call: ++calls })),
			staleTime: "1 minute"
		})

		const program = Effect.gen(function* () {
			yield* Query.setData(["seeded", 9], { id: 9, call: 0 })
			return yield* Query.fetch(query, 9)
		})

		expect(await run(program)).toEqual({ id: 9, call: 0 })
		expect(calls).toBe(0)
	})

	it("propagates typed errors without caching failures", async () => {
		let calls = 0
		const query = Query.make({
			key: () => ["broken"] as const,
			execute: () =>
				Effect.sync(() => ++calls).pipe(Effect.flatMap(() => Effect.fail("boom" as const)))
		})

		const first = await Effect.runPromiseExit(Query.fetch(query).pipe(Effect.provide(queryLayer())))
		const second = await Effect.runPromiseExit(Query.fetch(query).pipe(Effect.provide(queryLayer())))

		expect(first).toEqual(Exit.fail("boom"))
		expect(second).toEqual(Exit.fail("boom"))
		expect(calls).toBe(2)
	})

	it("propagates the last error when retries are exhausted", async () => {
		let attempts = 0
		const query = Query.make({
			key: () => ["exhausted"] as const,
			execute: () =>
				Effect.suspend(() => (attempts++ < 5 ? Effect.fail("down" as const) : Effect.succeed("up"))),
			retry: { times: 1 }
		})

		const exit = await Effect.runPromiseExit(Query.fetch(query).pipe(Effect.provide(queryLayer())))

		expect(exit).toEqual(Exit.fail("down"))
		expect(attempts).toBe(2)
	})

	it("returns stale data immediately while revalidating in the background", async () => {
		let calls = 0
		const query = Query.make({
			key: () => ["news"] as const,
			execute: () => Effect.sync(() => ++calls),
			staleTime: "10 millis"
		})

		const program = Effect.gen(function* () {
			const fresh = yield* Query.fetch(query)
			yield* Effect.sleep("30 millis")
			const stale = yield* Query.fetch(query)
			let revalidated = yield* Query.getData<number>(["news"])
			for (let i = 0; i < 50 && !(Option.isSome(revalidated) && revalidated.value === 2); i++) {
				yield* Effect.sleep("10 millis")
				revalidated = yield* Query.getData<number>(["news"])
			}
			return { fresh, stale, revalidated }
		})
		const result = await run(program)

		expect(result.fresh).toBe(1)
		expect(result.stale).toBe(1)
		expect(Option.getOrThrow(result.revalidated)).toBe(2)
		expect(calls).toBe(2)
	})

	it("garbage-collects entries past cache time", async () => {
		let calls = 0
		const query = Query.make({
			key: () => ["short"] as const,
			execute: () => Effect.sync(() => ++calls),
			cacheTime: "20 millis"
		})

		const program = Effect.gen(function* () {
			const first = yield* Query.fetch(query)
			const cached = yield* Query.getData<number>(["short"])
			yield* Effect.sleep("50 millis")
			const expired = yield* Query.getData<number>(["short"])
			const second = yield* Query.fetch(query)
			return { first, cached, expired, second }
		})
		const result = await run(program)

		expect(result.first).toBe(1)
		expect(Option.getOrThrow(result.cached)).toBe(1)
		expect(Option.isNone(result.expired)).toBe(true)
		expect(result.second).toBe(2)
	})

	it("refetches through fetch after cache time expires", async () => {
		let calls = 0
		const query = Query.make({
			key: () => ["evicted"] as const,
			execute: () => Effect.sync(() => ++calls),
			cacheTime: "20 millis"
		})

		const program = Effect.gen(function* () {
			const first = yield* Query.fetch(query)
			yield* Effect.sleep("50 millis")
			const second = yield* Query.fetch(query)
			return [first, second] as const
		})

		expect(await run(program)).toEqual([1, 2])
	})

	it("reads keys with only a failed fetch as none", async () => {
		const query = Query.make({
			key: () => ["failed-read"] as const,
			execute: () => Effect.fail("nope" as const),
			// Far-future retention keeps the failed entry present so the read
			// goes through the empty-value path instead of expiry.
			cacheTime: 100 * 365 * 24 * 60 * 60 * 1000
		})

		const program = Effect.gen(function* () {
			yield* Effect.ignore(Query.fetch(query))
			return yield* Query.getData<string>(["failed-read"])
		})

		expect(Option.isNone(await run(program))).toBe(true)
	})
	it("treats invalidation of a missing key as a no-op", async () => {
		const query = Query.make({
			key: () => ["fresh-key"] as const,
			execute: () => Effect.succeed("ok")
		})

		const program = Effect.gen(function* () {
			yield* Query.invalidate(["missing"])
			return yield* Query.fetch(query)
		})

		expect(await run(program)).toBe("ok")
	})

	it("returns none when no cached value exists", async () => {
		expect(Option.isNone(await run(Query.getData<number>(["nothing"])))).toBe(true)
	})

	it("interrupting a fetch cancels the underlying request", async () => {
		let interrupted = false
		const query = Query.make({
			key: () => ["cancel"] as const,
			execute: () =>
				Effect.sleep("5 seconds").pipe(
					Effect.as("done"),
					Effect.onInterrupt(() => Effect.sync(() => { interrupted = true }))
				)
		})

		const program = Effect.gen(function* () {
			const fiber = yield* Effect.fork(Query.fetch(query))
			yield* Effect.sleep("20 millis")
			yield* Fiber.interrupt(fiber)
		})

		await run(program)
		expect(interrupted).toBe(true)
	})

	it("interrupting a joiner does not cancel the shared request", async () => {
		let calls = 0
		const query = Query.make({
			key: () => ["shared"] as const,
			execute: () => Effect.sleep("30 millis").pipe(Effect.map(() => ++calls))
		})

		const program = Effect.gen(function* () {
			const winner = yield* Effect.fork(Query.fetch(query))
			const joiner = yield* Effect.fork(Query.fetch(query))
			yield* Effect.sleep("10 millis")
			yield* Fiber.interrupt(joiner)
			return yield* Fiber.join(winner)
		})

		expect(await run(program)).toBe(1)
		expect(calls).toBe(1)
	})

	it("shares entries across key shapes with a custom hasher", async () => {
		let calls = 0
		const query = Query.make({
			key: (id: number, stamp: number) => ["user", id, stamp] as const,
			hash: (key) => `user:${key[1]}`,
			execute: (id: number) => Effect.sync(() => ({ id, call: ++calls })),
			staleTime: "1 minute"
		})

		const program = Effect.gen(function* () {
			const first = yield* Query.fetch(query, 1, 100)
			const second = yield* Query.fetch(query, 1, 200)
			return [first, second] as const
		})
		const [first, second] = await run(program)

		expect(first).toEqual({ id: 1, call: 1 })
		expect(second).toEqual({ id: 1, call: 1 })
		expect(calls).toBe(1)
	})

	it("fails typed when the default hasher cannot serialize the key", async () => {
		const query = Query.make({
			key: (id: bigint) => ["big", id] as const,
			execute: (id: bigint) => Effect.succeed(id)
		})

		const error = await Effect.runPromise(
			Effect.flip(Query.fetch(query, 1n).pipe(Effect.provide(queryLayer())))
		)

		expect(error).toBeInstanceOf(KeyHashError)
		expect(error._tag).toBe("KeyHashError")
	})

	it("fails typed on manual operations with unserializable keys", async () => {
		const error = await Effect.runPromise(
			Effect.flip(Query.getData<bigint>(["big", 1n]).pipe(Effect.provide(queryLayer())))
		)

		expect(error).toBeInstanceOf(KeyHashError)
	})

	it("revalidates focus-opted queries on focus", async () => {
		let focusedCalls = 0
		let plainCalls = 0
		const focused = Query.make({
			key: () => ["focused"] as const,
			execute: () => Effect.sync(() => ++focusedCalls),
			refetchOnFocus: true
		})
		const plain = Query.make({
			key: () => ["plain"] as const,
			execute: () => Effect.sync(() => ++plainCalls)
		})

		const program = Effect.gen(function* () {
			yield* Query.fetch(focused)
			yield* Query.fetch(plain)
			yield* Query.notifyFocus()
			let current = yield* Query.getData<number>(["focused"])
			for (let i = 0; i < 50 && !(Option.isSome(current) && current.value === 2); i++) {
				yield* Effect.sleep("10 millis")
				current = yield* Query.getData<number>(["focused"])
			}
			return current
		})
		const result = await run(program)

		expect(Option.getOrThrow(result)).toBe(2)
		expect(focusedCalls).toBe(2)
		expect(plainCalls).toBe(1)
	})

	it("revalidates reconnect-opted queries on reconnect", async () => {
		let calls = 0
		const query = Query.make({
			key: () => ["online"] as const,
			execute: () => Effect.sync(() => ++calls),
			refetchOnReconnect: true
		})

		const program = Effect.gen(function* () {
			yield* Query.fetch(query)
			yield* Query.notifyReconnect()
			let current = yield* Query.getData<number>(["online"])
			for (let i = 0; i < 50 && !(Option.isSome(current) && current.value === 2); i++) {
				yield* Effect.sleep("10 millis")
				current = yield* Query.getData<number>(["online"])
			}
			return current
		})

		expect(Option.getOrThrow(await run(program))).toBe(2)
		expect(calls).toBe(2)
	})

	it("treats notifications with no matching entries as no-ops", async () => {
		const program = Effect.gen(function* () {
			yield* Query.notifyFocus()
			yield* Query.notifyReconnect()
		})

		await expect(run(program)).resolves.toBeUndefined()
	})

	it("warms the cache without awaiting data", async () => {
		let calls = 0
		const query = Query.make({
			key: () => ["warm"] as const,
			execute: () => Effect.sleep("20 millis").pipe(Effect.map(() => ++calls)),
			staleTime: "1 minute"
		})

		const program = Effect.gen(function* () {
			yield* Query.prefetch(query)
			const immediate = yield* Query.getData<number>(["warm"])
			let cached = immediate
			for (let i = 0; i < 50 && Option.isNone(cached); i++) {
				yield* Effect.sleep("10 millis")
				cached = yield* Query.getData<number>(["warm"])
			}
			const value = yield* Query.fetch(query)
			return { immediate, cached, value }
		})
		const result = await run(program)

		expect(Option.isNone(result.immediate)).toBe(true)
		expect(Option.getOrThrow(result.cached)).toBe(1)
		expect(result.value).toBe(1)
		expect(calls).toBe(1)
	})

	it("cancelling in-flight interrupts the request and clears the slot", async () => {
		let interrupted = false
		const query = Query.make({
			key: () => ["cancelable"] as const,
			execute: () =>
				Effect.sleep("5 seconds").pipe(
					Effect.as("done"),
					Effect.onInterrupt(() => Effect.sync(() => { interrupted = true }))
				)
		})

		const program = Effect.gen(function* () {
			const fiber = yield* Effect.fork(Query.fetch(query))
			yield* Effect.sleep("20 millis")
			yield* Query.cancel(["cancelable"])
			const exit = yield* Fiber.await(fiber)
			const cached = yield* Query.getData<string>(["cancelable"])
			const retry = yield* Effect.fork(Query.fetch(query))
			yield* Effect.sleep("20 millis")
			yield* Query.cancel(["cancelable"])
			const retryExit = yield* Fiber.await(retry)
			return { exit, cached, retryExit }
		})
		const result = await run(program)

		expect(Exit.isInterrupted(result.exit)).toBe(true)
		expect(interrupted).toBe(true)
		expect(Option.isNone(result.cached)).toBe(true)
		expect(Exit.isInterrupted(result.retryExit)).toBe(true)
	})

	it("cancelling an idle or missing key is a no-op", async () => {
		const query = Query.make({
			key: () => ["idle"] as const,
			execute: () => Effect.succeed("ok"),
			staleTime: "1 minute"
		})

		const program = Effect.gen(function* () {
			yield* Query.cancel(["missing"])
			const value = yield* Query.fetch(query)
			yield* Query.cancel(["idle"])
			const cached = yield* Query.getData<string>(["idle"])
			return { value, cached }
		})
		const result = await run(program)

		expect(result.value).toBe("ok")
		expect(Option.getOrThrow(result.cached)).toBe("ok")
	})
})

describe("Mutation", () => {
	it("runs mutations without success handlers", async () => {
		const mutation = Mutation.make({
			execute: (id: number) => Effect.succeed(id * 2)
		})

		expect(await run(Mutation.execute(mutation, 21))).toBe(42)
	})

	it("propagates mutation failures without running success handlers", async () => {
		let handled = false
		const mutation = Mutation.make({
			execute: () => Effect.fail("denied" as const),
			onSuccess: () => Effect.sync(() => { handled = true })
		})

		const exit = await Effect.runPromiseExit(Mutation.execute(mutation).pipe(Effect.provide(queryLayer())))

		expect(exit).toEqual(Exit.fail("denied"))
		expect(handled).toBe(false)
	})
})
