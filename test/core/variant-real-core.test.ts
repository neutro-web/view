/**
 * Gate B — §10 row 4 branch-variant hook wired into the real core (Spec #4)
 *
 * Ports the model-harness tests (branch-variant-runtime.test.ts) to run against
 * the production core.ts. Verifies the central correctness property:
 *
 *   For every node and every input sequence, the source-edge list (by membership
 *   and read order), the computed value, and propagation behavior are identical
 *   whether _compilerSources is null/absent or set to any value — correct, wrong-
 *   narrow, wrong-wide, or empty. The oracle may only affect _diverged; it may
 *   never affect edges, values, dirty/clean state, or what any other node observes.
 *
 * Key differences from the model harness:
 *   - Reads are lazy: derived() doesn't recompute until called (d()).
 *   - The "dead-branch write doesn't recompute" invariant works because propagate()
 *     only marks a node dirty if it is in the source's observer list. If reconcile
 *     removed the edge, the node stays CLEAN on that write.
 *   - Link objects are pooled (poolLink / makeLink). Never compare Link identity
 *     across runs — compare the sequence of source nodes the list points to.
 *   - __test.sourceNodes() returns ReactiveNode refs. For cross-run comparison,
 *     we verify count + behavioral live/dead property (same as the model tests do).
 */

import { describe, expect, test } from 'vitest'
import { derived, flushSync, signal } from '../../src/core/core.js'
import { __test } from '../../src/core/core.js'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Read recompute count for derived fn since last resetCounts(). */
function recomputesOf(fn: object): number {
  return __test.recomputesOf(fn)
}

// ── Gate B-1: Ports of the 7 model tests ─────────────────────────────────────

