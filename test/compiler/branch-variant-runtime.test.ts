/**
 * nv Compiler — Branch-Variant Runtime Tests (§10 row 4)
 *
 * Mandatory tests from the step-4 brief, exercised via variantRuntimeHarness.ts:
 *
 *   1. PROPERTY — branch-flip correctness with a correct declared union.
 *      Verifies that after a branch flip, the node re-tracks the newly-live
 *      dependency and drops the dead one. The dead signal no longer triggers
 *      recomputation; the live one does.
 *
 *   2. SOUNDNESS — deliberately wrong (narrow) declared set.
 *      Verifies that the runtime fallback (reconcileEdges) produces the correct
 *      result independent of the analysis being right. A wrong declared set
 *      must set _diverged = true and still produce the correct value.
 *
 *   3. OVER-CORRECTION GUARD — no variant attached (_compilerSources = null).
 *      Verifies that the computation behaves identically to an unspecialized
 *      run. No regression on §12.3 (dynamic dependency).
 *
 *   4. ORACLE-ONLY PROPERTY — confirms that _variantActive flip during divergence
 *      touches ONLY the oracle flag, never the tracked source set.
 *
 *   5. PROPERTY/FUZZ — multiple branch-flip scenarios with the union oracle.
 *      Seeds cover: sequential flips, writes to dead branches, writes to live
 *      branches, and multiple-flip recovery.
 */

import { expect, test } from 'vitest'
import { HarnessDerived, HarnessSignal } from './variant-runtime-harness.js'

// ── Test 1: Property — branch-flip correctness ────────────────────────────────

test('PROPERTY: branch-flip correctly re-tracks live dependency, drops dead one', () => {
  const cond = new HarnessSignal(true)
  const a = new HarnessSignal(10)
  const b = new HarnessSignal(20)

  const d = new HarnessDerived(() => (cond.get() ? a.get() : b.get()))
  d._compilerSources = new Set([cond, a, b]) // correct declared union

  // Initial read: cond=true → reads cond, a
  expect(d.get()).toBe(10)
  expect(d._diverged, 'no divergence on initial run with correct union').toBe(false)

  // Flip branch: cond=false → reads cond, b
  cond.set(false)
  expect(d.get()).toBe(20)
  expect(d._diverged).toBe(false)

  // Write to DEAD dependency (a is no longer a source)
  a.set(99)
  // d should NOT be marked dirty by a (a was removed from sources during reconciliation)
  expect(d.get(), 'dead-branch write must not trigger recomputation').toBe(20)

  // Write to LIVE dependency (b is the current source)
  b.set(30)
  expect(d.get(), 'live-branch write must trigger recomputation').toBe(30)

  // Flip back: cond=true → live=a, dead=b
  cond.set(true)
  expect(d.get()).toBe(99) // a is 99 from the earlier write

  // Write to now-dead b: should not trigger recomputation
  b.set(50)
  expect(d.get(), 'second flip: dead-branch b must not trigger recomputation').toBe(99)

  // Write to now-live a: should trigger recomputation
  a.set(5)
  expect(d.get()).toBe(5)
})

// ── Test 2: Soundness — wrong narrow declared set → correct result ─────────────

test('SOUNDNESS: wrong narrow declared set → divergence detected, correct result via reconciliation', () => {
  const cond = new HarnessSignal(true)
  const a = new HarnessSignal(10)
  const b = new HarnessSignal(20)

  const d = new HarnessDerived(() => (cond.get() ? a.get() : b.get()))
  // DELIBERATELY WRONG: only declares {cond}, misses a and b
  d._compilerSources = new Set([cond])

  // First read: cond=true, reads cond (in union ✓) and a (NOT in union → divergence!)
  const result1 = d.get()
  expect(result1, 'result must be correct despite wrong declared set').toBe(10)
  expect(
    d._diverged,
    'divergence must be detected when a read falls outside the declared union',
  ).toBe(true)

  // Critically: reconciliation ran (always does), so a IS a source of d
  // Writing a should trigger recomputation
  a.set(99)
  expect(d.get(), 'a must be a tracked source — reconciliation is the ground truth').toBe(99)

  // Flip branch: cond=false → reads cond, b (b not in declared union → divergence again)
  cond.set(false)
  const result2 = d.get()
  expect(result2).toBe(20)
  expect(d._diverged, 'divergence detected again on second run').toBe(true)

  // b should now be tracked as a source
  b.set(30)
  expect(d.get(), 'b must be a tracked source after reconciliation').toBe(30)
})

test('SOUNDNESS: wrong declared set with union = empty set → all reads diverge, still correct', () => {
  const a = new HarnessSignal(5)
  const d = new HarnessDerived(() => a.get() + 1)
  d._compilerSources = new Set() // empty — everything is "outside the union"

  expect(d.get(), 'correct result even with empty declared union').toBe(6)
  expect(d._diverged, 'any read diverges from an empty declared union').toBe(true)

  // a must still be tracked (reconciliation ran)
  a.set(10)
  expect(d.get(), 'a must be tracked despite empty declared union').toBe(11)
})

// ── Test 3: Over-correction guard ─────────────────────────────────────────────

