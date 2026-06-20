/**
 * Row-Churn Harness — perf tripwires #1 (createSignals) + #2 (FALSE-heavy churn)
 *
 * Run: node --expose-gc bench/row-churn.mjs
 *
 * Variants (each profiled independently, single-hypothesis discipline):
 *   A — reactive-only, nv vs alien-signals  (gap-ratio test; fires/clears tripwire #1)
 *   B — full nv row via real emitMount      (absolute budget; binding/mount share)
 *   C — FALSE-heavy row, nv-only            (HC-perturbation under churn; tripwire #2)
 *
 * Row unit (spec §3):
 *   N_SIGNALS signals + N_DERIVEDS deriveds + (B/C) 1 AttrBinding + 1 TextBinding
 *   + 1 EventBinding via real emitMount. Each row owns its reactive state inside
 *   an outer createRoot; emitMount's inner createRoot is a child of it.
 *
 * Methodology:
 *   - Full create→dispose cycles: build N rows, dispose all N, repeat M trials.
 *   - Discard WARMUP leading trials; report median + p10–p90 spread of steady-state.
 *   - No-leak assertion after each cycle via __test.sourceCount / observerCount.
 *     Also asserts container.children.length === 0 for B/C after disposal.
 *   - Profile attribution via --prof is out-of-band; this script measures wall-clock.
 *     Run `node --prof bench/row-churn.mjs && node --prof-process isolate-*.log` to
 *     attribute hot paths to WeakMap.set / fn.set / effect creation / dispose walk.
 *
 * Parameters (§CONFIG — edit to sweep one dimension at a time):
 *   N_ROWS      rows per cycle (100 / 1000 / 10000)
 *   N_SIGNALS   signals per row (2 default; 4 adversarial)
 *   N_DERIVEDS  deriveds per row (2 default; 0 adversarial strips dilution; 4 extended)
 *   FALSE_COUNT (variant C) FALSE signals/row: 0 baseline | 1 realistic | 'all' worst-case
 *
 * Environment (pin for comparability):
 *   alien-signals 3.1.2  |  Node v20.19.0  |  M2 Max
 */

import { computed as aComputed, signal as aSignal, effectScope } from 'alien-signals'
import { JSDOM } from 'jsdom'
import { emitMount } from '../dist/compiler/emitted-mount.js'
import { __test, createRoot, derived, flushSync, signal } from '../dist/core/core.js'
import { createHtmlTag } from '../dist/renderer/html-tag.js'

// ── §CONFIG ───────────────────────────────────────────────────────────────────
// Sweep one dimension at a time; keep others at default.

const WARMUP = 6 // leading trials to discard
const TRIALS = 20 // steady-state trials (median over these)

const N_ROWS = 1000 // rows per cycle: 100 | 1000 | 10000
const N_SIGNALS = 2 // signals/row:   2 (default) | 4
const N_DERIVEDS = 2 // deriveds/row:  2 (default) | 0 (adversarial, strips dilution) | 4
const FALSE_COUNT = 0 // (variant C) FALSE signals/row: 0 | 1 | 'all'

// ── Helpers ───────────────────────────────────────────────────────────────────

const GC = typeof globalThis.gc === 'function' ? globalThis.gc : () => {}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b)
  const med = s[Math.floor(s.length / 2)]
  const p10 = s[Math.floor(s.length * 0.1)]
  const p90 = s[Math.floor(s.length * 0.9)]
  return { med, p10, p90, n: s.length }
}

function fmt(ms) {
  return ms < 0.01
    ? `${(ms * 1_000_000).toFixed(0)} ns`
    : ms < 1
      ? `${(ms * 1000).toFixed(1)} µs`
      : `${ms.toFixed(3)} ms`
}

function fmtStats(label, s, suffix = '') {
  console.log(
    `  ${label.padEnd(40)} med=${fmt(s.med)}  p10–p90=[${fmt(s.p10)}–${fmt(s.p90)}]${suffix}`,
  )
}