describe('Gate B — §10 row 4 wired into real core', () => {
  test('PROPERTY: branch-flip correctly re-tracks live dependency, drops dead one', () => {
    const cond = signal(true)
    const a = signal(10)
    const b = signal(20)

    const d = derived(() => (cond() ? a() : b()))
    __test.setCompilerSources(d, new Set([cond, a, b]))

    // Initial read: cond=true → reads cond, a
    expect(d()).toBe(10)
    expect(__test.isDiverged(d), 'no divergence on correct union').toBe(false)
    expect(__test.sourceCount(d)).toBe(2) // cond + a

    // Flip branch: cond=false → reads cond, b
    cond.set(false)
    expect(d()).toBe(20)
    expect(__test.isDiverged(d)).toBe(false)
    expect(__test.sourceCount(d)).toBe(2) // cond + b

    // Write to DEAD dependency (a is no longer a source)
    __test.resetCounts()
    a.set(99)
    expect(d(), 'dead-branch write must not trigger recomputation').toBe(20)
    expect(recomputesOf(d)).toBe(0)

    // Write to LIVE dependency (b is the current source)
    b.set(30)
    expect(d(), 'live-branch write must trigger recomputation').toBe(30)

    // Flip back: cond=true → live=a, dead=b
    cond.set(true)
    expect(d()).toBe(99) // a=99 from earlier write
    expect(__test.sourceCount(d)).toBe(2) // cond + a

    // Dead b: must not trigger recompute
    __test.resetCounts()
    b.set(50)
    expect(d(), 'second flip: dead b must not trigger recomputation').toBe(99)
    expect(recomputesOf(d)).toBe(0)

    // Live a: must trigger recompute
    a.set(5)
    expect(d()).toBe(5)
  })

  test('SOUNDNESS: wrong-narrow declared set → divergence detected, correct result via reconciliation', () => {
    const cond = signal(true)
    const a = signal(10)
    const b = signal(20)

    const d = derived(() => (cond() ? a() : b()))
    // DELIBERATELY WRONG: only declares {cond}, misses a and b
    __test.setCompilerSources(d, new Set([cond]))

    // First read: cond=true → reads cond (in union) and a (NOT in union → divergence)
    expect(d(), 'correct result despite wrong narrow union').toBe(10)
    expect(__test.isDiverged(d), 'divergence detected when a read falls outside union').toBe(true)
    expect(__test.sourceCount(d)).toBe(2) // reconciliation ran — cond AND a are tracked

    // Critically: reconciliation ran, so a IS a source of d
    a.set(99)
    expect(d(), 'a must be tracked — reconcile is ground truth').toBe(99)

    // Flip: cond=false → reads cond, b (b not in union → divergence again)
    cond.set(false)
    expect(d()).toBe(20)
    expect(__test.isDiverged(d), 'divergence again on second run').toBe(true)
    expect(__test.sourceCount(d)).toBe(2) // cond + b

    // b should now be tracked
    b.set(30)
    expect(d(), 'b must be tracked after reconciliation').toBe(30)
  })

  test('SOUNDNESS: empty declared union → all reads diverge, still correct', () => {
    const a = signal(5)
    const d = derived(() => a() + 1)
    __test.setCompilerSources(d, new Set())

    expect(d(), 'correct result even with empty declared union').toBe(6)
    expect(__test.isDiverged(d), 'any read diverges from empty union').toBe(true)
    expect(__test.sourceCount(d)).toBe(1) // a is tracked via reconcile

    a.set(10)
    expect(d(), 'a tracked despite empty declared union').toBe(11)
  })

  test('OVER-CORRECTION GUARD: null _compilerSources → identical to standard dynamic collection', () => {
    const cond = signal(true)
    const x = signal(10)
    const y = signal(20)

    const d = derived(() => (cond() ? x() : y()))
    // d._compilerSources is null (not set) — default behavior

    expect(d()).toBe(10)
    expect(__test.isDiverged(d), 'oracle never fires when _compilerSources is null').toBe(false)

    cond.set(false)
    expect(d()).toBe(20)
    expect(__test.sourceCount(d)).toBe(2) // cond + y

    // x is now dead: writing it must NOT trigger recomputation
    __test.resetCounts()
    x.set(99)
    expect(d(), '§12.3 property: dead-branch write must not recompute').toBe(20)
    expect(recomputesOf(d)).toBe(0)
    expect(__test.isDiverged(d)).toBe(false)

    y.set(30)
    expect(d()).toBe(30)
  })

  test('ORACLE-ONLY: divergence flip does not reset already-tracked sources', () => {
    // cond is read BEFORE divergence; a is read AFTER divergence detection.
    // Both must remain tracked (oracle flip only disables further Set.has calls,
    // it never touches the edge list or the epoch stamps).
    const cond = signal(true)
    const a = signal(10)

    const d = derived(() => {
      const c = cond() // reads cond (in {cond} → no divergence yet)
      const v = a() // reads a (NOT in {cond} → divergence! oracle deactivated)
      return c ? v : 0
    })
    __test.setCompilerSources(d, new Set([cond])) // narrow: misses a

    expect(d()).toBe(10)
    expect(__test.isDiverged(d)).toBe(true)
    expect(__test.sourceCount(d)).toBe(2) // cond + a both tracked

    // cond was read BEFORE divergence — must be tracked
    cond.set(false)
    expect(d(), 'cond must be tracked (was read before divergence flip)').toBe(0)
    expect(__test.sourceCount(d)).toBe(2) // cond + a

    // a is tracked too (tracking never stopped)
    a.set(99)
    // cond=false so result is 0, but a IS in the source list
    expect(d(), 'cond=false → result is 0 (a is tracked but not changing result)').toBe(0)

    cond.set(true)
    expect(d()).toBe(99) // a=99
  })

  test('PROPERTY/FUZZ: correct declared union survives multiple sequential branch flips', () => {
    const flag = signal(true)
    const src1 = signal(1)
    const src2 = signal(2)
    const src3 = signal(3)

    // tri-branch: flag→src1, !flag and src2>0→src2, else→src3
    const d = derived(() => (flag() ? src1() : src2() > 0 ? src2() : src3()))
    __test.setCompilerSources(d, new Set([flag, src1, src2, src3]))

    // Scenario 1: flag=true, reads flag+src1
    expect(d()).toBe(1)
    expect(__test.isDiverged(d)).toBe(false)

    // Scenario 2: flip flag=false, src2=2>0 → reads flag+src2(x2)
    flag.set(false)
    expect(d()).toBe(2)
    // src1 should be dead
    __test.resetCounts()
    src1.set(99)
    expect(d(), 'src1 dead after first flip').toBe(2)
    expect(recomputesOf(d)).toBe(0)

    // Scenario 3: src2=0 → goes to src3 branch
    src2.set(0)
    expect(d()).toBe(3)
    __test.resetCounts()
    src1.set(50)
    expect(d(), 'src1 still dead').toBe(3)
    expect(recomputesOf(d)).toBe(0)

    // Scenario 4: flip flag=true → back to src1 branch
    flag.set(true)
    expect(d()).toBe(50) // src1=50
    __test.resetCounts()
    src2.set(5)
    expect(d(), 'src2 dead after flip back').toBe(50)
    expect(recomputesOf(d)).toBe(0)
    src3.set(7)
    expect(d(), 'src3 dead after flip back').toBe(50)
    src1.set(100)
    expect(d(), 'src1 live after flip back').toBe(100)
    expect(__test.isDiverged(d)).toBe(false)
  })

  test('PROPERTY/FUZZ: correct union with no divergence through many writes', () => {
    const cond = signal(true)
    const a = signal(0)
    const b = signal(0)
    const d = derived(() => (cond() ? a() : b()))
    __test.setCompilerSources(d, new Set([cond, a, b]))

    for (let i = 0; i < 5; i++) {
      cond.set(true)
      a.set(i * 10)
      expect(d()).toBe(i * 10)
      expect(__test.isDiverged(d), `diverged on iteration ${i} (cond=true)`).toBe(false)

      cond.set(false)
      b.set(i * 10 + 1)
      expect(d()).toBe(i * 10 + 1)
      expect(__test.isDiverged(d), `diverged on iteration ${i} (cond=false)`).toBe(false)
    }
  })
})

