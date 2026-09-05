import { Context, Data, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Schedule } from "effect"

export type QueryKey = readonly unknown[]
export type QueryArgs = readonly unknown[]

export class KeyHashError extends Data.TaggedError("KeyHashError")<{
	readonly key: unknown
	readonly reason: unknown
}> {}

export interface RetryPolicy<E> {
	readonly times?: number
	readonly schedule?: Schedule.Schedule<any, E, any>
}

export interface QueryOptions<Args extends QueryArgs, A, E, R, Key extends QueryKey> {
	readonly key: (...args: Args) => Key
	readonly execute: (...args: Args) => Effect.Effect<A, E, R>
	readonly hash?: (key: Key) => string
	readonly staleTime?: Duration.DurationInput
	readonly cacheTime?: Duration.DurationInput
	readonly retry?: RetryPolicy<E>
	readonly refetchOnFocus?: boolean
	readonly refetchOnReconnect?: boolean
}

export interface QueryDefinition<Args extends QueryArgs, A, E, R, Key extends QueryKey> {
	readonly key: (...args: Args) => Key
	readonly execute: (...args: Args) => Effect.Effect<A, E, R>
	readonly hash?: (key: Key) => string
	readonly staleTime: Duration.DurationInput
	readonly cacheTime: Duration.DurationInput
	readonly retry?: RetryPolicy<E>
	readonly refetchOnFocus?: boolean
	readonly refetchOnReconnect?: boolean
}

export interface MutationDefinition<Args extends QueryArgs, A, E, R, E2 = never> {
	readonly execute: (...args: Args) => Effect.Effect<A, E, R>
	readonly onSuccess?: (value: A) => Effect.Effect<void, E2, QueryService>
}

export interface QueryService {
	readonly fetch: <Args extends QueryArgs, A, E, R, Key extends QueryKey>(
		query: QueryDefinition<Args, A, E, R, Key>,
		args: Args
	) => Effect.Effect<A, E | KeyHashError, R>
	readonly prefetch: <Args extends QueryArgs, A, E, R, Key extends QueryKey>(
		query: QueryDefinition<Args, A, E, R, Key>,
		args: Args
	) => Effect.Effect<void, never, R>
	readonly invalidate: (key: QueryKey) => Effect.Effect<void, KeyHashError>
	readonly cancel: (key: QueryKey) => Effect.Effect<void, KeyHashError>
	readonly setData: <A>(key: QueryKey, value: A) => Effect.Effect<void, KeyHashError>
	readonly getData: <A>(key: QueryKey) => Effect.Effect<Option.Option<A>, KeyHashError>
	readonly notifyFocus: Effect.Effect<void>
	readonly notifyReconnect: Effect.Effect<void>
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
	inFlightFiber: Fiber.RuntimeFiber<unknown, unknown> | undefined
	refetchOnFocus: boolean
	refetchOnReconnect: boolean
	// Requirements are erased: trigger revalidation only has QueryService in
	// scope, so queries needing more fail silently in the background daemon
	// without touching the cached entry.
	revalidate: Effect.Effect<unknown, unknown, never> | undefined
}

const defaultKeyHash = (key: QueryKey): string => JSON.stringify(key)