// ── No-leak check ─────────────────────────────────────────────────────────────

/**
 * After each cycle, assert every reactive fn created in that cycle has zero
 * source edges and zero observer edges. A leak invalidates the disposal timing.
 */
function assertNoLeak(fns, label) {
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]
    const sc = __test.sourceCount(fn)
    const oc = __test.observerCount(fn)
    if (sc !== 0 || oc !== 0) {
      throw new Error(
        `[row-churn] LEAK in ${label}: fn[${i}] sourceCount=${sc} observerCount=${oc} after dispose`,
      )
    }
  }
}

// ── Row IR builder (B/C) ──────────────────────────────────────────────────────
// Build the per-row IR with closures over the row's own signals/deriveds.
// Template: <li class={rowCls}>{label}<button>x</button></li>
//   bindingPaths[0] = li element       → AttrBinding (class)
//   bindingPaths[1] = li.childNodes[0] → TextBinding  (label, comment sentinel)
//   bindingPaths[2] = li.childNodes[1] → EventBinding (button, after text anchor)
//
// emitMount is called per row (per-row closures require per-row IR).
// The compile step (emitMount) is O(bindings) closure creation — fast relative to
// mountFn's createRoot + cloneNode + effect wiring.

function buildAndMountRow(r, clsSig, labelSig, container, document, html) {
  const rowCls = derived(() => `${clsSig()}-active`)
  const display = derived(() => `${labelSig()}!`)

  const baseIR = html`<li class="${() => rowCls()}">${() => display()}<button>x</button></li>`
  // Append EventBinding: button is childNodes[1] of li (after the <!--nv-N--> text anchor).
  const ir = {
    ...baseIR,
    id: `row-${r}`,
    shape: {
      ...baseIR.shape,
      bindingPaths: [...baseIR.shape.bindingPaths, [0, 1]],
    },
    bindings: [
      ...baseIR.bindings,
      {
        kind: 'event',
        pathIndex: 2,
        eventName: 'click',
        handler: () => () => {},
        handlerKind: 'reactive',
      },
    ],
  }

  const { mountFn } = emitMount(ir)
  // mountFn's internal createRoot becomes a child of the caller's scope.
  mountFn(container, document)

  return [rowCls, display]
}

// ── Variant A — reactive-only, nv vs alien ────────────────────────────────────
// Each "row" = N_SIGNALS signals + N_DERIVEDS deriveds.
// nv: wrapped in createRoot; disposed via the returned dispose fn.
// alien: wrapped in effectScope(fn); disposed via stop().
// No bindings, no DOM — pure reactive construction + disposal cost.
// Adversarial case: N_DERIVEDS=0 strips dilution and isolates bare-signal cost.
//
// Timer discipline: construction-loop and dispose-loop are timed SEPARATELY for
// both sides. The construction-only ratio is the primary tripwire #1 number.
// Disposal-only ratio is a real but separate cost. Combined is shown for reference
// only and is explicitly labeled as conflated.
//
// Bookkeeping symmetry: both sides push N_SIGNALS + N_DERIVEDS refs per row to a
// tracking array inside the timed region. This ensures array.push overhead is
// identical on both sides and does not bias the construction ratio against nv.

