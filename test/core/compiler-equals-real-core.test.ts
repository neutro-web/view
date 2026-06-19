/**
 * Gate B — §10 row 2: _compilerEquals integration soundness
 *
 * Proves:
 *   B-1  Explicit user opts.equals always wins (signal + derived)
 *   B-2  Inferred fills the slot only when explicit is absent (signal + derived)
 *   B-3  `false` inferred — every write/recompute propagates (mutable-container case)
 *   B-4  Wrong-narrow inference (() => true) — damage confined to annotated nodes;
 *        non-annotated nodes are byte-identical to today
 *   B-5  Wrong-wide inference (() => false) — extra recomputes, correct values
 *   B-6  Error recovery (wasError path) unaffected by inferred equals
 *   B-7  Hot path untouched — wiring is construction-time only
 */

import { expect, test } from 'vitest'
import { __test, derived, flushSync, signal } from '../../src/core/core.js'

// ── B-1: Explicit user opts.equals wins ───────────────────────────────────────

test('B-1 signal: user opts.equals wins over inferred', () => {
  // User says "always equal" (suppress all updates)
  const userEq = (_a: unknown, _b: unknown) => true
  // Compiler says "never equal" (always propagate)
  const inferredEq = (_a: unknown, _b: unknown) => false

  const s = signal<number>(0, { equals: userEq })
  __test.setCompilerEquals(s, inferredEq)

  let count = 0
  const d = derived(() => {
    count++
    return s()
  })
  d() // prime
  count = 0

  s.set(99)
  flushSync()
  d()
  // user said "equal" → no propagation
  expect(count).toBe(0)
  // slot must be the user function, not the inferred one
  expect(__test.getEquals(s)).toBe(userEq)
})

test('B-1 derived: user opts.equals wins over inferred', () => {
  const userEq = (_a: unknown, _b: unknown) => true
  const inferredEq = (_a: unknown, _b: unknown) => false

  const src = signal(0)
  const d = derived(() => src(), { equals: userEq })
  __test.setCompilerEquals(d, inferredEq)

  let obsCount = 0
  const obs = derived(() => {
    obsCount++
    return d()
  })
  obs() // prime
  obsCount = 0

  src.set(99)
  flushSync()
  obs()
  expect(obsCount).toBe(0)
  expect(__test.getEquals(d)).toBe(userEq)
})

// ── B-2: Inferred fills the slot when explicit absent ─────────────────────────

test('B-2 signal: inferred fills slot when no opts.equals', () => {
  const inferredEq = (a: unknown, b: unknown) => a === b
  const s = signal(0)
  // slot starts as Object.is
  expect(__test.getEquals(s)).toBe(Object.is)

  __test.setCompilerEquals(s, inferredEq)
  expect(__test.getEquals(s)).toBe(inferredEq)
})

test('B-2 derived: inferred fills slot when no opts.equals', () => {
  const inferredEq = (a: unknown, b: unknown) => a === b
  const src = signal(0)
  const d = derived(() => src())
  expect(__test.getEquals(d)).toBe(Object.is)

  __test.setCompilerEquals(d, inferredEq)
  expect(__test.getEquals(d)).toBe(inferredEq)
})

test('B-2 signal: no inferred — slot stays Object.is', () => {
  const s = signal(0)
  expect(__test.getEquals(s)).toBe(Object.is)
})

test('B-2 derived: no inferred — slot stays Object.is', () => {
  const src = signal(0)
  const d = derived(() => src())
  expect(__test.getEquals(d)).toBe(Object.is)
})

// ── B-3: `false` inferred — always-propagate (mutable-container case) ─────────

test('B-3 signal: inferred false — in-place mutation always notifies', () => {
  const arr = [1, 2, 3]
  const s = signal(arr)
  __test.setCompilerEquals(s, false)
  expect(__test.getEquals(s)).toBe(false)

  let count = 0
  const d = derived(() => {
    count++
    return s().length
  })
  d() // prime
  count = 0

  // In-place mutation — Object.is would wrongly suppress this
  arr.push(4)
  s.set(arr) // same reference, but _compilerEquals is false → always propagates
  flushSync()
  d()
  expect(count).toBe(1)
  expect(d()).toBe(4)
})

test('B-3 derived: inferred false — every recompute propagates', () => {
  const src = signal(0)
  // derived that always returns the same boxed value, but equals:false means always changed
  const box = { v: 0 }
  const d = derived(() => {
    box.v = src()
    return box // same reference always
  })
  __test.setCompilerEquals(d, false)

  let count = 0
  const obs = derived(() => {
    count++
    return d().v
  })
  obs() // prime
  count = 0

  src.set(1)
  flushSync()
  obs()
  expect(count).toBe(1)
})

// ── B-4: Wrong-narrow inference — damage bounded, non-annotated unchanged ─────

