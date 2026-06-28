/**
 * P-2c-B ceiling probe — harvest counter Gate-P tests.
 *
 * TC-P2CB-COUNTER-INERT   : inert effect harvested → counter increments.
 * TC-P2CB-COUNTER-REACTIVE: reactive effect NOT harvested → counter stays 0.
 * TC-P2CB-COUNTER-RESET   : resetHarvestCount() zeroes the counter.
 * TC-P2CB-JFB-ROW         : jfb row topology (K=3 reactive effects) → 0 harvests/row.
 *
 * All DOM-free. Uses core primitives only.
 * Gate-P: harvestCount is test-only, zero production-path branch overhead.
 */
import { expect, test } from 'vitest'
import { __test, createRoot, effect, flushSync, getOwner, signal } from '../../src/core/core.js'
import { harvestInertChildren } from '../../src/core/index.js'

// ── TC-P2CB-COUNTER-INERT ────────────────────────────────────────────────────

test('TC-P2CB-COUNTER-INERT  inert effect harvest increments harvestCount', () => {
  __test.resetHarvestCount()
  createRoot(() => {
    effect(() => {
      // intentionally reads nothing — inert after first flush
    })
    flushSync()
    harvestInertChildren(getOwner())
  })
  expect(__test.harvestCount).toBe(1)
})

// ── TC-P2CB-COUNTER-REACTIVE ─────────────────────────────────────────────────

test('TC-P2CB-COUNTER-REACTIVE  reactive effect NOT harvested — harvestCount stays 0', () => {
  __test.resetHarvestCount()
  const s = signal(0)
  createRoot(() => {
    effect(() => {
      s() // tracked read — effect is reactive, never inert
    })
    flushSync()
    harvestInertChildren(getOwner())
  })
  expect(__test.harvestCount).toBe(0)
})

// ── TC-P2CB-COUNTER-RESET ────────────────────────────────────────────────────

test('TC-P2CB-COUNTER-RESET  resetHarvestCount zeroes the counter', () => {
  // Prime the counter first
  createRoot(() => {
    effect(() => {})
    flushSync()
    harvestInertChildren(getOwner())
  })
  __test.resetHarvestCount()
  expect(__test.harvestCount).toBe(0)
})

// ── TC-P2CB-JFB-ROW — ceiling measurement ───────────────────────────────────
//
// Replicates the jfb row binding topology for N rows:
//   valueSig  — signal carrying the row value object
//   indexSig  — signal carrying the row index
//   owner     — createRoot scope (the row's owner)
//   K=3 binding-effects:
//     (a) classList: reads selected() === valueSig().id   → reactive (reads selected + valueSig)
//     (b) text id:   reads valueSig().id                  → reactive (reads valueSig)
//     (c) text label: reads valueSig().label              → reactive (reads valueSig)
//
// All K effects are reactive → expected harvests/row = 0.
// This is B's ceiling: STATIC ⊆ inert. If 0 inert, B has nothing to elide.

test('TC-P2CB-JFB-ROW  jfb row topology (K=3 reactive effects) harvests 0 per row', () => {
  const N = 1000
  const selected = signal(0)

  __test.resetHarvestCount()

  const disposes: Array<() => void> = []
  for (let i = 0; i < N; i++) {
    const valueSig = signal({ id: i + 1, label: `row-${i + 1}` })
    const _indexSig = signal(i)

    let rowOwner: ReturnType<typeof getOwner> = null
    const dispose = createRoot((d) => {
      rowOwner = getOwner()

      // (a) classList binding — reads selected + valueSig
      effect(() => {
        void (selected() === valueSig().id)
      })
      // (b) text id binding — reads valueSig
      effect(() => {
        void valueSig().id
      })
      // (c) text label binding — reads valueSig
      effect(() => {
        void valueSig().label
      })

      flushSync()
      harvestInertChildren(rowOwner)
      return d
    })
    disposes.push(dispose)
  }

  const totalHarvests = __test.harvestCount
  const harvestsPerRow = totalHarvests / N
  // K=3 reactive effects + valueSig + indexSig + createRoot owner = 2+1+3=6 nodes/row
  const K = 3
  const nodesPerRow = 2 + 1 + K
  const fraction = harvestsPerRow / nodesPerRow

  // Report for architect
  console.log(`[P-2c-B ceiling probe] N=${N} rows`)
  console.log(`  total harvests : ${totalHarvests}`)
  console.log(`  harvests/row   : ${harvestsPerRow.toFixed(4)}`)
  console.log(`  K (binding-effects/row) : ${K}`)
  console.log(`  nodes/row (2+1+K)       : ${nodesPerRow}`)
  console.log(`  harvests/row ÷ (2+1+K)  : ${(fraction * 100).toFixed(2)}%`)

  for (const d of disposes) d()

  // Gate-P: all K=3 effects are reactive → 0 harvests expected
  expect(totalHarvests).toBe(0)
  expect(harvestsPerRow).toBe(0)
})