function runVariantA() {
  console.log('\n── Variant A: reactive-only, nv vs alien-signals ────────────────────────')
  console.log(`   N=${N_ROWS} rows/cycle  signals/row=${N_SIGNALS}  deriveds/row=${N_DERIVEDS}`)
  console.log(`   Warmup=${WARMUP}  Trials=${TRIALS}`)
  if (N_DERIVEDS === 0) {
    console.log('   [adversarial: 0 deriveds strips dilution — isolates bare-signal cost]')
  }

  const nvCreateSamples = []
  const nvDisposeSamples = []
  const alCreateSamples = []
  const alDisposeSamples = []

  for (let trial = 0; trial < WARMUP + TRIALS; trial++) {
    GC()

    // ── nv ────────────────────────────────────────────────────────────────────
    const nvFns = []
    const nvDisposes = []

    const t0nvCreate = performance.now()
    for (let r = 0; r < N_ROWS; r++) {
      const dispose = createRoot((d) => {
        const sigs = []
        for (let si = 0; si < N_SIGNALS; si++) {
          const sig = signal(r * N_SIGNALS + si)
          sigs.push(sig)
          nvFns.push(sig) // N_SIGNALS pushes/row (symmetric with alien below)
        }
        for (let di = 0; di < N_DERIVEDS; di++) {
          const src = sigs[di % N_SIGNALS]
          const der = derived(() => src() + 1)
          der() // pull to CLEAN (initialize lazy derived)
          nvFns.push(der) // N_DERIVEDS pushes/row (symmetric with alien below)
        }
        return d
      })
      nvDisposes.push(dispose)
    }
    const t1nvCreate = performance.now()

    const t0nvDispose = performance.now()
    for (let r = 0; r < N_ROWS; r++) nvDisposes[r]()
    const t1nvDispose = performance.now()

    assertNoLeak(nvFns, 'variant-A-nv')
    if (trial >= WARMUP) {
      nvCreateSamples.push(t1nvCreate - t0nvCreate)
      nvDisposeSamples.push(t1nvDispose - t0nvDispose)
    }

    // ── alien ─────────────────────────────────────────────────────────────────
    // alienFns mirrors nvFns: N_SIGNALS + N_DERIVEDS pushes/row so both sides
    // pay identical array.push overhead inside the timed region.
    const alienFns = []
    const alienStops = []

    const t0alCreate = performance.now()
    for (let r = 0; r < N_ROWS; r++) {
      const rowSigs = []
      const stop = effectScope(() => {
        for (let si = 0; si < N_SIGNALS; si++) {
          const s = aSignal(r * N_SIGNALS + si)
          rowSigs.push(s)
          alienFns.push(s) // N_SIGNALS pushes/row (symmetric)
        }
        for (let di = 0; di < N_DERIVEDS; di++) {
          const src = rowSigs[di % N_SIGNALS]
          const comp = aComputed(() => src() + 1)
          comp() // initialize
          alienFns.push(comp) // N_DERIVEDS pushes/row (symmetric)
        }
      })
      alienStops.push(stop)
    }
    const t1alCreate = performance.now()

    const t0alDispose = performance.now()
    for (let r = 0; r < N_ROWS; r++) alienStops[r]()
    const t1alDispose = performance.now()

    if (trial >= WARMUP) {
      alCreateSamples.push(t1alCreate - t0alCreate)
      alDisposeSamples.push(t1alDispose - t0alDispose)
    }
  }

  const nvCrS = stats(nvCreateSamples)
  const nvDiS = stats(nvDisposeSamples)
  const alCrS = stats(alCreateSamples)
  const alDiS = stats(alDisposeSamples)

  const createRatio = nvCrS.med / alCrS.med
  const disposeRatio = nvDiS.med / alDiS.med
  const combinedRatio = (nvCrS.med + nvDiS.med) / (alCrS.med + alDiS.med)

  console.log('  construction (create-loop only):')
  fmtStats('    nv  (createRoot+signal×N+derived×M)', nvCrS)
  fmtStats('    alien (effectScope+signal×N+computed×M)', alCrS)
  console.log(
    `  ${'    ratio nv/alien [CONSTRUCTION — tripwire #1]'.padEnd(46)} ${createRatio.toFixed(2)}x`,
  )
  console.log(`  ${'    per-row nv'.padEnd(46)} ${fmt(nvCrS.med / N_ROWS)}/row`)
  console.log(`  ${'    per-row alien'.padEnd(46)} ${fmt(alCrS.med / N_ROWS)}/row`)

  console.log('  disposal (dispose-loop only):')
  fmtStats('    nv  (dispose×N)', nvDiS)
  fmtStats('    alien (stop×N)', alDiS)
  console.log(
    `  ${'    ratio nv/alien [DISPOSAL — separate cost]'.padEnd(46)} ${disposeRatio.toFixed(2)}x`,
  )

  console.log(
    `  ${'  combined (ref only — construction+disposal)'.padEnd(46)} nv/alien=${combinedRatio.toFixed(2)}x`,
  )

  return { nvCrS, nvDiS, alCrS, alDiS, createRatio, disposeRatio, combinedRatio }
}

