import { Context, Deferred, Duration, Effect, Exit, Layer, Option, Schedule } from "effect"

export type QueryKey = readonly unknown[]
export type QueryArgs = readonly unknown[]

export interface RetryPolicy<E> {
	readonly times?: number
	readonly schedule?: Schedule.Schedule<any, E, any>
}

export interface QueryOptions<Args extends QueryArgs, A, E, R, Key extends QueryKey> {
	readonly key: (...args: Args) => Key
	readonly execute: (...args: Args) => Effect.Effect<A, E, R>
	readonly staleTime?: Duration.DurationInput
	readonly cacheTime?: Duration.DurationInput
	readonly retry?: RetryPolicy<E>
	readonly refetchOnFocus?: boolean
	readonly refetchOnReconnect?: boolean
}

export interface QueryDefinition<Args extends QueryArgs, A, E, R, Key extends QueryKey> {
	readonly key: (...args: Args) => Key
	readonly execute: (...args: Args) => Effect.Effect<A, E, R>
	readonly staleTime: Duration.DurationInput
	readonly cacheTime: Duration.DurationInput
	readonly retry?: RetryPolicy<E>
	readonly refetchOnFocus?: boolean
	readonly refetchOnReconnect?: boolean
}

export interface MutationDefinition<Args extends QueryArgs, A, E, R> {
	readonly execute: (...args: Args) => Effect.Effect<A, E, R>
	readonly onSuccess?: (value: A) => Effect.Effect<void, never, QueryService>
}

export interface QueryService {
	readonly fetch: <Args extends QueryArgs, A, E, R, Key extends QueryKey>(
		query: QueryDefinition<Args, A, E, R, Key>,
		args: Args
	) => Effect.Effect<A, E, R>
	readonly invalidate: (key: QueryKey) => Effect.Effect<void>
	readonly setData: <A>(key: QueryKey, value: A) => Effect.Effect<void>
	readonly getData: <A>(key: QueryKey) => Effect.Effect<Option.Option<A>>
}

export const QueryService = Context.GenericTag<QueryService>(
	"effect-query/QueryService"
)

const DEFAULT_CACHE_TIME = "5 minutes" as const
const DEFAULT_STALE_TIME = 0

interface CacheEntry {
	hasValue: boolean
	value: unknown
	updatedAt: number
	staleTimeMs: number
	cacheTimeMs: number
	inFlight: Effect.Effect<unknown, unknown, unknown> | undefined
}

const keyHash = (key: QueryKey): string => JSON.stringify(key)

const toMillis = (input: Duration.DurationInput | undefined, fallback: Duration.DurationInput): number =>
	Duration.toMillis(input ?? fallback)

const isExpired = (entry: CacheEntry, now: number): boolean =>
	entry.hasValue && now - entry.updatedAt >= entry.cacheTimeMs

const isFresh = (entry: CacheEntry, now: number): boolean =>
	entry.hasValue && now - entry.updatedAt < entry.staleTimeMs

const withRetry = <A, E, R>(effect: Effect.Effect<A, E, R>, policy: RetryPolicy<E> | undefined) => {
	if (policy === undefined) return effect
	return Effect.retry(effect, policy)
}

// Single-flight execution for one cache key. The first caller (winner) runs
// the effect in its own fiber, so interrupting the winner cancels the
// underlying request. Concurrent callers (joiners) await a Deferred instead,
// so interrupting a joiner only cancels its own wait. Failures complete the
// Deferred without caching, letting the next fetch retry from scratch.
const runFresh = <A, E, R>(
	entry: CacheEntry,
	execute: Effect.Effect<A, E, R>,
	policy: RetryPolicy<E> | undefined
): Effect.Effect<A, E, R> =>
	Effect.uninterruptibleMask((restore) =>
		Effect.gen(function* () {
			const existing = entry.inFlight
			if (existing !== undefined) {
				return yield* restore(existing as Effect.Effect<A, E, R>)
			}
			const deferred = yield* Deferred.make<A, E>()
			entry.inFlight = Deferred.await(deferred)
			const exit = yield* restore(Effect.exit(withRetry(execute, policy)))
			if (Exit.isSuccess(exit)) {
				entry.hasValue = true
				entry.value = exit.value
				entry.updatedAt = Date.now()
			}
			entry.inFlight = undefined
			yield* Deferred.done(deferred, exit)
			return yield* restore(exit)
		})
	)

