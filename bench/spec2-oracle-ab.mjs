/**
 * Spec #2 — within-core A/B micro-benchmark: _compilerSources oracle cost/benefit
 * Run: node --expose-gc bench/spec2-oracle-ab.mjs
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

function runWideStable(iters, width, useOracle) {
  const srcs = Array.from({ length: width }, (_, i) => signal(i))
  const d = derived(() => {
    let s = 0
    for (const src of srcs) s += src()
    return s
  })
  if (useOracle) __test.setCompilerSources(d, new Set(srcs))
  d()
  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    srcs[i % width].set(i + 1)
    flushSync()
    d()
  }
  return performance.now() - t0
}

function runBranchFlip(iters, useOracle) {
  const cond = signal(true)
  const a = signal(1)
  const b = signal(2)
  const d = derived(() => (cond() ? a() : b()))
  if (useOracle) __test.setCompilerSources(d, new Set([cond, a, b]))
  d()
  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    cond.set(i % 2 === 0)
    flushSync()
    d()
  }
  return performance.now() - t0
}

function runManyNarrow(iters, count, useOracle) {
  const srcs = Array.from({ length: count }, (_, i) => signal(i))
  const ds = srcs.map((s) => {
    const d = derived(() => s() * 2)
    if (useOracle) __test.setCompilerSources(d, new Set([s]))
    d()
    return d
  })
  const t0 = performance.now()
  for (let i = 0; i < iters; i++) {
    srcs[i % count].set(i + 1)
    flushSync()
    ds[i % count]()
  }
  return performance.now() - t0
}

function runDeepChain(iters, depth, useOracle) {
  const src = signal(0)
  const chain = []
  let prev = src
  for (let i = 0; i < depth; i++) {
    const p = prev
    const d = derived(() => p() + 1)
    if (useOracle) __test.setCompilerSources(d, new Set([p]))
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
  ['wide-stable  (w=200,  iters=2000)', (u) => runWideStable(2000, 200, u)],
  ['wide-stable  (w=1000, iters=500) ', (u) => runWideStable(500, 1000, u)],
  ['branch-flip  (iters=5000)        ', (u) => runBranchFlip(5000, u)],
  ['many-narrow  (n=500,  iters=5000)', (u) => runManyNarrow(5000, 500, u)],
  ['deep-chain   (d=20,   iters=5000)', (u) => runDeepChain(5000, 20, u)],
  ['deep-chain   (d=100,  iters=2000)', (u) => runDeepChain(2000, 100, u)],
]

console.log('\n=== Spec #2 — _compilerSources oracle A/B (median of 15 trials) ===\n')
console.log(
  'Shape'.padEnd(42),
  'Baseline(ms)'.padStart(13),
  'Special(ms)'.padStart(12),
  'Δms'.padStart(8),
  'Δ%'.padStart(8),
  'Verdict'.padStart(10),
)
console.log('-'.repeat(99))

for (const [name, fn] of shapes) {
  const r = runShape(name, fn)
  const verdict = r.dPct < -1 ? 'FASTER' : r.dPct > 1 ? 'SLOWER' : '~same'
  console.log(
    name.padEnd(42),
    r.bMs.toFixed(2).padStart(13),
    r.sMs.toFixed(2).padStart(12),
    r.dMs.toFixed(2).padStart(8),
    `${(r.dPct >= 0 ? '+' : '') + r.dPct.toFixed(1)}%`.padStart(8),
    verdict.padStart(10),
  )
}

console.log('\nPositive Δ = specialized arm SLOWER; negative Δ = faster.\n')