// ── Variant B — full nv row via real emitMount ────────────────────────────────
// Per-row: outer createRoot owns signals + deriveds.
// Inside outer root: emitMount(per-row IR) → mountFn → inner createRoot (child of outer).
// Outer dispose cascades into inner dispose, cleaning effects + DOM.
// Timing covers: signal creation + derived creation + emitMount + mountFn + flushSync share + dispose.
//
// JSDOM caveat: emitMount's setup() calls doc.createElement('template') + innerHTML + cloneNode
// on EVERY mountFn call — one parse per row per cycle. JSDOM's parse5 is 5–15x slower than a
// real browser parser, so B's absolute number is JSDOM-inflated. A template-clone diagnostic
// (below) isolates that cost. The ratio B/A (binding share vs reactive share) is the useful
// output; the absolute B number should not drive any architectural decision without a real-browser
// confirmation. (The spec notes this: "numbers come from CC on real hardware" — the sandbox JSDOM
// numbers are known to be unreliable proxies for browser DOM performance.)

function measureTemplateCloneCost(document, shapeHtml) {
  // Isolate per-row template parse + clone cost (what setup() does before any reactive work).
  const CLONE_N = N_ROWS
  const CLONE_TRIALS = 10
  const samples = []
  for (let t = 0; t < CLONE_TRIALS; t++) {
    const t0 = performance.now()
    for (let i = 0; i < CLONE_N; i++) {
      const tmpl = document.createElement('template')
      tmpl.innerHTML = shapeHtml
      tmpl.content.cloneNode(true)
    }
    samples.push(performance.now() - t0)
  }
  return stats(samples)
}

function runVariantB() {
  console.log('\n── Variant B: full nv row (per-row signals + real emitMount) ─────────────')
  console.log(`   N=${N_ROWS} rows/cycle`)
  console.log(
    `   Row: ${N_SIGNALS} signals + ${N_DERIVEDS} deriveds + AttrBinding + TextBinding + EventBinding`,
  )
  console.log(`   Warmup=${WARMUP}  Trials=${TRIALS}`)
  console.log('   NOTE: absolute times are JSDOM-inflated (template re-parse per row).')
  console.log('         B/A ratio (binding-share vs reactive-share) is the useful output.')

  const { document } = new JSDOM('').window
  const html = createHtmlTag(document)
  const container = document.createElement('ul')

  // Diagnostic: isolate template-parse+clone overhead before main loop.
  // emitMount's setup() does createElement('template')+innerHTML+cloneNode per mountFn call.
  const probeIR = html`<li class="${() => ''}">text<button>x</button></li>`
  const cloneS = measureTemplateCloneCost(document, probeIR.shape.html)
  const clonePerRow = cloneS.med / N_ROWS
  fmtStats('  [JSDOM template-parse+clone only (overhead)]', {
    med: clonePerRow,
    p10: cloneS.p10 / N_ROWS,
    p90: cloneS.p90 / N_ROWS,
    n: cloneS.n,
  })

  const samples = []

  for (let trial = 0; trial < WARMUP + TRIALS; trial++) {
    GC()

    const outerDisposes = []
    const allFns = []

    const t0 = performance.now()
    for (let r = 0; r < N_ROWS; r++) {
      const disposeOuter = createRoot((d) => {
        // Per-row reactive state — owned by this outer root.
        const sigs = []
        for (let si = 0; si < N_SIGNALS; si++) {
          const sig = signal(r * N_SIGNALS + si)
          sigs.push(sig)
          allFns.push(sig)
        }
        const deriveds = []
        for (let di = 0; di < N_DERIVEDS; di++) {
          const src = sigs[di % N_SIGNALS]
          const der = derived(() => src() + 1)
          der()
          deriveds.push(der)
          allFns.push(der)
        }

        // Use the first signal as cls source, first derived (or signal) as label source.
        const clsSrc = sigs[0]
        const labelSrc = deriveds[0] ?? sigs[0]
        const extraDers = buildAndMountRow(r, clsSrc, labelSrc, container, document, html)
        for (const d of extraDers) allFns.push(d)

        return d
      })
      outerDisposes.push(disposeOuter)
    }
    flushSync()
    for (let r = 0; r < N_ROWS; r++) outerDisposes[r]()
    const t1 = performance.now()

    assertNoLeak(allFns, 'variant-B')
    if (container.children.length !== 0) {
      throw new Error(
        `[row-churn] LEAK in variant-B: ${container.children.length} children remain after dispose`,
      )
    }

    if (trial >= WARMUP) samples.push(t1 - t0)
  }

  const s = stats(samples)
  fmtStats('nv full row (reactive + emitMount + dispose)', s)
  const perRow = s.med / N_ROWS
  console.log(`  ${'per-row'.padEnd(40)} ${fmt(perRow)}/row`)
  console.log(
    `  ${'  of which: JSDOM template overhead (est.)'.padEnd(40)} ${fmt(clonePerRow)}/row  (${((clonePerRow / perRow) * 100).toFixed(0)}% of B)`,
  )
  console.log(
    `  ${'  of which: DOM-ops+wiring+reactive (est.)'.padEnd(40)} ${fmt(Math.max(0, perRow - clonePerRow))}/row`,
  )

  return s
}