// ── Gate B-2: Differential property ──────────────────────────────────────────
//
// Runs the same graph and operation sequence across all four _compilerSources
// variants and asserts that edges (by count and by live/dead behavior), computed
// values, and recompute counts are identical in all cases.

describe('Gate B — differential property (_compilerSources must not affect edges/values/counts)', () => {
  /**
   * Helper: create a branch-flip graph, apply the given variant (built from the
   * actual signals inside the graph), run the scenario, and return observations.
   * variant is a function so the set is built from the exact same signal instances
   * that the derived reads — not from separate fresh signals.
   */
  function runVariant(
    makeVariant: (c: object, a: object, b: object) => ReadonlySet<object> | null,
  ): {
    value1: unknown
    value2: unknown
    value3: unknown
    sourceCount1: number
    sourceCount2: number
    recomputeOnDeadWrite: number
    recomputeOnLiveWrite: number
    diverged1: boolean
  } {
    const cond = signal(true)
    const a = signal(10)
    const b = signal(20)
    const d = derived(() => (cond() ? a() : b()))

    const variant = makeVariant(cond, a, b)
    if (variant !== null) __test.setCompilerSources(d, variant)

    const value1 = d()
    const sourceCount1 = __test.sourceCount(d)

    cond.set(false)
    const value2 = d()
    const sourceCount2 = __test.sourceCount(d)

    __test.resetCounts()
    a.set(99) // dead
    const cached = d() // force recompute-or-not
    const recomputeOnDeadWrite = recomputesOf(d)

    __test.resetCounts()
    b.set(30) // live
    const value3 = d()
    const recomputeOnLiveWrite = recomputesOf(d)

    const diverged1 = __test.isDiverged(d)
    void cached
    return {
      value1,
      value2,
      value3,
      sourceCount1,
      sourceCount2,
      recomputeOnDeadWrite,
      recomputeOnLiveWrite,
      diverged1,
    }
  }

  test('edges and values are variant-invariant (correct union vs null)', () => {
    const nullResult = runVariant(() => null)
    const correctResult = runVariant((c, a, b) => new Set([c, a, b]))
    expect(correctResult.value1).toBe(nullResult.value1)
    expect(correctResult.value2).toBe(nullResult.value2)
    expect(correctResult.value3).toBe(nullResult.value3)
    expect(correctResult.sourceCount1).toBe(nullResult.sourceCount1)
    expect(correctResult.sourceCount2).toBe(nullResult.sourceCount2)
    expect(correctResult.recomputeOnDeadWrite).toBe(nullResult.recomputeOnDeadWrite)
    expect(correctResult.recomputeOnLiveWrite).toBe(nullResult.recomputeOnLiveWrite)
    expect(nullResult.diverged1).toBe(false)
    expect(correctResult.diverged1).toBe(false)
  })

  test('edges and values are variant-invariant (wrong-narrow union vs null)', () => {
    const nullResult = runVariant(() => null)
    const narrowResult = runVariant((c) => new Set([c])) // only cond, misses a and b
    expect(narrowResult.value1).toBe(nullResult.value1)
    expect(narrowResult.value2).toBe(nullResult.value2)
    expect(narrowResult.value3).toBe(nullResult.value3)
    expect(narrowResult.sourceCount1).toBe(nullResult.sourceCount1)
    expect(narrowResult.sourceCount2).toBe(nullResult.sourceCount2)
    expect(narrowResult.recomputeOnDeadWrite).toBe(nullResult.recomputeOnDeadWrite)
    expect(narrowResult.recomputeOnLiveWrite).toBe(nullResult.recomputeOnLiveWrite)
  })

  test('edges and values are variant-invariant (empty union vs null)', () => {
    const nullResult = runVariant(() => null)
    const emptyResult = runVariant(() => new Set())
    expect(emptyResult.value1).toBe(nullResult.value1)
    expect(emptyResult.value2).toBe(nullResult.value2)
    expect(emptyResult.value3).toBe(nullResult.value3)
    expect(emptyResult.sourceCount1).toBe(nullResult.sourceCount1)
    expect(emptyResult.sourceCount2).toBe(nullResult.sourceCount2)
    expect(emptyResult.recomputeOnDeadWrite).toBe(nullResult.recomputeOnDeadWrite)
    expect(emptyResult.recomputeOnLiveWrite).toBe(nullResult.recomputeOnLiveWrite)
  })

  test('_diverged semantics: correct/empty/wide/narrow behave as specified', () => {
    {
      const a = signal(5)
      const d = derived(() => a() + 1)
      __test.setCompilerSources(d, new Set([a]))
      expect(d()).toBe(6)
      expect(__test.isDiverged(d), 'correct union → no divergence').toBe(false)
    }
    {
      const a = signal(5)
      const d = derived(() => a() + 1)
      __test.setCompilerSources(d, new Set()) // empty — a is outside
      expect(d()).toBe(6)
      expect(__test.isDiverged(d), 'empty union → diverged').toBe(true)
    }
    {
      const a = signal(5)
      const b = signal(3) // in union but never read (wrong-wide)
      const d = derived(() => a() + 1)
      __test.setCompilerSources(d, new Set([a, b]))
      expect(d()).toBe(6)
      expect(__test.isDiverged(d), 'wrong-wide (extra in union) → no divergence').toBe(false)
      expect(__test.sourceCount(d)).toBe(1) // only a is an actual source
    }
  })

  test('source read order is preserved across null and annotated variants', () => {
    // appendToSourceList appends in read order. After reading cond then a, source
    // order must be [cond-node, a-node] regardless of _compilerSources.
    const cond = signal(true)
    const a = signal(10)
    const b = signal(20)

    const dNull = derived(() => (cond() ? a() : b()))
    dNull() // reads cond then a
    const nodesNull = __test.sourceNodes(dNull)
    expect(nodesNull).toHaveLength(2)

    // Same shared signals → correct union
    const dSet = derived(() => (cond() ? a() : b()))
    __test.setCompilerSources(dSet, new Set([cond, a, b]))
    dSet()
    const nodesSet = __test.sourceNodes(dSet)
    expect(nodesSet).toHaveLength(2)

    // Both deriveds share cond/a/b nodes — compare node identity across the two lists
    expect(nodesNull[0]).toBe(nodesSet[0]) // first-read: both are cond-node
    expect(nodesNull[1]).toBe(nodesSet[1]) // second-read: both are a-node
  })

  test('recompute counts are identical across all variants', () => {
    function countRecomputes(
      makeVariant: (c: object, a: object, b: object) => ReadonlySet<object> | null,
    ): number {
      const cond = signal(true)
      const a = signal(10)
      const b = signal(20)
      const d = derived(() => (cond() ? a() : b()))
      const variant = makeVariant(cond, a, b)
      if (variant !== null) __test.setCompilerSources(d, variant)
      __test.resetCounts()
      d()
      cond.set(false)
      d()
      a.set(1) // dead write
      d()
      b.set(2) // live write
      d()
      return recomputesOf(d)
    }

    const base = countRecomputes(() => null)
    expect(countRecomputes((c, a, b) => new Set([c, a, b]))).toBe(base)
    expect(countRecomputes((c) => new Set([c]))).toBe(base) // wrong-narrow
    expect(countRecomputes(() => new Set())).toBe(base) // empty
  })
})

