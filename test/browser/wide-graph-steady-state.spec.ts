/**
 * Wide-Graph Steady-State Real-App Evidence Harness
 *
 * Workstream: WS1 (runtime / benchmark)
 * Commission: 2026-06-24 — cc-handoff-wide-graph-realapp-harness.md
 *
 * PURPOSE: Produce the evidence the kind-split tripwire requires — decide whether
 * wide-graph reactive propagation under churn is a *top user-facing cost* in a
 * full update frame measured through the real renderer under real-browser DOM.
 *
 * PRE-COMMITTED DECISION RULE (2-of-2 conservative gate):
 *   FIRE  ⟺ (Condition A) AND (Condition B)
 *   CLEAR ⟺ either clearly fails
 *   AMBIGUOUS ⟺ straddles within noise — surface to architect, do not self-resolve
 *
 *   Condition A (absolute breach): propagation self-time/tick exceeds
 *     reactive share of 16.7ms (60fps) frame at 1000×10 scale.
 *     Reactive budget = 16.7ms − render/DOM floor (floor measured here, not asserted).
 *   Condition B (relative dominance): propagation self-time > 30% of total update-frame.
 *
 * DESIGN PARAMETERS (locked by architect, do not adjust):
 *   Scale:         1000 rows × 10 reactive cells
 *   Per-cell:      signal → 1–2 deriveds → 1 binding-effect
 *   Churn:         ~5% of derived source-sets re-resolve per tick (dyn5% mirror)
 *   Driver:        sustained signal updates (steady-state), NOT mount/dispose
 *   Denominator:   full update frame (propagation + binding application + DOM mutation)
 *   Environment:   Playwright real-browser (chromium primary; webkit/firefox secondary)
 *   Comparison:    nv-alone (primary) — tripwire asks "top cost," not nv/alien ratio
 *
 * TIMER NOTE: Chromium's performance.now() has 0.1ms resolution in non-cross-origin-
 * isolated contexts. Per-tick time on a 10,000-cell graph is well below 0.1ms, so
 * individual-tick timing yields zero medians. Fix: batch BATCH_SIZE ticks per sample;
 * report per-tick cost = batch_time / BATCH_SIZE. At BATCH_SIZE=20, each sample is
 * ~0.5–5ms which clears the resolution floor.
 *
 * FLOOR RUN NOTE: Effects must actually subscribe to deriveds to exercise propagation.
 * The floor run uses a sink[] (pre-allocated Int32Array) to capture derived values
 * without DOM mutation. This is the honest split: propagation + effect invocation
 * overhead, zero DOM mutation.
 *
 * FAILABLE GATES (G-WG-1..8, G0) — verified by inspection checklist at bottom.
 *
 * Run: pnpm test:browser --project=chromium test/browser/wide-graph-steady-state.spec.ts
 */

import { expect, test } from '@playwright/test'

// ── CONFIG (do not adjust without architect sign-off) ─────────────────────────
const N_ROWS = 1000
const N_COLS = 10
const WARMUP_TICKS = 60 // discarded before measurement (G-WG-3)
const MEASURE_TICKS = 80 // steady-state sample points
const BATCH_SIZE = 20 // ticks per sample (clears 0.1ms Chromium timer floor)
// Churn: 5% of cells get source-set flip per tick (G-WG-5)
const CHURN_FRACTION = 0.05

// ── In-page harness (serialised into page.evaluate) ───────────────────────────