const makeService = (): QueryService => {
	const entries = new Map<string, CacheEntry>()

	const removeExpired = (hash: string, entry: CacheEntry, now: number): void => {
		if (isExpired(entry, now)) entries.delete(hash)
	}

	const getOrCreateEntry = (
		hash: string,
		staleTimeMs: number,
		cacheTimeMs: number
	): CacheEntry => {
		const current = entries.get(hash)
		if (current !== undefined) return current
		const entry: CacheEntry = {
			hasValue: false,
			value: undefined,
			updatedAt: 0,
			staleTimeMs,
			cacheTimeMs,
			inFlight: undefined
		}
		entries.set(hash, entry)
		return entry
	}

	const fetch = <Args extends QueryArgs, A, E, R, Key extends QueryKey>(
		query: QueryDefinition<Args, A, E, R, Key>,
		args: Args
	): Effect.Effect<A, E, R> =>
		Effect.gen(function* () {
			const hash = keyHash(query.key(...args))
			const now = Date.now()
			const existing = entries.get(hash)
			if (existing !== undefined) removeExpired(hash, existing, now)
			const entry = getOrCreateEntry(
				hash,
				toMillis(query.staleTime, DEFAULT_STALE_TIME),
				toMillis(query.cacheTime, DEFAULT_CACHE_TIME)
			)
			entry.staleTimeMs = toMillis(query.staleTime, DEFAULT_STALE_TIME)
			entry.cacheTimeMs = toMillis(query.cacheTime, DEFAULT_CACHE_TIME)

			if (isFresh(entry, now)) return entry.value as A
			if (entry.hasValue) {
				yield* Effect.forkDaemon(
					Effect.ignore(runFresh(entry, query.execute(...args), query.retry))
				)
				return entry.value as A
			}
			return yield* runFresh(entry, query.execute(...args), query.retry)
		})

	return {
		fetch,
		invalidate: (key) =>
			Effect.sync(() => {
				entries.delete(keyHash(key))
			}),
		setData: (key, value) =>
			Effect.sync(() => {
				const entry = getOrCreateEntry(keyHash(key), DEFAULT_STALE_TIME, toMillis(DEFAULT_CACHE_TIME, 0))
				entry.hasValue = true
				entry.value = value
				entry.updatedAt = Date.now()
			}),
		getData: <A>(key: QueryKey) =>
			Effect.sync(() => {
				const hash = keyHash(key)
				const entry = entries.get(hash)
				if (entry === undefined) return Option.none<A>()
				if (isExpired(entry, Date.now())) {
					entries.delete(hash)
					return Option.none<A>()
				}
				return entry.hasValue ? Option.some(entry.value as A) : Option.none<A>()
			})
	}
}

export const queryLayer = (): Layer.Layer<QueryService> => Layer.sync(QueryService, makeService)

const queryMake = <Args extends QueryArgs, A, E, R, Key extends QueryKey>(
	options: QueryOptions<Args, A, E, R, Key>
): QueryDefinition<Args, A, E, R, Key> => ({
	...options,
	staleTime: options.staleTime ?? DEFAULT_STALE_TIME,
	cacheTime: options.cacheTime ?? DEFAULT_CACHE_TIME
})

const queryFetch = <Args extends QueryArgs, A, E, R, Key extends QueryKey>(
	query: QueryDefinition<Args, A, E, R, Key>,
	...args: Args
): Effect.Effect<A, E, R | QueryService> =>
	Effect.flatMap(QueryService, (service) => service.fetch(query, args))

const mutationMake = <Args extends QueryArgs, A, E, R>(
	definition: MutationDefinition<Args, A, E, R>
): MutationDefinition<Args, A, E, R> => definition

const mutationExecute = <Args extends QueryArgs, A, E, R>(
	mutation: MutationDefinition<Args, A, E, R>,
	...args: Args
): Effect.Effect<A, E, R | QueryService> =>
	Effect.gen(function* () {
		const value = yield* mutation.execute(...args)
		if (mutation.onSuccess !== undefined) yield* mutation.onSuccess(value)
		return value
	})

export const Query = {
	make: queryMake,
	fetch: queryFetch,
	invalidate: (key: QueryKey): Effect.Effect<void, never, QueryService> =>
		Effect.flatMap(QueryService, (service) => service.invalidate(key)),
	setData: <A>(key: QueryKey, value: A): Effect.Effect<void, never, QueryService> =>
		Effect.flatMap(QueryService, (service) => service.setData(key, value)),
	getData: <A>(key: QueryKey): Effect.Effect<Option.Option<A>, never, QueryService> =>
		Effect.flatMap(QueryService, (service) => service.getData<A>(key))
}

export const Mutation = {
	make: mutationMake,
	execute: mutationExecute
}
