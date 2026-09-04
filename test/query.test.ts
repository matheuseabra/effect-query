import { Fiber, Effect, Option, Schedule } from "effect"
import { describe, expect, it } from "vitest"
import { Mutation, Query, queryLayer, type QueryServiceShape } from "../src/index.js"

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
})
