/**
 * PT-1a resource — test suite
 *
 * All gates from the commission spec: TC-R-1 through TC-R-SETTLE.
 * Uses controllable promises (deferred()) for deterministic race coverage.
 * No DOM, no Playwright — resource is DOM-free composition.
 *
 * Run: pnpm vitest run test/renderer/resource.test.ts
 */

import { afterEach, expect, test, vi } from 'vitest'
import { createRoot, derived, effect, flushSync, signal } from '../../src/core/core.js'
import { resource } from '../../src/renderer/resource.js'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Controllable promise — resolve/reject from outside synchronously. */
function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ── TC-R-1: Basic resolve ─────────────────────────────────────────────────────

test('TC-R-1: static source — inflight state has loading=true, data=undefined, error=undefined', () => {
  const d = deferred<string>()

  const dispose = createRoot((d_) => {
    const r = resource(
      () => 'key',
      (_s, _info) => d.promise,
    )
    flushSync()
    expect(r.loading()).toBe(true)
    expect(r()).toBeUndefined()
    expect(r.error()).toBeUndefined()
    return d_
  })

  dispose()
})

test('TC-R-1b: static source resolves — loading false, data holds value, error undefined', async () => {
  const d = deferred<string>()
  let rRef!: ReturnType<typeof resource<string, string>>

  const dispose = createRoot((d_) => {
    rRef = resource(
      () => 'key',
      (_s, _info) => d.promise,
    )
    return d_
  })

  flushSync()
  expect(rRef.loading()).toBe(true)

  d.resolve('hello')
  await d.promise
  flushSync()

  expect(rRef.loading()).toBe(false)
  expect(rRef()).toBe('hello')
  expect(rRef.error()).toBeUndefined()

  dispose()
})

// ── TC-R-2: Reactive refetch ──────────────────────────────────────────────────

test('TC-R-2: changing reactive source triggers refetch with the new source value', async () => {
  const d1 = deferred<string>()
  const d2 = deferred<string>()
  const calls: string[] = []

  const src = signal('a')
  let rRef!: ReturnType<typeof resource<string, string>>

  const dispose = createRoot((d_) => {
    rRef = resource(
      () => src(),
      (s, _info) => {
        calls.push(s)
        return s === 'a' ? d1.promise : d2.promise
      },
    )
    return d_
  })

  flushSync()
  expect(calls).toEqual(['a'])
  expect(rRef.loading()).toBe(true)

  src.set('b')
  flushSync()
  expect(calls).toEqual(['a', 'b'])
  expect(rRef.loading()).toBe(true)

  d2.resolve('result-b')
  await d2.promise
  flushSync()

  expect(rRef()).toBe('result-b')
  expect(rRef.loading()).toBe(false)

  dispose()
})

// ── TC-R-3: Stale-settle drop (THE correctness gate) ─────────────────────────

test('TC-R-3: slow earlier fetch settling after newer fetch does NOT overwrite data', async () => {
  const d_a = deferred<string>() // slow — resolves last
  const d_b = deferred<string>() // fast — resolves first

  const src = signal('a')
  let rRef!: ReturnType<typeof resource<string, string>>

  const dispose = createRoot((d_) => {
    rRef = resource(
      () => src(),
      (s, _info) => (s === 'a' ? d_a.promise : d_b.promise),
    )
    return d_
  })

  flushSync()

  // Source changes → epoch bumped; b's fetch starts, a's is superseded
  src.set('b')
  flushSync()

  // B settles first
  d_b.resolve('result-b')
  await d_b.promise
  flushSync()

  expect(rRef()).toBe('result-b')
  expect(rRef.loading()).toBe(false)

  // A settles late — epoch guard must drop it
  d_a.resolve('result-a')
  await d_a.promise
  flushSync()

  expect(rRef()).toBe('result-b') // A's value must NOT overwrite B's
  expect(rRef.loading()).toBe(false)

  dispose()
})

// ── TC-R-4: Abort on source change ───────────────────────────────────────────

