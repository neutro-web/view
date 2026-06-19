/**
 * Spec #2 — within-core A/B micro-benchmark: _compilerSources oracle cost/benefit
 *
 * Measures the oracle's net effect on wall-time across four graph shapes.
 * For each shape, the ONLY variable is _compilerSources: null (baseline) vs.
 * a correct declared union (specialized arm). All else — graph, writes, flushes
 * — is identical.
 *
 * Run: node --expose-gc dist/bench/spec2-oracle-ab.js
 */

import { derived, flushSync, signal } from '../src/core/core'
import { __test } from '../src/core/core'

const WARMUP = 5
const TRIALS = 15
const GC = typeof globalThis.gc === 'function' ? (globalThis.gc as () => void) : () => {}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

// ── shape runners ─────────────────────────────────────────────────────────────

/**
 * Shape 1: Wide stable dependency set.
 * One derived reads WIDTH signals, same set every recompute, recomputed ITERS times.
 * Design-target for the oracle (large expected read-set, stable). The wide-graph
 * spike already placed reconcile at ~0.2% here — oracle almost certainly adds cost.
 */
function runWideStable(iters: number, width: number, useOracle: boolean): number {
  const srcs = Array.from({ length: width }, (_, i) => signal(i))
  const d = derived(() => {
    let s = 0
    for (const src of srcs) s += src()
    return s
  })

  if (useOracle) {
    __test.setCompilerSources(d, new Set(srcs))
  }

  // initial read to establish edges
  d()

  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    srcs[i % width].set(i + 1)
    flushSync()
    d()
  }
  return performance.now() - t0
}

/**
 * Shape 2: Branch-variant node that flips its read-set every iteration.
 * cond ? a : b, cond flips every write. Oracle fires _diverged on every
 * recompute (first read after flip is always the off-union source). Pure
 * overhead: oracle does work, notices divergence, reconcile still runs fully.
 */
function runBranchFlip(iters: number, useOracle: boolean): number {
  const cond = signal(true)
  const a = signal(1)
  const b = signal(2)
  const d = derived(() => (cond() ? a() : b()))

  if (useOracle) {
    // correct oracle for both branches: full union {cond, a, b}
    __test.setCompilerSources(d, new Set([cond, a, b]))
  }

  d()

  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    cond.set(i % 2 === 0)
    flushSync()
    d()
  }
  return performance.now() - t0
}

/**
 * Shape 3: Many annotated nodes, narrow each.
 * COUNT simple derived nodes, each reading one signal. Tests the per-node
 * _diverged reset and Set allocation cost amortized across many nodes.
 */
function runManyNarrow(iters: number, count: number, useOracle: boolean): number {
  const srcs = Array.from({ length: count }, (_, i) => signal(i))
  const deriveds = srcs.map((s) => {
    const d = derived(() => s() * 2)
    if (useOracle) {
      __test.setCompilerSources(d, new Set([s]))
    }
    d()
    return d
  })

  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    srcs[i % count].set(i + 1)
    flushSync()
    deriveds[i % count]()
  }
  return performance.now() - t0
}

/**
 * Shape 4: High recompute frequency on annotated nodes.
 * A chain: signal → d1 → d2 → d3 → d4 → d5. Every signal write forces
 * all 5 to recompute. Oracle cost is per-recompute × depth × iters.
 * Maximizes the _diverged-reset and Set.has() overhead on annotated nodes.
 */
function runDeepChain(iters: number, depth: number, useOracle: boolean): number {
  const src = signal(0)
  const chain: ReturnType<typeof derived>[] = []
  let prev: () => number = src

  for (let i = 0; i < depth; i++) {
    const p = prev
    const d = derived(() => p() + 1)
    if (useOracle) {
      __test.setCompilerSources(d, new Set([p]))
    }
    chain.push(d)
    prev = d
  }

  chain[chain.length - 1]()

  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    src.set(i + 1)
    flushSync()
    chain[chain.length - 1]()
  }
  return performance.now() - t0
}

// ── harness ───────────────────────────────────────────────────────────────────

interface ShapeResult {
  name: string
  baselineMs: number
  specializedMs: number
  deltaMs: number
  deltaPct: number
}

function runShape(name: string, fn: (useOracle: boolean) => number): ShapeResult {
  // warmup (baseline arm)
  for (let i = 0; i < WARMUP; i++) fn(false)

  // baseline trials
  const baseTimes: number[] = []
  for (let i = 0; i < TRIALS; i++) {
    GC()
    baseTimes.push(fn(false))
  }

  // warmup (specialized arm)
  for (let i = 0; i < WARMUP; i++) fn(true)

  // specialized trials
  const specTimes: number[] = []
  for (let i = 0; i < TRIALS; i++) {
    GC()
    specTimes.push(fn(true))
  }

  const bMs = median(baseTimes)
  const sMs = median(specTimes)
  const dMs = sMs - bMs
  const dPct = (dMs / bMs) * 100

  return { name, baselineMs: bMs, specializedMs: sMs, deltaMs: dMs, deltaPct: dPct }
}

// ── main ──────────────────────────────────────────────────────────────────────

const results: ShapeResult[] = []

results.push(runShape('wide-stable  (width=200, iters=2000)', (u) => runWideStable(2000, 200, u)))
results.push(runShape('wide-stable  (width=1000, iters=500)', (u) => runWideStable(500, 1000, u)))
results.push(runShape('branch-flip  (iters=5000)', (u) => runBranchFlip(5000, u)))
results.push(runShape('many-narrow  (count=500, iters=5000)', (u) => runManyNarrow(5000, 500, u)))
results.push(runShape('deep-chain   (depth=20, iters=5000)', (u) => runDeepChain(5000, 20, u)))
results.push(runShape('deep-chain   (depth=100, iters=2000)', (u) => runDeepChain(2000, 100, u)))

// ── report ────────────────────────────────────────────────────────────────────

const W = 42
console.log('\n=== Spec #2 — _compilerSources oracle A/B (median of 15 trials) ===\n')
console.log(
  'Shape'.padEnd(W),
  'Baseline(ms)'.padStart(14),
  'Special(ms)'.padStart(12),
  'Δms'.padStart(8),
  'Δ%'.padStart(8),
  'Verdict'.padStart(12),
)
console.log('-'.repeat(W + 14 + 12 + 8 + 8 + 12 + 5))

for (const r of results) {
  const verdict = r.deltaPct < -1 ? '  FASTER  ' : r.deltaPct > 1 ? '  SLOWER  ' : '  ~same   '
  console.log(
    r.name.padEnd(W),
    r.baselineMs.toFixed(2).padStart(14),
    r.specializedMs.toFixed(2).padStart(12),
    r.deltaMs.toFixed(2).padStart(8),
    `${(r.deltaPct >= 0 ? '+' : '') + r.deltaPct.toFixed(1).padStart(7)}%`,
    verdict,
  )
}

console.log('\nNote: positive Δ = specialized arm is SLOWER (oracle adds cost).')
console.log('      negative Δ = specialized arm is faster (oracle saves work).\n')
