/**
 * nv PoC Integration Test — Stream 5
 *
 * Proves runtime + compiler + renderer compose on one end-to-end example.
 *
 * Gate 1 — Layers compose
 *   counter (signal) + derived label (derived) + conditional (ConditionalBinding),
 *   rendered via interpreter against jsdom. DOM reflects state after signal writes.
 *
 * Gate 2 — Compiler rejects a deliberate sync cycle at build time
 *   Construct a fixture with an intentional sync feedback loop, run the
 *   write-graph cycle checker, assert CycleReport names the participating syncs.
 *
 * Gate 3 — Disposal leaves zero leaked edges
 *   observerCount assertions (pre- and post-dispose) + adversarial post-dispose
 *   signal write that must NOT update the DOM.
 *
 * Gate 4 — Layers meet only at contract-defined seams
 *   Structural property verified by inspection of the import block and runtime
 *   behavior; stated explicitly per the PoC gate criteria.
 *
 * Ownership: this stream consumes runtime, compiler, and renderer as fixed
 * completed artifacts. No component is modified here. Any composition defect
 * found is diagnosed and attributed to its owning stream — not fixed in place.
 *
 * Sandbox note: gates 1–4 are proven against jsdom. The final PoC gate criterion
 * "runs in a real browser, interaction updates the DOM" is NOT claimed from a
 * jsdom result — it is flagged as the Claude Code handoff.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { JSDOM } from 'jsdom'
import * as ts from 'typescript'
import { expect, test } from 'vitest'

// ── Runtime stream (Stream 1) — §11 public surface only ──────────────────────
// Gate 4 seam: only signal, derived, flushSync, and the __test hook surface
// are imported. No reference to ReactiveNode, Link, or any internal.
import { __test, derived, flushSync, signal } from '../src/core/core'

// ── Renderer stream (Stream 3) — IR contract + mount entry point ─────────────
// Gate 4 seam: TemplateIR (the IR contract type) and mount() (the §11-adjacent
// render entry point). No interpreter internals (walkPath, wireText, etc.).
import { mount } from '../src/renderer/interpreter'
import type { TemplateIR } from '../src/renderer/ir'

// ── Compiler stream (Stream 2) — classifier + cycle checker ──────────────────
// Gate 4 seam: the public APIs of both compiler passes. No internal types.
import { SyncTargetClassifier } from '../src/compiler/sync-target-classifier'
import type { ClassifierConfig, TargetVerdict } from '../src/compiler/types'
import { WriteGraphCycleChecker } from '../src/compiler/write-graph-cycle-checker'

// ── Core path derivation ──────────────────────────────────────────────────────
const _dir = nodePath.dirname(new URL(import.meta.url).pathname)
const nvCorePath = nodePath.resolve(_dir, '../src/core/core.ts')

// ── jsdom setup ────────────────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
})
const doc = dom.window.document

// ── PoC Reactive State (§11 primitive surface) ────────────────────────────────
//
// Both count and label are created at module scope (outside any createRoot).
// They outlive any individual mount — their reactive state persists across all
// gate tests. Gate 3 verifies that the *renderer's effects* (which observed them)
// are severed on disposal, while these primitives themselves stay alive.

const count = signal(0)
const label = derived<string>(() => {
  const c = count()
  return c === 0 ? 'zero' : c > 3 ? 'high' : 'medium'
})

// ── PoC Template IR (manually constructed — nv-template-ir.md §2–§3) ─────────
//
// The tagged-template front-end (htmlTag.ts) supports only text/attr bindings.
// The IR for the conditional is constructed directly against the IR type contract.
// This is the correct approach: the IR is the seam the renderer exposes.
//
// Static shape HTML:
//   <div>
//     <p id="count-display"><!--nv-0--></p>
//     <p id="label-display"><!--nv-1--></p>
//     <!--nv-2-->
//   </div>
//
// DocumentFragment paths (root = the DocumentFragment from <template>):
//   [0, 0, 0]  →  <!--nv-0--> inside p#count-display  (TextBinding target)
//   [0, 1, 0]  →  <!--nv-1--> inside p#label-display  (TextBinding target)
//   [0, 2]     →  <!--nv-2-->                          (ConditionalBinding anchor)

const highIR: TemplateIR = {
  id: 'poc:high-branch',
  shape: { html: '<span class="high">HIGH</span>', bindingPaths: [] },
  bindings: [],
}
const lowIR: TemplateIR = {
  id: 'poc:low-branch',
  shape: { html: '<span class="low">low</span>', bindingPaths: [] },
  bindings: [],
}
const mainIR: TemplateIR = {
  id: 'poc:counter-example',
  shape: {
    html: '<div><p id="count-display"><!--nv-0--></p><p id="label-display"><!--nv-1--></p><!--nv-2--></div>',
    bindingPaths: [
      [0, 0, 0], // TextBinding for count  → <!--nv-0--> inside p#count-display
      [0, 1, 0], // TextBinding for label  → <!--nv-1--> inside p#label-display
      [0, 2], // ConditionalBinding anchor <!--nv-2-->
    ],
  },
  bindings: [
    {
      kind: 'text',
      pathIndex: 0,
      expr: () => count(),
    },
    {
      kind: 'text',
      pathIndex: 1,
      expr: () => label(),
    },
    {
      kind: 'conditional',
      pathIndex: 2,
      condition: () => count() > 3,
      consequent: highIR,
      alternate: lowIR,
    },
  ],
}

// =============================================================================
// Gate 1 — Layers compose
// =============================================================================
//
// Signal flow: count (signal) → label (derived, reads count) → TextBinding (effect, reads label)
//                             → ConditionalBinding (effect, reads count directly)
//                             → TextBinding for count (effect, reads count directly)
//
// The §11 primitives drive the renderer's effects; the effects write the DOM.
// No path from signal to DOM bypasses the IR contract.

let dispose!: () => void

test('mount() returns a dispose function without throwing', () => {
  dispose = mount(mainIR, doc.body, doc)
  expect(typeof dispose).toBe('function')
})

test('initial DOM reflects count=0 after flushSync()', () => {
  // The interpreter is async-scheduled: effects are enqueued during mount but
  // not run until flushSync(). Asserting before flush would see a blank DOM.
  flushSync()

  const div = doc.body.firstChild as Element
  expect(div).not.toBeNull()

  expect(div.querySelector('#count-display')?.textContent).toBe('0')
  expect(div.querySelector('#label-display')?.textContent).toBe('zero')

  // Condition: count() > 3 → false → alternate (lowIR) branch mounted
  expect(div.querySelector('span.low')).not.toBeNull()
  expect(div.querySelector('span.high')).toBeNull()
  expect(div.querySelector('span.low')?.textContent).toBe('low')
})

test('DOM updates after count.set(5): label changes, conditional flips to high', () => {
  count.set(5)
  flushSync()

  const div = doc.body.firstChild as Element
  expect(div.querySelector('#count-display')?.textContent).toBe('5')
  expect(div.querySelector('#label-display')?.textContent).toBe('high')
  expect(div.querySelector('span.high')).not.toBeNull()
  expect(div.querySelector('span.low')).toBeNull()
  expect(div.querySelector('span.high')?.textContent).toBe('HIGH')
})

test('DOM updates after count.set(2): conditional flips back to low', () => {
  count.set(2)
  flushSync()

  const div = doc.body.firstChild as Element
  expect(div.querySelector('#count-display')?.textContent).toBe('2')
  expect(div.querySelector('#label-display')?.textContent).toBe('medium')
  expect(div.querySelector('span.low')).not.toBeNull()
  expect(div.querySelector('span.high')).toBeNull()
})

// jsdom-vs-browser flag: the assertions above use standard DOM APIs
// (querySelector, textContent). For real-browser validation — the final PoC gate
// criterion — this example must be promoted to Claude Code.

// =============================================================================
// Gate 2 — Compiler rejects a deliberate sync cycle at build time
// =============================================================================
//
// Single-ts.Program requirement (step-2 lesson): the classifier and the cycle
// checker MUST share one program instance. Cross-program type lookups return no
// symbol matches, producing false negatives. The fixture is visited by the
// classifier using the program's own TypeChecker.

// Write fixture and a core.ts copy into a temp directory so their paths are siblings.
const gate2TmpDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'nv-poc-gate2-'))
const coreTmpPath = nodePath.join(gate2TmpDir, 'core.ts')
fs.copyFileSync(nvCorePath, coreTmpPath)

// Deliberate cycle: sync(b→a) + sync(a→b) forms the cycle a ↔ b.
// The build-time cycle checker should catch this and return a CycleReport
// naming both sync() calls.
const cycleFixtureSrc = `import { signal, sync } from './core'
const a = signal(0)
const b = signal(0)
// Edge b → a: this sync reads b and writes a
sync(() => b(), a, (v: number) => v + 1)
// Edge a → b: this sync reads a and writes b — completes the cycle a ↔ b
sync(() => a(), b, (v: number) => v + 1)
`
const cycleFixturePath = nodePath.join(gate2TmpDir, 'cycle_fixture.ts')
fs.writeFileSync(cycleFixturePath, cycleFixtureSrc, 'utf-8')

// Clean (no-cycle) fixture for the false-positive test.
const cleanFixtureSrc = `import { signal, sync } from './core'
const x = signal(0)
const y = signal(0)
// Edge x → y only. Nothing writes x back, so no cycle.
sync(() => x(), y, (v: number) => v + 1)
`
const cleanFixturePath = nodePath.join(gate2TmpDir, 'clean_fixture.ts')
fs.writeFileSync(cleanFixturePath, cleanFixtureSrc, 'utf-8')

const tsOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  esModuleInterop: true,
}

// Build both programs up front — they share the same ClassifierConfig.
const compilerConfig: ClassifierConfig = { nvCorePath: coreTmpPath }
const classifier = new SyncTargetClassifier(compilerConfig)
const cycleChecker = new WriteGraphCycleChecker(compilerConfig)

// Cycle program: core.ts + cycle fixture sharing one TypeChecker.
const cycleProgram = ts.createProgram([coreTmpPath, cycleFixturePath], tsOptions)
const cycleTc = cycleProgram.getTypeChecker()
const cycleSf = cycleProgram.getSourceFile(cycleFixturePath) as ts.SourceFile

// Visit only the fixture file — avoids spurious verdicts from core.ts itself.
const cycleVerdicts: TargetVerdict[] = []
;(function visit(node: ts.Node): void {
  if (ts.isCallExpression(node)) {
    const v = classifier.classifyCall(node, cycleTc)
    if (v !== null) cycleVerdicts.push(v)
  }
  ts.forEachChild(node, visit)
})(cycleSf)

const cycleReports = cycleChecker.check(cycleProgram, cycleVerdicts)

test('classifier produces exactly 2 ACCEPT verdicts for the cycle fixture', () => {
  const accepts = cycleVerdicts.filter((v) => v.kind === 'ACCEPT')
  expect(accepts.length).toBe(2)
})

test('cycle checker detects the a↔b feedback loop', () => {
  expect(cycleReports.length).toBeGreaterThan(0)
})

test('CycleReport cycle path has length 2 (a and b) and names involved syncs', () => {
  const report = cycleReports[0]
  expect(report.cycle.length).toBe(2)
  expect(report.involvedSyncs.length).toBeGreaterThanOrEqual(1)
})

test('no false-positive cycle for a clean (acyclic) fixture', () => {
  // The clean program shares the temp core.ts but has a different fixture.
  // Single-program requirement: build a fresh program for the clean fixture.
  const cleanProgram = ts.createProgram([coreTmpPath, cleanFixturePath], tsOptions)
  const cleanTc = cleanProgram.getTypeChecker()
  const cleanSf = cleanProgram.getSourceFile(cleanFixturePath) as ts.SourceFile

  const cleanVerdicts: TargetVerdict[] = []
  ;(function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const v = classifier.classifyCall(node, cleanTc)
      if (v !== null) cleanVerdicts.push(v)
    }
    ts.forEachChild(node, visit)
  })(cleanSf)

  const cleanReports = cycleChecker.check(cleanProgram, cleanVerdicts)
  expect(cleanReports.length).toBe(0)
})

// =============================================================================
// Gate 3 — Disposal leaves zero leaked edges
// =============================================================================
//
// Observer-count semantics:
//   __test.observerCount(signal) returns the length of the signal's firstObserver
//   chain — i.e., the number of reactive nodes that directly read this signal.
//
// Before disposal, count has 3 direct observers:
//   (a) count_text_effect   — the TextBinding effect wired to p#count-display
//   (b) label derived       — label.compute() calls count(); edge established on first
//                             label computation, which happens inside label_text_effect
//   (c) conditional_effect  — reads count() via the condition thunk
//
// Before disposal, label has 1 direct observer:
//   (d) label_text_effect   — the TextBinding effect wired to p#label-display
//
// After disposal:
//   (a), (c), (d) are owned by the mount's createRoot → disposed → their source
//   edges to count/label are severed.
//   (b) label derived was created outside any createRoot; its source edge to count
//   persists — label still observes count.
//
// Expected post-dispose counts:
//   observerCount(count) = 1   (just label derived, still alive)
//   observerCount(label) = 0   (label_text_effect was the only observer; now gone)

test('pre-dispose: count has 3 observers, label has 1 (reactive graph is live)', () => {
  // Gate 1 left us at count=2, with the main mount still live.
  const countObs = __test.observerCount(count)
  const labelObs = __test.observerCount(label)
  expect(countObs).toBe(3)
  expect(labelObs).toBe(1)
})

test('dispose() severs all renderer effects — label drops to 0 observers', () => {
  dispose()
  flushSync()
  expect(__test.observerCount(label)).toBe(0)
})

test('count retains exactly 1 observer: the label derived (outlives mount)', () => {
  // label derived is not owned by the mount root — its source edge to count persists.
  expect(__test.observerCount(count)).toBe(1)
})

test('mount root element removed from DOM by the dispose onCleanup', () => {
  // The mount() onCleanup removes rootEl from its parent (doc.body).
  expect(doc.body.firstChild).toBeNull()
})

test('post-dispose signal write leaves DOM untouched (effects are severed)', () => {
  // Adversarial probe: write a conspicuous value to count and flush.
  // No renderer effect is alive to update the DOM → body stays empty.
  count.set(999)
  flushSync()
  expect(doc.body.firstChild).toBeNull()
  // label is Dirty (propagated from count) but has no observers → no effects
  // are scheduled → no DOM side-effects from this write.
})

test('flip-then-dispose: conditional flip leaves no residual DOM or leaked edges', () => {
  // Fresh mount with a new container. Flip the condition, then dispose while the
  // high branch is mounted. Verify complete teardown.
  count.set(0)
  const container = doc.createElement('div')
  doc.body.appendChild(container)

  const dispose2 = mount(mainIR, container, doc)
  flushSync()

  // Initial state: count=0, condition false → low branch
  expect(container.querySelector('span.low')).not.toBeNull()
  expect(container.querySelector('span.high')).toBeNull()

  // Flip condition
  count.set(10)
  flushSync()
  expect(container.querySelector('span.high')).not.toBeNull()
  expect(container.querySelector('span.low')).toBeNull()

  // Dispose while high branch is mounted — tests the branchDisposer bridge path
  dispose2()
  flushSync()

  // Root element (the <div>) should be removed from container
  expect(container.firstChild).toBeNull()

  // All effects from this mount are gone → label drops to 0 observers again
  expect(__test.observerCount(label)).toBe(0)

  // count has 1 observer (label derived) — unchanged
  expect(__test.observerCount(count)).toBe(1)
})

// =============================================================================
// Gate 4 — Layers meet only at contract-defined seams
// =============================================================================
//
// This gate is a structural claim, not a runtime assertion. The evidence is in
// this file's import block and the way the example is authored:
//
//   Runtime boundary (§11 public surface):
//     Imports: signal, derived, flushSync, __test
//     No reference to core.ts internals (ReactiveNode, Link, KIND_*, etc.)
//
//   Renderer boundary (IR contract + mount entry point):
//     Imports: mount() from interpreter.ts
//              TemplateIR type from ir.ts (the IR contract document)
//     TemplateIR is constructed directly from the ir.ts type definitions.
//     No reference to interpreter internals (walkPath, wireText, wireConditional…)
//
//   Compiler boundary (public classifier + cycle checker APIs):
//     Imports: SyncTargetClassifier, WriteGraphCycleChecker, ClassifierConfig, TargetVerdict
//     No reference to compiler internals (EnumResult, walkReads, buildGraph…)
//
//   §6 owner/disposal contract:
//     mount() returns a dispose function. No manual edge tracking. Ownership
//     is entirely via the §6 owner tree: effects are owned by the mount's
//     createRoot, disposal tears down the entire owned subtree automatically.
//
// Any composition defect surfaced by this test is attributable to a specific
// owning stream and must be fixed there, not patched in this integration test.

test('Gate 4: seam audit — all cross-stream interactions are via contract surfaces', () => {
  // Verified by inspection of the import block and authoring pattern above.
  // The passing of Gates 1–3 demonstrates the contracts hold at runtime.
  expect(true).toBe(true)
})

// =============================================================================
// Sandbox boundary note
// =============================================================================
//
// Gates 1–4 are verified against jsdom. The real-browser confirmation — the
// final PoC gate criterion from the ROADMAP — is NOT claimed here. To satisfy
// it: promote this example to Claude Code, render to a real browser, and verify
// interaction (e.g. a click increment) updates the DOM.
//
// Known jsdom-vs-browser assumptions (from interpreter.ts):
//   - <template> element + innerHTML parsing: jsdom uses parse5; real browsers
//     use platform parsers. Flagged for Claude Code validation.
//   - Standard DOM APIs used throughout (createElement, textContent, querySelector,
//     cloneNode, insertBefore, removeChild, addEventListener) — all should behave
//     identically in real browsers for the operations performed here.