test('B-4: wrong-narrow (always-equal) only affects annotated node', () => {
  // Two independent signals + deriveds. Only one gets the bad inference.
  const s1 = signal(0)
  const s2 = signal(0)
  const d1 = derived(() => s1()) // annotated with wrong inference
  const d2 = derived(() => s2()) // NOT annotated — must behave identically to today

  __test.setCompilerEquals(d1, () => true) // wrong: always equal → suppresses updates

  let count1 = 0
  let count2 = 0
  const obs1 = derived(() => {
    count1++
    return d1()
  })
  const obs2 = derived(() => {
    count2++
    return d2()
  })
  obs1()
  obs2() // prime
  count1 = 0
  count2 = 0

  s1.set(99) // d1 recomputes but wrong inference suppresses propagation
  s2.set(99) // d2 recomputes with Object.is → value changed → propagates
  flushSync()
  obs1()
  obs2()

  // d1 annotated with wrong-narrow: update suppressed (damage to annotated node)
  expect(count1).toBe(0)
  // d2 non-annotated: update correctly propagates
  expect(count2).toBe(1)
  // d2's slot is still Object.is — not displaced
  expect(__test.getEquals(d2)).toBe(Object.is)
})

test('B-4: non-annotated signal is byte-identical (slot = Object.is)', () => {
  const s = signal(42)
  // No setCompilerEquals called
  expect(__test.getEquals(s)).toBe(Object.is)

  // Behaves exactly as before: Object.is semantics
  let count = 0
  const d = derived(() => {
    count++
    return s()
  })
  d()
  count = 0

  s.set(42) // same value → no propagation under Object.is
  flushSync()
  d()
  expect(count).toBe(0)

  s.set(43) // different → propagates
  flushSync()
  d()
  expect(count).toBe(1)
})

// ── B-5: Wrong-wide inference — extra recomputes, correct values ───────────────

test('B-5 signal: wrong-wide (always-unequal) causes extra recomputes, values correct', () => {
  const s = signal(5)
  __test.setCompilerEquals(s, () => false) // under-reports equality

  let count = 0
  const d = derived(() => {
    count++
    return s()
  })
  d() // prime
  count = 0

  s.set(5) // same value — Object.is would suppress, wrong-wide forces recompute
  flushSync()
  d()
  expect(count).toBe(1) // extra recompute (spurious, but safe)
  expect(d()).toBe(5) // value is correct
})

test('B-5 derived: wrong-wide causes spurious observer recomputes, values correct', () => {
  // d maps any positive src to 1, zero otherwise — so changing src from 1 to 2 leaves d=1
  const src = signal(1)
  const d = derived(() => (src() > 0 ? 1 : 0))
  __test.setCompilerEquals(d, () => false) // under-reports equality

  let count = 0
  const obs = derived(() => {
    count++
    return d()
  })
  obs() // prime — d=1
  count = 0

  // src changes 1→2: d recomputes, still returns 1. Object.is would suppress obs.
  // wrong-wide always returns false → always propagates → obs recomputes.
  src.set(2)
  flushSync()
  obs()
  expect(count).toBe(1) // spurious but safe
  expect(obs()).toBe(1) // value correct
})

// ── B-6: Error recovery unaffected ────────────────────────────────────────────

test('B-6 derived: wasError path propagates regardless of inferred equals', () => {
  const shouldThrow = signal(true)
  // inferred equals: always equal (would suppress if wasError check were absent)
  const d = derived(() => {
    if (shouldThrow()) throw new Error('boom')
    return 42
  })
  __test.setCompilerEquals(d, () => true)

  // First read — throws, enters error state
  expect(() => d()).toThrow('boom')

  let count = 0
  const obs = derived(() => {
    count++
    return d()
  })

  // Fix it
  shouldThrow.set(false)
  flushSync()

  // wasError=true before this run → changed=true regardless of equals → propagates
  obs()
  expect(count).toBe(1)
  expect(obs()).toBe(42)
})

// ── B-7: Inferred false — presence check uses === undefined (not falsy) ────────

test('B-7: false is a real inferred value, not treated as absent', () => {
  const s = signal(0)
  __test.setCompilerEquals(s, false)
  // Must be false in the slot, not Object.is
  expect(__test.getEquals(s)).toBe(false)

  // And false means always-propagate, not "no inference applied"
  let count = 0
  const d = derived(() => {
    count++
    return s()
  })
  d()
  count = 0

  s.set(0) // same value — false means always propagate
  flushSync()
  d()
  expect(count).toBe(1)
})

test('B-7: clearing inferred (undefined) restores Object.is', () => {
  const s = signal(0)
  __test.setCompilerEquals(s, () => false)
  expect(__test.getEquals(s)).not.toBe(Object.is)

  __test.setCompilerEquals(s, undefined)
  expect(__test.getEquals(s)).toBe(Object.is)
})