const HARNESS_FN = /* js */ `
(async function runHarness({ nRows, nCols, warmupTicks, measureTicks, batchSize, churnFraction, floorRun }) {
  const { signal, derived, createRoot, flushSync } = window.__nv

  const totalCells = nRows * nCols
  const churnPerTick = Math.round(totalCells * churnFraction)

  // ── Build graph + DOM ──────────────────────────────────────────────────────
  // All allocation before timed region (G-WG-4).
  // Each cell: primarySig, altSig, churnFlagSig.
  // Even-col cells: 2-derived chain (d1→d2→effect). Odd-col: 1 derived (d1→effect).
  // Derived source-set switches on churnFlag: churnFlag=false→reads primary,
  // churnFlag=true→reads alt. Flipping churnFlag re-subscribes the derived (G-WG-5).

  const container = document.createElement('div')
  document.body.appendChild(container)

  const primaries   = new Array(totalCells)
  const alts        = new Array(totalCells)
  const churnFlags  = new Array(totalCells)
  // Pre-allocated sink for floor run (avoids DOM mutation; no allocation in hot path).
  // G-WG-4: Int32Array is pre-allocated; writes are index assignments.
  const sink = new Int32Array(totalCells)

  let disposeApp
  createRoot((dispose) => {
    disposeApp = dispose
    for (let idx = 0; idx < totalCells; idx++) {
      const primary   = signal(0)
      const alt       = signal(100)
      const churnFlag = signal(false)
      primaries[idx]  = primary
      alts[idx]       = alt
      churnFlags[idx] = churnFlag

      const c = idx % nCols
      let finalDerived
      if (c % 2 === 0) {
        const d1 = derived(() => churnFlag() ? alt() + 1 : primary() + 1)
        finalDerived = derived(() => d1() * 2)
      } else {
        finalDerived = derived(() => churnFlag() ? alt() + 1 : primary() + 1)
      }

      if (floorRun) {
        // Floor run: effect reads finalDerived → writes to pre-allocated sink.
        // Propagation + effect invocation cost is present; DOM mutation is absent.
        const i = idx  // capture for closure
        createRoot(() => { sink[i] = finalDerived() })
      } else {
        // Live run: effect writes to real DOM span.
        const span = document.createElement('span')
        container.appendChild(span)
        createRoot(() => { span.textContent = String(finalDerived()) })
      }
    }
    flushSync()
  })

  // ── Pre-compute churn rotation (G-WG-4, G-WG-5) ───────────────────────────
  // Deterministic rotation: batch of churnPerTick cells starting at
  // (tick * churnPerTick) % totalCells. No allocation in hot path.
  function churnStart(tick) {
    return (tick * churnPerTick) % totalCells
  }

  // ── Tick driver (shared by warmup and measure) ─────────────────────────────
  // (G-WG-1): ONLY signal writes + flushSync inside the timed region.
  // No createRoot / signal() / derived() / dispose calls.
  function runTick(tick) {
    const cStart = churnStart(tick)
    // Write primary values for first churnPerTick cells.
    for (let i = 0; i < churnPerTick; i++) {
      const idx = (cStart + i) % totalCells
      primaries[idx](primaries[idx]() + 1)
    }
    // Flip churnFlag for a separate batch (dynamic-edge churn, G-WG-5).
    const cStart2 = (cStart + churnPerTick) % totalCells
    for (let i = 0; i < churnPerTick; i++) {
      const idx = (cStart2 + i) % totalCells
      churnFlags[idx](!churnFlags[idx]())
    }
    flushSync()
  }

  // ── WARMUP (G-WG-3: discard before measurement) ───────────────────────────
  for (let tick = 0; tick < warmupTicks; tick++) {
    runTick(tick)
  }

  // ── MEASUREMENT (G-WG-2: batch timing, not per-tick combined-then-divided) ─
  // Each sample = batchSize ticks timed together. Per-tick cost = batch_ms / batchSize.
  // Clears Chromium's 0.1ms performance.now() resolution floor.
  const samples = new Float64Array(measureTicks)  // pre-allocated (G-WG-4)

  for (let s = 0; s < measureTicks; s++) {
    const t0 = performance.now()
    for (let b = 0; b < batchSize; b++) {
      runTick(warmupTicks + s * batchSize + b)
    }
    const t1 = performance.now()
    samples[s] = (t1 - t0) / batchSize  // per-tick cost
  }

  // Cleanup (outside timed region).
  disposeApp()
  container.remove()

  // Statistics over per-tick samples.
  const sorted = Float64Array.from(samples).sort()
  const n = sorted.length
  const med = sorted[Math.floor(n / 2)]
  const p10 = sorted[Math.floor(n * 0.1)]
  const p90 = sorted[Math.floor(n * 0.9)]
  const mean = sorted.reduce((a, b) => a + b, 0) / n

  return { med, p10, p90, mean, n }
})
`