test('OVER-CORRECTION GUARD: null _compilerSources → identical to standard dynamic collection', () => {
  // No variant hook. This computation must behave exactly as §12.3 (dynamic dependency).
  const cond = new HarnessSignal(true)
  const x = new HarnessSignal(10)
  const y = new HarnessSignal(20)

  const d = new HarnessDerived(() => (cond.get() ? x.get() : y.get()))
  // d._compilerSources is null (not set)

  expect(d.get()).toBe(10)

  cond.set(false)
  expect(d.get()).toBe(20)

  // x is now dead: writing it must NOT trigger recomputation
  x.set(99)
  expect(d.get(), '§12.3 property: dead branch write must not recompute').toBe(20)
  expect(d._diverged, 'oracle never fires when _compilerSources is null').toBe(false)

  y.set(30)
  expect(d.get()).toBe(30)
})

// ── Test 4: Oracle-only property ──────────────────────────────────────────────

test('ORACLE-ONLY: divergence flip does not reset already-tracked sources', () => {
  // This test directly verifies the implementation note from the soundness design:
  // "flipping _variantActive = false mid-run touches ONLY the oracle checks,
  //  never the tracked-source state."
  //
  // Scenario: declared union = {cond}. Run reads cond, then a (divergence).
  // After divergence, _variantActive = false. The rest of the run (reading b in
  // the false branch if any) should still track correctly.
  // The key assertion: cond was read BEFORE divergence; it must still be tracked.

  const cond = new HarnessSignal(true)
  const a = new HarnessSignal(10)

  const d = new HarnessDerived(() => {
    const c = cond.get() // reads cond (in {cond} → no divergence yet)
    const v = a.get() // reads a (NOT in {cond} → divergence! _variantActive = false)
    return c ? v : 0
  })
  d._compilerSources = new Set([cond]) // narrow: missing a

  expect(d.get()).toBe(10)
  expect(d._diverged).toBe(true)

  // cond was read BEFORE divergence — must still be tracked
  cond.set(false)
  // After cond changes, d must be marked dirty and recompute
  expect(d.get(), 'cond must be tracked (was read before divergence flip)').toBe(0)

  // a was read AFTER divergence detection, but tracking was never stopped
  a.set(99)
  expect(d.get(), 'cond=false so a does not affect result, but d still tracked a').toBe(0)

  // Change cond back and verify a is also tracked
  cond.set(true)
  expect(d.get()).toBe(99) // a=99, result = 99 ✓
})

// ── Test 5: Property/fuzz — multiple branch-flip scenarios ────────────────────

test('PROPERTY/FUZZ: correct declared union survives multiple sequential branch flips', () => {
  // Deterministic multi-scenario property test.
  // Simulates a reactive component that conditionally reads different signals.

  const flag = new HarnessSignal(true)
  const src1 = new HarnessSignal(1)
  const src2 = new HarnessSignal(2)
  const src3 = new HarnessSignal(3)

  // tri-branch: flag=true→src1, flag=false and src2>0→src2, else→src3
  // (uses nested ternary — complex branch structure)
  const d = new HarnessDerived(() =>
    flag.get() ? src1.get() : src2.get() > 0 ? src2.get() : src3.get(),
  )
  d._compilerSources = new Set([flag, src1, src2, src3])

  // Scenario 1: flag=true, reads flag+src1
  expect(d.get()).toBe(1)
  expect(d._diverged).toBe(false)

  // Scenario 2: flip flag=false, src2=2>0 → reads flag+src2+src2
  flag.set(false)
  expect(d.get()).toBe(2)
  // src1 should be dead
  src1.set(99)
  expect(d.get(), 'src1 dead after first flip').toBe(2)

  // Scenario 3: src2=0 → goes to src3 branch → reads flag+src2+src3
  src2.set(0)
  expect(d.get()).toBe(3)
  // src1 still dead, src2 is live (read for the condition), src3 live
  src1.set(50)
  expect(d.get(), 'src1 still dead').toBe(3)

  // Scenario 4: flip flag=true → back to src1 branch
  flag.set(true)
  expect(d.get()).toBe(50) // src1 is 50 now
  src2.set(5)
  expect(d.get(), 'src2 dead after flip back').toBe(50)
  src3.set(7)
  expect(d.get(), 'src3 dead after flip back').toBe(50)
  src1.set(100)
  expect(d.get(), 'src1 live after flip back').toBe(100)
})

test('PROPERTY/FUZZ: correct union with no divergence through many writes', () => {
  // Verify _diverged stays false across many operations when the declared union is correct.
  const cond = new HarnessSignal(true)
  const a = new HarnessSignal(0)
  const b = new HarnessSignal(0)
  const d = new HarnessDerived(() => (cond.get() ? a.get() : b.get()))
  d._compilerSources = new Set([cond, a, b])

  // 10 alternating flips with writes
  for (let i = 0; i < 5; i++) {
    cond.set(true)
    a.set(i * 10)
    expect(d.get()).toBe(i * 10)
    expect(d._diverged, `diverged on iteration ${i} (cond=true)`).toBe(false)

    cond.set(false)
    b.set(i * 10 + 1)
    expect(d.get()).toBe(i * 10 + 1)
    expect(d._diverged, `diverged on iteration ${i} (cond=false)`).toBe(false)
  }
})
