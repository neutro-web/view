import { effect, getOwner, onCleanup, signal, untrack } from '../core/core.js'

/**
 * Read-only handle returned by `resource()`.
 *
 * - Call the accessor `r()` to read the latest resolved value (`undefined` while
 *   pending or before the first settle).
 * - `r.loading()` is `true` while a fetch is in-flight.
 * - `r.error()` holds the last rejection reason (or `undefined` on success).
 *
 * Note: `T | undefined` means "not yet resolved OR resolved to undefined".
 * Check `r.loading()` to distinguish the two.
 */
export interface Resource<T> {
  (): T | undefined
  loading: () => boolean
  error: () => unknown
}

// Private sentinel distinguishes "never resolved" from "resolved to undefined".
// Without this, signal<T | undefined>(undefined).set(undefined) is a no-op
// (Object.is equality) when T includes undefined, so a fetcher that legitimately
// resolves to `undefined` would silently not notify data subscribers.
// The sentinel sits outside T's range and makes the initial→resolved transition
// always observable regardless of T.
const UNSET: unique symbol = Symbol('nv.resource.unset')

/**
 * Async composition factory — PT-1a shape.
 *
 * Must be called inside a reactive scope (createRoot / component body / owner).
 * Throws immediately via getOwner() check if called outside a scope.
 *
 * Do NOT call inside a `derived()` callback or an `effect()` body — `derived`
 * re-runs and will dispose and re-create the internal effect on each evaluation;
 * `effect` bodies are valid owner contexts but the same disposal risk applies.
 * Always call at component / createRoot scope.
 *
 * Settle-writes use bare signal.set() — external-event category (promise
 * continuation runs outside any propagation, no currentObserver), no reactive
 * cycle possible, so nodeSet calls scheduleFlush() and downstream effects
 * re-run on a fresh propagation (§8.6 / commission spec §1).
 */
export function resource<S, T>(
  source: () => S,
  fetcher: (s: S, info: { signal: AbortSignal }) => Promise<T>,
): Resource<T> {
  if (getOwner() === null)
    throw new Error(
      '[nv] resource() must be called inside a reactive scope (createRoot, component body, or owner)',
    )

  const data = signal<T | typeof UNSET>(UNSET)
  const loading = signal<boolean>(false)
  const error = signal<unknown>(undefined)

  let epoch = 0

  effect(() => {
    // Bump epoch FIRST — before reading source() — so any prior in-flight fetch
    // becomes stale regardless of whether source() succeeds or throws. If epoch
    // were bumped after source(), a throwing source() would leave epoch unchanged
    // and a concurrent in-flight resolve could overwrite the error state.
    const gen = ++epoch

    let s: S
    try {
      s = source() // TRACKED — establishes fine-grained deps on source thunk
    } catch (e) {
      // Reactive source threw — surface as error state and stop.
      // Prior in-flight fetch (if any) is already stale (gen !== epoch after
      // the next run bumped it) or aborted (prior run's onCleanup fires first).
      error.set(e)
      loading.set(false)
      return
    }

    const ac = new AbortController()

    // Abort in-flight work on re-run (source changed) or on owner dispose.
    onCleanup(() => ac.abort())

    loading.set(true)
    error.set(undefined)

    // Wrap fetcher in untrack so any reactive reads the fetcher makes during
    // its synchronous setup phase do not become tracked dependencies of this
    // effect. Tracking is scoped to source() only, per spec intent.
    let p: Promise<T>
    try {
      p = untrack(() => fetcher(s, { signal: ac.signal }))
    } catch (e) {
      // Synchronous throw from fetcher — surface as error state.
      error.set(e)
      loading.set(false)
      return
    }

    p.then(
      (result) => {
        if (gen !== epoch) return // STALE: newer run superseded this one — drop
        data.set(result) // external→signal write (§1); schedules flush
        loading.set(false)
      },
      (e: unknown) => {
        if (gen !== epoch) return // STALE: drop
        // gen === epoch AND aborted means owner was disposed during this run
        // (a re-run would have bumped epoch). loading stuck at true is fine —
        // the owner is gone; no subscriber is alive to observe it.
        if (ac.signal.aborted) return
        error.set(e)
        // data intentionally NOT cleared — preserve last successful value (SWR semantics)
        loading.set(false)
      },
    )
  })

  const accessor = (() => {
    const v = data()
    return v === UNSET ? undefined : v
  }) as Resource<T>
  accessor.loading = () => loading()
  accessor.error = () => error()
  return accessor
}