const hashKey = <Key extends QueryKey>(
	key: Key,
	hash: ((key: Key) => string) | undefined
): Effect.Effect<string, KeyHashError> =>
	Effect.try({
		try: () => (hash ?? defaultKeyHash)(key),
		catch: (reason) => new KeyHashError({ key, reason })
	})

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
// the request in a supervised child fiber, so interrupting the winner cancels
// the underlying request, and `cancel` can interrupt it by key. Concurrent
// callers (joiners) await a Deferred instead, so interrupting a joiner only
// cancels its own wait. The winner always funnels the outcome through the
// Deferred, so joiners never hang. Failures complete the Deferred without
// caching, letting the next fetch retry from scratch.
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
			const child = yield* Effect.fork(
				restore(
					Effect.exit(withRetry(execute, policy)).pipe(
						Effect.flatMap((exit) =>
							Effect.uninterruptible(
								Effect.as(
									Effect.zipRight(
										Effect.sync(() => {
											entry.inFlight = undefined
											entry.inFlightFiber = undefined
											if (Exit.isSuccess(exit)) {
												entry.hasValue = true
												entry.value = exit.value
												entry.updatedAt = Date.now()
											}
										}),
										Deferred.done(deferred, exit)
									),
									exit
								)
							)
						)
					)
				)
			)
			entry.inFlightFiber = child
			const exit = yield* restore(Fiber.join(child))
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
			inFlight: undefined,
			inFlightFiber: undefined,
			refetchOnFocus: false,
			refetchOnReconnect: false,
			revalidate: undefined
		}
		entries.set(hash, entry)
		return entry
	}

	const fetch = <Args extends QueryArgs, A, E, R, Key extends QueryKey>(
		query: QueryDefinition<Args, A, E, R, Key>,
		args: Args
	): Effect.Effect<A, E | KeyHashError, R> =>
		Effect.gen(function* () {
			const key = query.key(...args)
			const hash = yield* hashKey(key, query.hash)
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
			entry.refetchOnFocus = query.refetchOnFocus ?? false
			entry.refetchOnReconnect = query.refetchOnReconnect ?? false
			entry.revalidate = runFresh(
				entry,
				query.execute(...args),
				query.retry
			) as unknown as Effect.Effect<unknown, unknown, never>

			if (isFresh(entry, now)) return entry.value as A
			if (entry.hasValue) {
				yield* Effect.forkDaemon(
					Effect.ignore(runFresh(entry, query.execute(...args), query.retry))
				)
				return entry.value as A
			}
			return yield* runFresh(entry, query.execute(...args), query.retry)
		})

	const notify = (flag: "refetchOnFocus" | "refetchOnReconnect"): Effect.Effect<void> =>
		Effect.forEach(
			entries.values(),
			(entry) =>
				entry[flag] && entry.revalidate !== undefined
					? Effect.asVoid(Effect.forkDaemon(Effect.ignore(entry.revalidate)))
					: Effect.void,
			{ discard: true }
		)

	return {
		fetch,
		prefetch: (query, args) =>
			Effect.asVoid(Effect.forkDaemon(Effect.ignore(fetch(query, args)))),
		invalidate: (key) =>
			Effect.gen(function* () {
				entries.delete(yield* hashKey(key, undefined))
			}),
		cancel: (key) =>
			Effect.gen(function* () {
				const fiber = entries.get(yield* hashKey(key, undefined))?.inFlightFiber
				if (fiber !== undefined) yield* Effect.asVoid(Fiber.interrupt(fiber))
			}),
		setData: (key, value) =>
			Effect.gen(function* () {
				const entry = getOrCreateEntry(
					yield* hashKey(key, undefined),
					DEFAULT_STALE_TIME,
					toMillis(DEFAULT_CACHE_TIME, 0)
				)
				entry.hasValue = true
				entry.value = value
				entry.updatedAt = Date.now()
			}),
		getData: <A>(key: QueryKey) =>
			Effect.gen(function* () {
				const hash = yield* hashKey(key, undefined)
				const entry = entries.get(hash)
				if (entry === undefined) return Option.none<A>()
				if (isExpired(entry, Date.now())) {
					entries.delete(hash)
					return Option.none<A>()
				}
				return entry.hasValue ? Option.some(entry.value as A) : Option.none<A>()
			}),
		notifyFocus: notify("refetchOnFocus"),
		notifyReconnect: notify("refetchOnReconnect")
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
): Effect.Effect<A, E | KeyHashError, R | QueryService> =>
	Effect.flatMap(QueryService, (service) => service.fetch(query, args))

const mutationMake = <Args extends QueryArgs, A, E, R, E2 = never>(
	definition: MutationDefinition<Args, A, E, R, E2>
): MutationDefinition<Args, A, E, R, E2> => definition

const mutationExecute = <Args extends QueryArgs, A, E, R, E2>(
	mutation: MutationDefinition<Args, A, E, R, E2>,
	...args: Args
): Effect.Effect<A, E | E2, R | QueryService> =>
	Effect.gen(function* () {
		const value = yield* mutation.execute(...args)
		if (mutation.onSuccess !== undefined) yield* mutation.onSuccess(value)
		return value
	})

export const Query = {
	make: queryMake,
	fetch: queryFetch,
	prefetch: <Args extends QueryArgs, A, E, R, Key extends QueryKey>(
		query: QueryDefinition<Args, A, E, R, Key>,
		...args: Args
	): Effect.Effect<void, never, R | QueryService> =>
		Effect.flatMap(QueryService, (service) => service.prefetch(query, args)),
	invalidate: (key: QueryKey): Effect.Effect<void, KeyHashError, QueryService> =>
		Effect.flatMap(QueryService, (service) => service.invalidate(key)),
	cancel: (key: QueryKey): Effect.Effect<void, KeyHashError, QueryService> =>
		Effect.flatMap(QueryService, (service) => service.cancel(key)),
	setData: <A>(key: QueryKey, value: A): Effect.Effect<void, KeyHashError, QueryService> =>
		Effect.flatMap(QueryService, (service) => service.setData(key, value)),
	getData: <A>(key: QueryKey): Effect.Effect<Option.Option<A>, KeyHashError, QueryService> =>
		Effect.flatMap(QueryService, (service) => service.getData<A>(key)),
	notifyFocus: (): Effect.Effect<void, never, QueryService> =>
		Effect.flatMap(QueryService, (service) => service.notifyFocus),
	notifyReconnect: (): Effect.Effect<void, never, QueryService> =>
		Effect.flatMap(QueryService, (service) => service.notifyReconnect)
}

export const Mutation = {
	make: mutationMake,
	execute: mutationExecute
}