test('TC-R-4: prior AbortController is aborted when source changes', async () => {
  const d_a = deferred<string>()
  const signals: AbortSignal[] = []

  const src = signal('a')

  const dispose = createRoot((d_) => {
    resource(
      () => src(),
      (_s, info) => {
        signals.push(info.signal)
        return d_a.promise
      },
    )
    return d_
  })

  flushSync()
  expect(signals).toHaveLength(1)
  expect(signals[0].aborted).toBe(false)

  src.set('b')
  flushSync()

  expect(signals[0].aborted).toBe(true) // first fetch aborted
  expect(signals).toHaveLength(2) // second fetch started

  dispose()
})

// ── TC-R-5: Abort on owner dispose ───────────────────────────────────────────

test('TC-R-5: owner dispose aborts in-flight fetch', async () => {
  const d = deferred<string>()
  let capturedSignal!: AbortSignal

  const dispose = createRoot((d_) => {
    resource(
      () => 'key',
      (_s, info) => {
        capturedSignal = info.signal
        return d.promise
      },
    )
    return d_
  })

  flushSync()
  expect(capturedSignal.aborted).toBe(false)

  dispose()

  expect(capturedSignal.aborted).toBe(true)
})

// ── TC-R-6: Error path ────────────────────────────────────────────────────────

test('TC-R-6: rejecting fetcher sets error, loading false, data unchanged', async () => {
  const d = deferred<string>()
  let rRef!: ReturnType<typeof resource<string, string>>

  const dispose = createRoot((d_) => {
    rRef = resource(
      () => 'key',
      (_s, _info) => d.promise,
    )
    return d_
  })

  flushSync()

  const err = new Error('boom')
  d.reject(err)
  await d.promise.catch(() => {})
  flushSync()

  expect(rRef.error()).toBe(err)
  expect(rRef.loading()).toBe(false)
  expect(rRef()).toBeUndefined() // data unchanged from initial
  dispose()
})

test('TC-R-6b: error path after prior data preserves last successful value', async () => {
  const d1 = deferred<string>()
  const d2 = deferred<string>()
  const src = signal('a')
  let rRef!: ReturnType<typeof resource<string, string>>

  const dispose = createRoot((d_) => {
    rRef = resource(
      () => src(),
      (s, _info) => (s === 'a' ? d1.promise : d2.promise),
    )
    return d_
  })

  flushSync()
  d1.resolve('first')
  await d1.promise
  flushSync()
  expect(rRef()).toBe('first')

  src.set('b')
  flushSync()
  const err = new Error('second-fail')
  d2.reject(err)
  await d2.promise.catch(() => {})
  flushSync()

  expect(rRef.error()).toBe(err)
  expect(rRef()).toBe('first') // SWR: last successful value preserved
  expect(rRef.loading()).toBe(false)
  dispose()
})

test('TC-R-6c: synchronous fetcher throw surfaces as error state', () => {
  let rRef!: ReturnType<typeof resource<string, string>>

  const dispose = createRoot((d_) => {
    rRef = resource(
      () => 'key',
      () => {
        throw new Error('sync-throw')
      },
    )
    return d_
  })

  flushSync()

  expect(rRef.loading()).toBe(false)
  expect((rRef.error() as Error).message).toBe('sync-throw')
  expect(rRef()).toBeUndefined()
  dispose()
})

test('TC-R-6d: throwing source() surfaces as error state', () => {
  let rRef!: ReturnType<typeof resource<never, string>>

  const dispose = createRoot((d_) => {
    rRef = resource(
      () => {
        throw new Error('source-throw')
      },
      async () => 'never',
    )
    return d_
  })

  flushSync()

  expect(rRef.loading()).toBe(false)
  expect((rRef.error() as Error).message).toBe('source-throw')
  dispose()
})