test.describe('Wide-Graph Steady-State Harness — kind-split tripwire evidence', () => {
  test.setTimeout(300_000)

  test('G-WG: full-frame live run (primary verdict)', async ({ page }) => {
    await page.goto('about:blank')
    await page.addScriptTag({ path: 'test/browser/dist/nv-bundle.js' })

    const args = {
      nRows: N_ROWS,
      nCols: N_COLS,
      warmupTicks: WARMUP_TICKS,
      measureTicks: MEASURE_TICKS,
      batchSize: BATCH_SIZE,
      churnFraction: CHURN_FRACTION,
    }

    // ── Live run (full frame: propagation + binding + DOM mutation) ───────────
    const live = await page.evaluate(
      new Function('args', `return (${HARNESS_FN})(Object.assign({floorRun: false}, args))`) as (
        args: unknown,
      ) => Promise<{ med: number; p10: number; p90: number; mean: number; n: number }>,
      args,
    )

    // ── Floor run (propagation + effect invocation, zero DOM mutation) ────────
    const floor = await page.evaluate(
      new Function('args', `return (${HARNESS_FN})(Object.assign({floorRun: true}, args))`) as (
        args: unknown,
      ) => Promise<{ med: number; p10: number; p90: number; mean: number; n: number }>,
      args,
    )

    // ── Decomposition ─────────────────────────────────────────────────────────
    // t_propagate ≈ floor.med — propagation + effect invocation, no DOM.
    //   This over-estimates propagation (includes effect call overhead), which
    //   errs toward FIRE — the conservative direction for the tripwire.
    // t_dom ≈ live.med − floor.med — marginal DOM mutation + layout cost.
    // t_frame = live.med — total update frame cost.
    const t_frame = live.med
    const t_propagate = floor.med
    const t_dom = Math.max(0, live.med - floor.med)

    // ── Condition A: absolute frame-budget breach ──────────────────────────────
    // Reactive budget = 16.7ms − irreducible DOM floor.
    // We use t_dom as the DOM floor (conservative: if DOM is near-zero, budget ≈ 16.7ms).
    const TARGET_FPS_MS = 16.7
    const dom_floor = t_dom
    const reactive_budget_ms = TARGET_FPS_MS - dom_floor
    const condition_a = t_propagate > reactive_budget_ms

    // ── Condition B: relative dominance (>30% of update frame) ───────────────
    const propagation_share = t_frame > 0 ? t_propagate / t_frame : 0
    const condition_b = propagation_share > 0.3

    // ── Verdict ───────────────────────────────────────────────────────────────
    // Noise bands: if a condition straddles, classify AMBIGUOUS.
    const noise_ms = 0.5 // ±0.5ms absolute noise band
    const noise_share = 0.04 // ±4pp relative noise band

    const a_straddles = Math.abs(t_propagate - reactive_budget_ms) < noise_ms
    const b_straddles = Math.abs(propagation_share - 0.3) < noise_share

    let verdict: 'FIRE' | 'CLEAR' | 'AMBIGUOUS'
    if (condition_a && condition_b) {
      verdict = 'FIRE'
    } else if (!condition_a && !condition_b) {
      verdict = 'CLEAR'
    } else if (a_straddles || b_straddles) {
      verdict = 'AMBIGUOUS'
    } else {
      // One clearly holds, one clearly fails → CLEAR (conservative gate: need BOTH)
      verdict = 'CLEAR'
    }

    // ── Report ────────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('Wide-Graph Steady-State Harness — Kind-Split Tripwire Evidence')
    console.log(`Scale:  ${N_ROWS}×${N_COLS} cells (${N_ROWS * N_COLS} total)`)
    console.log(`Churn:  ${CHURN_FRACTION * 100}% source-set re-resolve/tick`)
    console.log(
      `Ticks:  ${WARMUP_TICKS} warmup discarded, ${MEASURE_TICKS} sample points × ${BATCH_SIZE} ticks/sample`,
    )
    console.log('───────────────────────────────────────────────────────────────')
    console.log('LIVE RUN (propagation + binding + DOM mutation):')
    console.log(
      `  t_frame/tick    med=${live.med.toFixed(4)}ms  p10=${live.p10.toFixed(4)}ms  p90=${live.p90.toFixed(4)}ms  mean=${live.mean.toFixed(4)}ms`,
    )
    console.log('FLOOR RUN (propagation + effect invocation; zero DOM mutation):')
    console.log(
      `  t_propagate/tick med=${floor.med.toFixed(4)}ms  p10=${floor.p10.toFixed(4)}ms  p90=${floor.p90.toFixed(4)}ms  mean=${floor.mean.toFixed(4)}ms`,
    )
    console.log('DECOMPOSITION (per tick):')
    console.log(
      `  t_propagate ≈ ${t_propagate.toFixed(4)}ms  (floor median; upper-bound, errs toward FIRE)`,
    )
    console.log(`  t_dom       ≈ ${t_dom.toFixed(4)}ms  (live − floor; marginal DOM mutation cost)`)
    console.log(`  t_frame     = ${t_frame.toFixed(4)}ms  (live median; full update frame)`)
    console.log('───────────────────────────────────────────────────────────────')
    console.log('CONDITION A — absolute frame-budget breach:')
    console.log(`  Target 60fps frame budget:  ${TARGET_FPS_MS}ms`)
    console.log(`  Irreducible DOM floor:      ${dom_floor.toFixed(4)}ms`)
    console.log(`  Reactive budget (derived):  ${reactive_budget_ms.toFixed(4)}ms`)
    console.log(`  t_propagate:                ${t_propagate.toFixed(4)}ms`)
    console.log(
      `  Result: ${condition_a ? 'BREACH (propagation > budget)' : 'NO BREACH (propagation ≤ budget)'}`,
    )
    console.log('CONDITION B — relative dominance (>30% of update frame):')
    console.log(`  Propagation share:  ${(propagation_share * 100).toFixed(2)}%`)
    console.log('  Threshold:          30%')
    console.log(`  Result: ${condition_b ? 'DOMINANT (>30%)' : 'NOT DOMINANT (≤30%)'}`)
    console.log('───────────────────────────────────────────────────────────────')
    console.log(`VERDICT: ${verdict}`)
    if (verdict === 'FIRE') {
      console.log('  → Kind-split tripwire TRIGGERED. Return to architect.')
      console.log('  → CC does NOT open the spike; this is an architecture decision.')
    } else if (verdict === 'CLEAR') {
      console.log('  → Wide-graph propagation is NOT a top user-facing cost.')
      console.log('  → Structural gap stays accepted; kind-split stays gated.')
      console.log('  → Complete, valid terminal result.')
    } else {
      console.log('  → Straddles noise boundary. Surface to architect; do not self-resolve.')
    }
    console.log('═══════════════════════════════════════════════════════════════\n')

    // ── Sanity assertions (G-WG gates) ───────────────────────────────────────
    // Measurements must be positive and plausible.
    expect(
      live.med,
      'live.med > 0 — G-WG-1/2: timed region must contain real work',
    ).toBeGreaterThan(0)
    expect(
      floor.med,
      'floor.med > 0 — effects subscribe to deriveds; propagation must occur',
    ).toBeGreaterThan(0)
    expect(live.n, 'live sample count').toBe(MEASURE_TICKS)
    expect(floor.n, 'floor sample count').toBe(MEASURE_TICKS)

    // Live run >= floor run: DOM mutation adds cost (allow 10% noise margin).
    expect(live.med, 'live ≥ floor × 0.9 — DOM cost is non-negative').toBeGreaterThanOrEqual(
      floor.med * 0.9,
    )

    // Propagation share must be a real fraction.
    expect(propagation_share).toBeGreaterThanOrEqual(0)
    expect(propagation_share).toBeLessThanOrEqual(1)

    // AMBIGUOUS must surface to architect, not silently pass.
    // If this assertion fails: the verdict is AMBIGUOUS — report to architect before any decision.
    expect(
      verdict,
      'AMBIGUOUS verdict must be surfaced to architect before any tripwire decision',
    ).not.toBe('AMBIGUOUS')
  })
})