// ── Gate B-3: Specific assertions from Spec §5 Gate B requirements ────────────

describe('Gate B — spec §5 specific requirements', () => {
  test('wrong-narrow still establishes the omitted edge (reconcile is ground truth)', () => {
    const cond = signal(true)
    const a = signal(10)

    const d = derived(() => (cond() ? a() : 0))
    // Narrow: declares only {cond}; 'a' is omitted
    __test.setCompilerSources(d, new Set([cond]))

    d() // computes: reads cond (in union) and a (NOT in union → diverges)
    expect(__test.isDiverged(d)).toBe(true)

    // Reconcile ran: a IS in source list
    expect(__test.sourceCount(d)).toBe(2)

    // Writing a triggers recompute (edge was established by reconcile despite wrong union)
    a.set(99)
    expect(
      d(),
      'a must be a tracked source — omission from declared union does not drop the edge',
    ).toBe(99)
  })

  test('_compilerSources does not affect _seenBy / _seenRunId stamp fields', () => {
    // We can verify indirectly: O(1) dedup must work identically with and without the oracle.
    // A derived that reads the same signal twice in the compute should only track it once
    // (epoch dedup fires on the second read before the oracle even runs).
    const a = signal(10)
    const d = derived(() => {
      const v1 = a()
      const v2 = a() // second read — epoch dedup fires, oracle never fires for this read
      return v1 + v2
    })
    __test.setCompilerSources(d, new Set([a]))

    expect(d()).toBe(20)
    expect(__test.sourceCount(d)).toBe(1) // a tracked only once (dedup worked)
    expect(__test.isDiverged(d)).toBe(false) // a IS in union, no divergence
  })

  test('reconcileEdges is untouched: stale edges from prior run are always removed', () => {
    // If reconcile is accidentally skipped or modified, stale edges would remain.
    // Verify: after a branch flip, the old source is removed from the source list.
    const cond = signal(true)
    const a = signal(1)
    const b = signal(2)

    // Wrong-narrow: should not affect reconcile
    const d = derived(() => (cond() ? a() : b()))
    __test.setCompilerSources(d, new Set([cond])) // narrow

    d() // run 1: sources = [cond, a]
    expect(__test.sourceCount(d)).toBe(2)

    cond.set(false)
    d() // run 2: sources = [cond, b]; a must be removed by reconcile
    expect(__test.sourceCount(d)).toBe(2)

    // a is now dead: writing it must not trigger recompute
    __test.resetCounts()
    a.set(99)
    expect(d()).toBe(2) // b=2, no recompute from a
    expect(recomputesOf(d)).toBe(0)
  })

  test('_diverged is reset per recompute, not per lifetime', () => {
    // A derived that diverges in run 1 must reset _diverged to false at the start
    // of run 2. If the run 2 reads are all in-union, _diverged must be false after run 2.
    const cond = signal(true)
    const a = signal(10)

    // Union = {cond}. Run 1 reads a (diverges). Run 2 should NOT diverge if only cond is read.
    const d = derived(() => (cond() ? 0 : a())) // when cond=true reads only cond
    __test.setCompilerSources(d, new Set([cond]))

    cond.set(false) // force run 1 to read a (diverges)
    d()
    expect(__test.isDiverged(d)).toBe(true)

    cond.set(true) // run 2: only reads cond (in union → no divergence)
    d()
    expect(__test.isDiverged(d), '_diverged must be reset to false at start of run 2').toBe(false)
  })
})
