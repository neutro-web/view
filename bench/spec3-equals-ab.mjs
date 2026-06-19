/**
 * Spec #3 — within-core A/B micro-benchmark: _compilerEquals slot cost/benefit
 * Run: node --expose-gc bench/spec3-equals-ab.mjs
 *
 * Four shapes (see Spec §2.1):
 *   1. primitive-value changing writes  — OBJECT_IS vs Object.is  → expect zero delta
 *   2. primitive-value no-op writes     — OBJECT_IS vs Object.is  → expect zero delta
 *   3. mutable-container in-place       — false vs Object.is      → specialized SLOWER (correct)
 *   4. mutable-container ref-change     — false vs Object.is      → specialized marginally faster
 */

import { __test, derived, flushSync, signal } from '../dist/core/core.js'

const WARMUP = 5
const TRIALS = 15
const GC = typeof globalThis.gc === 'function' ? globalThis.gc : () => {}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// ── shape runners ─────────────────────────────────────────────────────────────

// Shape 1: primitive nodes, values change each write (equality check fires, returns false each time)
function runPrimitiveChanging(iters, width, useSpecialized) {
  const srcs = Array.from({ length: width }, (_, i) => signal(i))
  const ds = srcs.map((s) => {
    const d = derived(() => s() * 2)
    if (useSpecialized) __test.setCompilerEquals(d, Object.is) // OBJECT_IS — identical to default
    d()
    return d
  })
  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    srcs[i % width].set(i + 1) // always different
    flushSync()
    ds[i % width]()
  }
  return performance.now() - t0
}

// Shape 2: primitive nodes, same value every write (equality short-circuit fires, suppresses)
function runPrimitiveNoOp(iters, width, useSpecialized) {
  const srcs = Array.from({ length: width }, (_, i) => signal(i))
  const ds = srcs.map((s) => {
    const d = derived(() => s() * 2)
    if (useSpecialized) __test.setCompilerEquals(d, Object.is)
    d()
    return d
  })
  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    srcs[i % width].set(i % width) // always same as initial value
    flushSync()
    ds[i % width]()
  }
  return performance.now() - t0
}

// Shape 3: mutable-container, in-place mutation (same reference every write)
// Baseline (Object.is) wrongly suppresses; specialized (false) correctly propagates.
// Specialized does MORE work — it is correct; baseline is artificially fast because it is buggy.
function runMutableInPlace(iters, count, useSpecialized) {
  const arrs = Array.from({ length: count }, () => [0])
  const sigs = arrs.map((arr) => {
    const s = signal(arr)
    if (useSpecialized) __test.setCompilerEquals(s, false) // always-propagate
    return s
  })
  const ds = sigs.map((s) => {
    const d = derived(() => s().length)
    d()
    return d
  })
  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    const idx = i % count
    arrs[idx].push(i) // in-place mutation
    sigs[idx].set(arrs[idx]) // same ref
    flushSync()
    ds[idx]()
  }
  return performance.now() - t0
}

// Shape 4: mutable-container, new reference every write (both arms propagate identically)
// Only difference: false skips the Object.is call; Object.is makes the call (finds false, propagates).
function runMutableRefChange(iters, count, useSpecialized) {
  const sigs = Array.from({ length: count }, () => {
    const s = signal([0])
    if (useSpecialized) __test.setCompilerEquals(s, false)
    return s
  })
  const ds = sigs.map((s) => {
    const d = derived(() => s().length)
    d()
    return d
  })
  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    const idx = i % count
    sigs[idx].set([i]) // new array each time — both arms propagate
    flushSync()
    ds[idx]()
  }
  return performance.now() - t0
}

// ── harness ───────────────────────────────────────────────────────────────────

function runShape(name, fn) {
  for (let i = 0; i < WARMUP; i++) fn(false)
  const baseTimes = []
  for (let i = 0; i < TRIALS; i++) {
    GC()
    baseTimes.push(fn(false))
  }
  for (let i = 0; i < WARMUP; i++) fn(true)
  const specTimes = []
  for (let i = 0; i < TRIALS; i++) {
    GC()
    specTimes.push(fn(true))
  }
  const bMs = median(baseTimes)
  const sMs = median(specTimes)
  const dMs = sMs - bMs
  const dPct = (dMs / bMs) * 100
  return { name, bMs, sMs, dMs, dPct }
}

// ── run ───────────────────────────────────────────────────────────────────────

const shapes = [
  ['prim-changing (w=200,  iters=50000) ', (u) => runPrimitiveChanging(50000, 200, u)],
  ['prim-changing (w=1000, iters=10000) ', (u) => runPrimitiveChanging(10000, 1000, u)],
  ['prim-no-op    (w=200,  iters=50000) ', (u) => runPrimitiveNoOp(50000, 200, u)],
  ['prim-no-op    (w=1000, iters=10000) ', (u) => runPrimitiveNoOp(10000, 1000, u)],
  ['mut-in-place  (n=100,  iters=20000) ', (u) => runMutableInPlace(20000, 100, u)],
  ['mut-ref-chg   (n=100,  iters=20000) ', (u) => runMutableRefChange(20000, 100, u)],
]

console.log('\n=== Spec #3 — _compilerEquals A/B (median of 15 trials) ===')
console.log('Baseline arm: slot = Object.is (default, no setCompilerEquals).')
console.log('Specialized arm: slot = OBJECT_IS for prim shapes; false for mutable shapes.\n')
console.log(
  'Shape'.padEnd(42),
  'Baseline(ms)'.padStart(13),
  'Special(ms)'.padStart(12),
  'Δms'.padStart(8),
  'Δ%'.padStart(8),
  'Verdict'.padStart(12),
)
console.log('-'.repeat(101))

for (const [name, fn] of shapes) {
  const r = runShape(name, fn)
  // noise threshold: ±5% — within typical run-to-run variance
  const verdict =
    r.dPct < -5 ? 'FASTER' : r.dPct > 5 ? 'SLOWER' : '~same'
  console.log(
    name.padEnd(42),
    r.bMs.toFixed(2).padStart(13),
    r.sMs.toFixed(2).padStart(12),
    r.dMs.toFixed(2).padStart(8),
    `${(r.dPct >= 0 ? '+' : '') + r.dPct.toFixed(1)}%`.padStart(8),
    verdict.padStart(12),
  )
}

console.log('\nPositive Δ = specialized arm SLOWER; negative Δ = faster.')
console.log('mut-in-place SLOWER is expected and correct (propagation was wrongly suppressed in baseline).\n')