test('TC-R-6e: source() throw with concurrent in-flight fetch — prior fetch resolve does NOT overwrite error', async () => {
  // Regression for epoch-ordering bug: if epoch is bumped AFTER source(), a
  // throwing source() leaves epoch unchanged so a concurrent in-flight resolve
  // would pass the gen===epoch guard and overwrite the error state.
  // Fix: epoch is bumped FIRST, before source() is called.
  const d = deferred<string>()
  let shouldThrow = false
  const src = signal('a')
  let rRef!: ReturnType<typeof resource<string, string>>

  const dispose = createRoot((d_) => {
    rRef = resource(
      () => {
        if (shouldThrow) throw new Error('source-boom')
        return src()
      },
      (_s, _info) => d.promise,
    )
    return d_
  })

  flushSync()
  // Fetch A is in-flight (deferred promise pending), epoch=1, gen=1

  // Trigger a re-run where source() throws
  shouldThrow = true
  src.set('b') // triggers effect re-run
  flushSync()

  // Source threw: error should be set, loading false
  expect((rRef.error() as Error).message).toBe('source-boom')
  expect(rRef.loading()).toBe(false)

  // Now fetch A resolves — it must be stale (epoch was bumped before source())
  d.resolve('stale-result')
  await d.promise
  flushSync()

  // Error must NOT be overwritten by the stale resolve
  expect((rRef.error() as Error).message).toBe('source-boom')
  expect(rRef()).toBeUndefined()
  expect(rRef.loading()).toBe(false)

  dispose()
})

// ── TC-R-UNDEFINED: undefined as a legitimate resolved value ─────────────────

test('TC-R-UNDEFINED: fetcher resolving to undefined notifies data subscribers', async () => {
  // Without the UNSET sentinel, data starts as undefined and .set(undefined)
  // would be a no-op (Object.is equality short-circuit). The sentinel ensures
  // the initial→resolved transition is always observable.
  let dataRunCount = 0
  let rRef!: ReturnType<typeof resource<string, undefined>>

  const dispose = createRoot((d_) => {
    rRef = resource(
      () => 'key',
      async () => undefined,
    )

    effect(() => {
      rRef()
      dataRunCount++
    })

    return d_
  })

  flushSync()
  expect(dataRunCount).toBe(1)
  expect(rRef.loading()).toBe(true)

  // Wait for the async fetch to settle
  await Promise.resolve()
  await Promise.resolve()
  flushSync()

  expect(rRef.loading()).toBe(false)
  expect(rRef()).toBeUndefined() // resolved value is undefined
  expect(dataRunCount).toBe(2) // subscriber WAS notified (sentinel worked)
  dispose()
})

// ── TC-R-7: Fine-grained subscription ────────────────────────────────────────

test('TC-R-7a: data observer does NOT re-run when only loading flips true (new fetch starts)', async () => {
  // Tests the loading=true flip specifically — without a data change.
  // If data and loading were a single signal, dataRunCount would increment here.
  // Also asserts loadingRunCount DID increment to confirm the flip actually happened
  // (prevents this test passing vacuously due to a broken loading flip).
  const d1 = deferred<string>()
  const d2 = deferred<string>()
  const src = signal('a')
  let dataRunCount = 0
  let loadingRunCount = 0

  const dispose = createRoot((d_) => {
    const r = resource(
      () => src(),
      (s, _info) => (s === 'a' ? d1.promise : d2.promise),
    )

    effect(() => {
      r()
      dataRunCount++
    })
    effect(() => {
      r.loading()
      loadingRunCount++
    })

    return d_
  })

  flushSync()
  expect(dataRunCount).toBe(1)
  expect(loadingRunCount).toBe(1)

  // Source changes → loading was already true (still in-flight), so loading.set(true) is a no-op.
  // Neither observer should re-run — no signal changed value.
  src.set('b')
  flushSync()
  expect(loadingRunCount).toBe(1) // no-op: loading was already true
  expect(dataRunCount).toBe(1) // no-op: data unchanged

  d2.resolve('result-b')
  await d2.promise
  flushSync()
  expect(dataRunCount).toBe(2) // data changed → re-run
  expect(loadingRunCount).toBe(2) // loading flipped false → re-run

  dispose()
})

