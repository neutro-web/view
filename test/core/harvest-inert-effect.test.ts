/**
 * P-2c-A1 — Gate-P unit tests for harvestInertEffect / harvestInertChildren.
 * TC-A1-1: inert leaf effect harvested (node count drops by 1).
 * TC-A1-2: reactive leaf effect NOT harvested, still updates.
 * TC-A1-3: structural binding (firstChild !== null) not harvested.
 * TC-A1-TIMING: DIRTY effect skipped by sweep (condition 6).
 * TC-A1-CLEANUP: promoted cleanup fires on owner disposal.
 * TC-A1-DISPOSE: harvested node is isDisposed, not in owner child list.
 *
 * All DOM-free. Uses core primitives only.
 */
import { expect, test } from 'vitest'
import {
  __test,
  createRoot,
  effect,
  flushSync,
  getOwner,
  onCleanup,
  signal,
} from '../../src/core/core.js'
import { harvestInertChildren } from '../../src/core/index.js'

// Helper: count direct children of an owner scope.
// Owner is opaque from outside, but we can measure it behaviourally via
// getOwner() captured inside createRoot and compared against disposed scope.
// For structural inspection we use __test.childCount (added as part of this task — see Step 3).
function childCount(owner: ReturnType<typeof getOwner>): number {
  return __test.childCount(owner)
}

// ── TC-A1-1: inert leaf effect is harvested ───────────────────────────────────

test('TC-A1-1  inert leaf effect harvested — child count drops', () => {
  let owner: ReturnType<typeof getOwner> = null
  let beforeCount = 0
  let afterCount = 0

  createRoot((dispose) => {
    owner = getOwner()
    // One effect that reads no signal — inert after first flush.
    effect(() => {
      // reads nothing reactive
      void 'static'
    })
    flushSync()
    beforeCount = childCount(owner)

    harvestInertChildren(owner)

    afterCount = childCount(owner)
    dispose()
  })

  expect(beforeCount).toBe(1)
  expect(afterCount).toBe(0)
})

// ── TC-A1-2: reactive effect NOT harvested, still updates ────────────────────

test('TC-A1-2  reactive leaf effect not harvested, still updates', () => {
  const s = signal(0)
  let runs = 0
  let owner: ReturnType<typeof getOwner> = null

  const dispose = createRoot((d) => {
    owner = getOwner()
    effect(() => {
      s() // reactive read
      runs++
    })
    return d
  })

  flushSync()
  expect(runs).toBe(1)

  harvestInertChildren(owner)

  // Child still present (reactive → not harvested)
  expect(childCount(owner)).toBe(1)

  // Effect still live — signal change triggers re-run
  s.set(1)
  flushSync()
  expect(runs).toBe(2)

  dispose()
})

// ── TC-A1-3: structural binding (child scope) not harvested ──────────────────

test('TC-A1-3  nested createRoot (firstChild !== null) not harvested', () => {
  let owner: ReturnType<typeof getOwner> = null

  const dispose = createRoot((d) => {
    owner = getOwner()
    // A scope node with a child (simulates a nested each/conditional).
    createRoot(() => {
      effect(() => void 'inner static')
    })
    return d
  })

  flushSync()
  // Outer owns 1 child (the inner createRoot scope node), which itself owns 1 effect.
  expect(childCount(owner)).toBe(1)

  harvestInertChildren(owner)

  // The nested scope node has firstChild !== null → not harvested.
  expect(childCount(owner)).toBe(1)

  dispose()
})

// ── TC-A1-TIMING: DIRTY effect (not-yet-run) skipped ─────────────────────────

test('TC-A1-TIMING  DIRTY effect skipped by sweep; runs correctly after flush', () => {
  let ran = false
  let owner: ReturnType<typeof getOwner> = null
  let countAfterPrematureSweep = 0

  // Note: createRoot callback runs synchronously; assignments here are visible
  // to the outer scope by the time createRoot returns.
  const dispose = createRoot((d) => {
    owner = getOwner()
    effect(() => {
      ran = true
    })

    // Sweep BEFORE flushing — effect is DIRTY (condition 6 unmet → skipped).
    harvestInertChildren(owner)
    countAfterPrematureSweep = childCount(owner)

    return d
  })

  // Effect survived the premature sweep (still DIRTY at sweep time).
  expect(countAfterPrematureSweep).toBe(1)

  // Effect still runs correctly after flush.
  flushSync()
  expect(ran).toBe(true)

  dispose()
})

// ── TC-A1-CLEANUP: promoted cleanup fires on owner disposal ──────────────────
// Note: in current wire* bindings, all onCleanup calls are registered OUTSIDE
// the effect body (on the item root), so node.cleanups is null for all current
// effects and the promotion block is a no-op. This test validates the promotion
// code path for future-proofing — any effect that does register an internal
// onCleanup must have its cleanup survive harvest.

test('TC-A1-CLEANUP  promoted cleanup fires when owner is disposed', () => {
  let cleanupRan = false
  let owner: ReturnType<typeof getOwner> = null

  const dispose = createRoot((d) => {
    owner = getOwner()
    effect(() => {
      onCleanup(() => {
        cleanupRan = true
      })
      // reads nothing reactive — inert; onCleanup inside body registers on this effect node
    })
    return d
  })

  flushSync()
  harvestInertChildren(owner)

  // Cleanup not yet run (promoted to owner, not yet disposed).
  expect(cleanupRan).toBe(false)

  // Disposing the owner runs the promoted cleanup.
  dispose()
  expect(cleanupRan).toBe(true)
})

// ── TC-A1-DISPOSE: harvested node is isDisposed, off child list ──────────────

test('TC-A1-DISPOSE  harvested node: isDisposed, removed from owner child list, no double-cleanup on owner dispose', () => {
  let cleanupCount = 0
  let owner: ReturnType<typeof getOwner> = null

  const dispose = createRoot((d) => {
    owner = getOwner()
    effect(() => {
      onCleanup(() => {
        cleanupCount++
      })
    })
    return d
  })

  flushSync()
  harvestInertChildren(owner)

  expect(childCount(owner)).toBe(0) // removed from child list

  // Disposing the owner runs the promoted cleanup exactly once.
  dispose()
  expect(cleanupCount).toBe(1)

  // Second dispose is idempotent — no double run.
  dispose()
  expect(cleanupCount).toBe(1)
})