// ── Variant C — FALSE-heavy row, nv-only ──────────────────────────────────────
// Same as B but the first falseN signals in each row carry setCompilerEquals(fn, false).
// This applies the HC-transition at signal construction time (= real emitter behavior).
// Reports delta vs B baseline to isolate the churn-time multiplier.
//
// FALSE_COUNT ∈ { 0, 1, 'all' }:
//   0    = baseline (identical to B — cross-check delta should be ≈ 0%)
//   1    = realistic-pessimistic — ONE mutated-container signal per row
//   'all'= adversarial worst-case — ALL signals in the row are FALSE-annotated

function runVariantC(variantBMedian) {
  const falseN = FALSE_COUNT === 'all' ? N_SIGNALS : Math.min(Number(FALSE_COUNT), N_SIGNALS)

  console.log('\n── Variant C: FALSE-heavy row, nv-only ──────────────────────────────────')
  console.log(
    `   N=${N_ROWS} rows/cycle  FALSE signals/row=${falseN}/${N_SIGNALS}  (FALSE_COUNT=${FALSE_COUNT})`,
  )
  console.log(
    '   [0=baseline; 1=realistic-pessimistic (the judgment cell); all=adversarial bracket]',
  )
  console.log(`   Warmup=${WARMUP}  Trials=${TRIALS}`)

  const { document } = new JSDOM('').window
  const html = createHtmlTag(document)
  const container = document.createElement('ul')

  const samples = []

  for (let trial = 0; trial < WARMUP + TRIALS; trial++) {
    GC()

    const outerDisposes = []
    const allFns = []

    const t0 = performance.now()
    for (let r = 0; r < N_ROWS; r++) {
      const disposeOuter = createRoot((d) => {
        const sigs = []
        for (let si = 0; si < N_SIGNALS; si++) {
          const sig = signal(r * N_SIGNALS + si)
          // Apply FALSE annotation to the first falseN signals — same as emitter output
          // for signals whose values are mutable containers (EqualityPolicy.FALSE verdict).
          if (si < falseN) {
            __test.setCompilerEquals(sig, false)
          }
          sigs.push(sig)
          allFns.push(sig)
        }
        const deriveds = []
        for (let di = 0; di < N_DERIVEDS; di++) {
          const src = sigs[di % N_SIGNALS]
          const der = derived(() => src() + 1)
          der()
          deriveds.push(der)
          allFns.push(der)
        }

        const clsSrc = sigs[0]
        const labelSrc = deriveds[0] ?? sigs[0]
        const extraDers = buildAndMountRow(r, clsSrc, labelSrc, container, document, html)
        for (const d of extraDers) allFns.push(d)

        return d
      })
      outerDisposes.push(disposeOuter)
    }
    flushSync()
    for (let r = 0; r < N_ROWS; r++) outerDisposes[r]()
    const t1 = performance.now()

    assertNoLeak(allFns, `variant-C-false${falseN}`)
    if (container.children.length !== 0) {
      throw new Error(
        `[row-churn] LEAK in variant-C: ${container.children.length} children remain after dispose`,
      )
    }

    if (trial >= WARMUP) samples.push(t1 - t0)
  }

  const s = stats(samples)
  fmtStats(`nv FALSE-row (false=${falseN}/${N_SIGNALS} signals)`, s)
  console.log(`  ${'per-row'.padEnd(40)} ${fmt(s.med / N_ROWS)}/row`)

  if (variantBMedian !== undefined) {
    const delta = ((s.med - variantBMedian) / variantBMedian) * 100
    console.log(
      `  ${'delta vs B baseline (0 FALSE)'.padEnd(40)} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%` +
        `  (${fmt(s.med)} vs ${fmt(variantBMedian)})`,
    )
    if (falseN === 1) {
      console.log('  [realistic-pessimistic cell: this delta drives tripwire #2 judgment]')
    }
    if (FALSE_COUNT === 'all') {
      console.log('  [worst-case bracket: must NOT drive the judgment on its own]')
    }
  }

  return s
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('=== Row-Churn Harness (perf tripwires #1 + #2) ===')
console.log(`alien-signals 3.1.2  |  Node ${process.version}`)
console.log(
  `N_ROWS=${N_ROWS}  N_SIGNALS=${N_SIGNALS}  N_DERIVEDS=${N_DERIVEDS}  FALSE_COUNT=${FALSE_COUNT}`,
)
console.log('Sweep one dimension at a time; re-run for each §6 cell.')

const resA = runVariantA()
const resB = runVariantB()
const _resC = runVariantC(resB.med)

console.log('\n=== Summary ===')
console.log(
  `Variant A construction ratio nv/alien: ${resA.createRatio.toFixed(2)}x` +
    `  (nv=${fmt(resA.nvCrS.med)} alien=${fmt(resA.alCrS.med)})`,
)
console.log(
  `Variant A disposal   ratio nv/alien: ${resA.disposeRatio.toFixed(2)}x` +
    `  (nv=${fmt(resA.nvDiS.med)} alien=${fmt(resA.alDiS.med)})`,
)
console.log(
  `Variant A combined   ratio (ref):    ${resA.combinedRatio.toFixed(2)}x  (construction+disposal conflated)`,
)
console.log(
  `Variant B full-row med:               ${fmt(resB.med)}  (${fmt(resB.med / N_ROWS)}/row)`,
)
const baRatio = resB.med / resA.nvCrS.med
console.log(`Variant B/A ratio (binding+mount vs reactive construction): ${baRatio.toFixed(0)}x`)
console.log()
console.log('Outcome routing (spec §8):')
console.log(
  `  Tripwire #1: construction ratio = ${resA.createRatio.toFixed(2)}x  (hint: ≤1.5 likely clear; ≤3.0 borderline; >3.0 material gap — confirm via --prof)`,
)
console.log('  --prof required before verdict: construction wall-clock alone cannot distinguish')
console.log(
  '  WeakMap.set + fn.set cost from createRoot scope overhead, GC pressure, or JIT warm-up.',
)
console.log(
  '  Run: node --prof bench/row-churn.mjs && node --prof-process isolate-*.log | head -80',
)
console.log('  Tripwire #2: inspect delta-vs-B in Variant C. The 1-FALSE cell drives the judgment.')