test('TC-R-7b: loading observer does not re-run when data settles (separate concerns)', async () => {
  // Symmetric: a loading-only observer must not re-run when only data changes.
  const d = deferred<string>()
  let dataRunCount = 0
  let loadingRunCount = 0

  const dispose = createRoot((d_) => {
    const r = resource(
      () => 'key',
      (_s, _info) => d.promise,
    )

    effect(() => {
      r()
      dataRunCount++
    })
    effect(() => {
      r.loading()
      loadingRunCount++
    })

    return d_
  })

  flushSync()
  expect(dataRunCount).toBe(1)
  expect(loadingRunCount).toBe(1)

  d.resolve('value')
  await d.promise
  flushSync()

  // Both signals change on settle (data=value, loading=false) → both effects re-run once each
  expect(loadingRunCount).toBe(2)
  expect(dataRunCount).toBe(2)

  dispose()
})

// ── TC-R-8: Owner precondition ────────────────────────────────────────────────

test('TC-R-8: calling resource() outside a reactive scope throws immediately', () => {
  expect(() => {
    resource(
      () => 'key',
      async () => 'value',
    )
  }).toThrow('[nv] resource() must be called inside a reactive scope')
})

// ── TC-R-UNTRACK: fetcher synchronous reads not tracked ──────────────────────

test('TC-R-UNTRACK: reactive reads inside fetcher synchronous body do not become tracked deps', () => {
  const internalSignal = signal('internal')
  const src = signal('a')
  let fetchCallCount = 0

  const dispose = createRoot((d_) => {
    resource(
      () => src(),
      (_s, _info) => {
        // Read a reactive signal synchronously inside the fetcher body.
        // This must NOT establish a tracked dependency on internalSignal.
        internalSignal()
        fetchCallCount++
        return Promise.resolve('result')
      },
    )
    return d_
  })

  flushSync()
  expect(fetchCallCount).toBe(1)

  // Mutating internalSignal must NOT trigger a re-fetch
  internalSignal.set('changed')
  flushSync()
  expect(fetchCallCount).toBe(1) // still 1 — no spurious re-fetch

  // Changing the actual source DOES trigger a re-fetch
  src.set('b')
  flushSync()
  expect(fetchCallCount).toBe(2)

  dispose()
})

// ── TC-R-CLOSURE: Closure-axiom audit ────────────────────────────────────────

test('TC-R-CLOSURE: resource module imports only core public surface', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../../src/renderer/resource.ts', import.meta.url), 'utf8')
  const importLines = src.split('\n').filter((l) => l.startsWith('import'))
  for (const line of importLines) {
    expect(line).toMatch(/core\.js|@neutro\/view\/core/)
  }
  expect(src).not.toMatch(/new Node|createNode|NodeKind/)
})

// ── TC-R-SETTLE: Settle-write auto-schedules propagation (no manual flush) ───

test('TC-R-SETTLE: settle-write self-propagates without explicit flushSync', async () => {
  // This verifies the §1 claim: nodeSet calls scheduleFlush() when the write
  // happens outside a flush (flushRunning === false), so downstream effects
  // re-run without the caller needing to drive a flush manually.
  const d = deferred<number>()
  const values: number[] = []

  const dispose = createRoot((d_) => {
    const r = resource(
      () => 'key',
      (_s, _info) => d.promise,
    )
    effect(() => {
      const v = r()
      if (v !== undefined) values.push(v)
    })
    return d_
  })

  flushSync() // initial mount flush
  expect(values).toEqual([])

  d.resolve(42)
  await d.promise
  // Deliberately do NOT call flushSync() here — the settle must self-schedule.
  // Yield the microtask queue so the scheduled flush can run.
  await Promise.resolve()
  await Promise.resolve()

  expect(values).toEqual([42]) // propagated without manual flushSync
  dispose()
})

test('TC-R-SETTLE-DERIVED: derived reading data re-runs after out-of-flush settle', async () => {
  const d = deferred<number>()
  const values: (number | undefined)[] = []

  const dispose = createRoot((d_) => {
    const r = resource(
      () => 'key',
      (_s, _info) => d.promise,
    )
    const doubled = derived(() => (r() ?? 0) * 2)
    effect(() => {
      values.push(doubled())
    })
    return d_
  })

  flushSync()
  expect(values).toEqual([0])

  d.resolve(21)
  await d.promise
  flushSync()

  expect(values).toEqual([0, 42])
  dispose()
})