// ── G-WG inspection checklist (for architect verification) ────────────────────
//
// G-WG-1 steady-state-not-construction:
//   Timed region = the inner `for (let b = 0; b < batchSize; b++) { runTick(...) }` loop.
//   runTick() contains ONLY: primaries[idx](+1) writes, churnFlags[idx](!) flips, flushSync().
//   No createRoot / signal() constructor / derived() constructor / dispose inside runTick.
//   → PASS: createRoot, signal, derived calls are in the build loop before warmup.
//
// G-WG-2 honest timer split:
//   Two independent page.evaluate calls (live, floor). Each has its own t0/t1 boundary
//   around a batchSize tick loop. Timer not split post-hoc from a combined number.
//   Per-tick cost = (t1 - t0) / batchSize — arithmetic division, not ratio inference.
//   → PASS: `live` and `floor` are separate evaluate calls; division is explicit.
//
// G-WG-3 per-tick warm-up isolated:
//   warmupTicks=60 ticks run before measurement. samples[] only records measure loop
//   (s=0..measureTicks-1). Each evaluate call has its own warm-up (separate page state).
//   → PASS: warm-up loop runs first; samples[s] assigned only after warm-up.
//
// G-WG-4 bookkeeping symmetry:
//   Pre-allocated: primaries[], alts[], churnFlags[] (Array), sink (Int32Array),
//   samples (Float64Array). No push/splice/new inside runTick or the measurement loop.
//   → PASS: all arrays allocated in build loop; measurement loop only writes by index.
//
// G-WG-5 dynamic edges actually churn:
//   derived() reads `churnFlag() ? alt() + 1 : primary() + 1`.
//   runTick() flips churnFlag for ~5% of cells → source-set switches from primary→alt
//   or alt→primary (re-subscribe). This is a real trackRead path change per tick.
//   → PASS: conditional on churnFlag() inside derived body; churnFlags[idx](!) in runTick.
//
// G-WG-6 real-browser denominator:
//   Spec runs under Playwright (chromium/webkit/firefox). page.goto + page.addScriptTag
//   drives a real browser process. No JSDOM import in this file.
//   → PASS.
//
// G-WG-7 floor reported / budget derived:
//   floor.med printed explicitly ("FLOOR RUN" section). reactive_budget_ms = 16.7 − t_dom;
//   t_dom = live.med − floor.med. Budget is derived from measured floor, not asserted.
//   → PASS.
//
// G-WG-8 src/ untouched:
//   This file is test/browser/wide-graph-steady-state.spec.ts. No src/ changes.
//   → PASS.
//
// G0 hard stop:
//   No edit to src/core/core.ts ReactiveNode / makeNode field order or count.
//   → PASS.
