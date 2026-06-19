/**
 * nv Compiler — Read/Write Erasure Analysis Test Suite
 * Soundness design: 2026-06-18
 *
 * Tests operate purely in SignalId space — no DOM, no jsdom required.
 * This matches the "compile-time verdict test" approach from the soundness design:
 * gate case 4 (sync-target write decline) is a compiler verdict, not a DOM assertion.
 *
 * Gate cases covered:
 *   GATE 1  — reactive read in text hole → ACCEPT (read erasure correct)
 *   GATE 3  — plain local write in handler, or non-reactive constant → PLAIN / ACCEPT
 *             but NOT DECLINE (locals untouched)
 *   GATE 4  — event handler writes to sync-target signal → DECLINE + diagnostic
 *   GATE 4' — sync-composition case: diagnostic is visible (not silent stale value)
 *
 * Cross-pass seam tests:
 *   - DECLINE only fires when the SignalId matches the classifier's syncTargetIds
 *   - Non-sync-target signal writes → ACCEPT (valid write, not a sync conflict)
 *   - Two signals, one sync-target → DECLINE only for the sync-target write
 *
 * Additional:
 *   - untrack() exclusion: reads inside untrack → outer thunk has no reactive read → PLAIN
 *   - Non-html tagged templates → no results
 *   - Multi-hole template → per-hole verdicts correct
 */

import * as ts from 'typescript'
import { expect, test } from 'vitest'
import { ReadWriteErasureAnalyzer } from '../../src/compiler/read-write-erasure-analyzer.js'
import { SyncTargetClassifier } from '../../src/compiler/sync-target-classifier.js'
import type {
  BindingErasureVerdict,
  SignalId,
  TemplateErasureResult,
} from '../../src/compiler/types.js'
import { makeTestProgram } from './test-helpers.js'

// ── Test helpers ───────────────────────────────────────────────────────────────

/**
 * Full pipeline: run the sync classifier on the fixture, extract sync target IDs,
 * then run the erasure analyzer. Returns erasure results for the fixture file only.
 *
 * This exercises the cross-pass seam: both passes use the same signalSymbolId
 * derivation; the intersection is what matters for correctness.
 */
function analyze(source: string): {
  results: TemplateErasureResult[]
  syncTargetIds: ReadonlySet<SignalId>
} {
  const { program, nvCorePath } = makeTestProgram(source)
  const config = { nvCorePath }
  const checker = program.getTypeChecker()
  const sf = program
    .getSourceFiles()
    .find((f) => !f.isDeclarationFile && f.fileName.includes('fixture'))!

  // Step 1: sync classifier → sync target IDs (same signalSymbolId derivation)
  const classifier = new SyncTargetClassifier(config)
  const syncTargetIds = new Set<SignalId>()
  ;(function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const v = classifier.classifyCall(node, checker)
      if (v?.kind === 'ACCEPT') {
        for (const id of v.targets) syncTargetIds.add(id)
      }
    }
    ts.forEachChild(node, visit)
  })(sf)

  // Erasure analysis with the sync-target IDs from the classifier
  const analyzer = new ReadWriteErasureAnalyzer(config, syncTargetIds)
  const results = analyzer.analyzeFile(program, sf)

  return { results, syncTargetIds }
}

function assertVerdict(
  verdicts: BindingErasureVerdict[],
  index: number,
  expected: BindingErasureVerdict['kind'],
): BindingErasureVerdict {
  const v = verdicts.find((v) => v.expressionIndex === index)
  expect(
    v,
    `No verdict for expression index ${index}; got: ${verdicts.map((v) => `${v.expressionIndex}:${v.kind}`).join(', ')}`,
  ).toBeDefined()
  expect(
    v!.kind,
    `Index ${index}: expected ${expected}, got ${v!.kind}${'reason' in v! ? ` — ${v!.reason}` : ''}${'diagnostic' in v! ? ` — ${v!.diagnostic}` : ''}`,
  ).toBe(expected)
  return v!
}

// ── GATE 1: reactive reads → ACCEPT ──────────────────────────────────────────

test('GATE 1: reactive read in text hole → ACCEPT', () => {
  const { results } = analyze(`
    import { signal } from '@nv/core'
    const count = signal(0)
    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<span>\${() => count()}</span>\`
  `)
  expect(results.length).toBe(1)
  assertVerdict(results[0]!.verdicts, 0, 'ACCEPT')
})

test('GATE 1: multiple reactive reads in one thunk → ACCEPT', () => {
  const { results } = analyze(`
    import { signal } from '@nv/core'
    const a = signal(0), b = signal(0)
    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<span>\${() => a() + b()}</span>\`
  `)
  expect(results.length).toBe(1)
  assertVerdict(results[0]!.verdicts, 0, 'ACCEPT')
})

test('GATE 1: reactive read in attr hole → ACCEPT', () => {
  const { results } = analyze(`
    import { signal } from '@nv/core'
    const cls = signal('active')
    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<div class="\${() => cls()}"></div>\`
  `)
  expect(results.length).toBe(1)
  assertVerdict(results[0]!.verdicts, 0, 'ACCEPT')
})

// ── GATE 3: plain locals → PLAIN, never DECLINE ───────────────────────────────

test('GATE 3: non-reactive constant in text hole → PLAIN', () => {
  const { results } = analyze(`
    const localConst = 42
    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<span>\${() => localConst}</span>\`
  `)
  expect(results.length).toBe(1)
  assertVerdict(results[0]!.verdicts, 0, 'PLAIN')
})

test('GATE 3: plain local assignment in handler → NOT DECLINE (locals are not signals)', () => {
  // A write to a plain local variable (not a signal) must never produce DECLINE.
  // DECLINE only fires for sync-target SIGNAL writes.
  const { results } = analyze(`
    import { signal } from '@nv/core'
    const count = signal(0)
    let localVar = 0
    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<button onclick="\${() => (e: Event) => { localVar = 1 }}">\${() => count()}</button>\`
  `)
  expect(results.length).toBe(1)
  const v0 = results[0]!.verdicts.find((v) => v.expressionIndex === 0)!
  expect(v0.kind, 'Plain local assignment must NOT produce DECLINE').not.toBe('DECLINE')
  // text hole with reactive read → ACCEPT
  assertVerdict(results[0]!.verdicts, 1, 'ACCEPT')
})

// ── GATE 4: sync-target write → DECLINE ───────────────────────────────────────

test('GATE 4: event handler writes to sync-target signal → DECLINE', () => {
  const { results, syncTargetIds } = analyze(`
    import { signal, sync } from '@nv/core'
    const value = signal(0)
    const count = signal(0)
    sync(() => value(), count, v => v)

    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<button onclick="\${() => (e: Event) => count.set(0)}">\${() => count()}</button>\`
  `)
  expect(syncTargetIds.size > 0, 'count must be a sync target').toBe(true)
  expect(results.length).toBe(1)

  const v0 = assertVerdict(results[0]!.verdicts, 0, 'DECLINE')
  if (v0.kind === 'DECLINE') {
    expect(v0.diagnostic.length > 0, 'diagnostic must be non-empty').toBe(true)
    expect(
      syncTargetIds.has(v0.syncTargetId),
      'DECLINE syncTargetId must match the classifier — cross-pass seam verified',
    ).toBe(true)
  }
  // text hole → ACCEPT
  assertVerdict(results[0]!.verdicts, 1, 'ACCEPT')
})

test('GATE 4: sync-composition case — diagnostic is visible, not silent wrong result', () => {
  // The design: "never a silent second write." The binding is still wired (correctness);
  // DECLINE adds the diagnostic. DOM correctness is verified by the differential gate
  // (compiledMount always wires, interpreter always wires → same DOM).
  const { results, syncTargetIds } = analyze(`
    import { signal, sync } from '@nv/core'
    const src = signal(0), target = signal(0)
    sync(() => src(), target, v => v)

    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<input oninput="\${() => (e: Event) => target.set(0)}" />\`
  `)
  expect(syncTargetIds.size > 0, 'target is a sync target').toBe(true)
  expect(results.length).toBe(1)
  const v = assertVerdict(results[0]!.verdicts, 0, 'DECLINE')
  if (v.kind === 'DECLINE') {
    expect(v.reason.includes('sync-target'), `reason must mention sync-target: ${v.reason}`).toBe(
      true,
    )
    expect(v.diagnostic.includes('sync'), `diagnostic must mention sync(): ${v.diagnostic}`).toBe(
      true,
    )
  }
})

// ── Cross-pass seam: DECLINE only when SignalId matches ───────────────────────

test('SEAM: write to non-sync-target signal → ACCEPT (valid write, no conflict)', () => {
  const { results, syncTargetIds } = analyze(`
    import { signal } from '@nv/core'
    const count = signal(0)
    // No sync() → count is NOT a sync target

    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<button onclick="\${() => (e: Event) => count.set(count() + 1)}">\${() => count()}</button>\`
  `)
  expect(syncTargetIds.size, 'No sync targets (no sync() calls in fixture)').toBe(0)
  expect(results.length).toBe(1)
  const v0 = results[0]!.verdicts.find((v) => v.expressionIndex === 0)!
  expect(v0.kind, 'Write to non-sync-target must not DECLINE').not.toBe('DECLINE')
  assertVerdict(results[0]!.verdicts, 1, 'ACCEPT')
})

test('SEAM: two signals, one is sync target → DECLINE only for the sync-target write', () => {
  const { results, syncTargetIds } = analyze(`
    import { signal, sync } from '@nv/core'
    const a = signal(0), b = signal(0), src = signal(0)
    sync(() => src(), b, v => v)  // only b is a sync target

    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<div>
      <button onclick="\${() => (e: Event) => a.set(1)}">\${() => a()}</button>
      <button onclick="\${() => (e: Event) => b.set(2)}">\${() => b()}</button>
    </div>\`
  `)
  expect(syncTargetIds.size > 0, 'b is a sync target').toBe(true)
  expect(results.length).toBe(1)
  const verdicts = results[0]!.verdicts

  // onclick for 'a' (index 0): a is NOT a sync target → NOT DECLINE
  const v0 = verdicts.find((v) => v.expressionIndex === 0)!
  expect(v0.kind, "Write to 'a' (not sync-target) must not DECLINE").not.toBe('DECLINE')

  // text holes for a() and b(): reactive reads → ACCEPT
  assertVerdict(verdicts, 1, 'ACCEPT')
  assertVerdict(verdicts, 3, 'ACCEPT')

  // onclick for 'b' (index 2): b IS a sync target → DECLINE
  const v2 = assertVerdict(verdicts, 2, 'DECLINE')
  if (v2.kind === 'DECLINE') {
    expect(
      syncTargetIds.has(v2.syncTargetId),
      'syncTargetId for b must be in classifier results',
    ).toBe(true)
  }
})

test('SEAM: write in nested handler body is detected (recursion into inner function)', () => {
  // The write is inside `(e) => { count.set(0) }` nested in `() => (e) => ...`.
  // findSetCallsToSyncTargets must recurse into inner functions.
  const { results, syncTargetIds } = analyze(`
    import { signal, sync } from '@nv/core'
    const src = signal(0), count = signal(0)
    sync(() => src(), count, v => v)

    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<button onclick="\${() => (e: Event) => { count.set(0) }}">x</button>\`
  `)
  expect(syncTargetIds.size > 0).toBe(true)
  expect(results.length).toBe(1)
  assertVerdict(results[0]!.verdicts, 0, 'DECLINE')
})

// ── untrack() in read analysis ─────────────────────────────────────────────────

test('READ: outer thunk only has untracked reads → PLAIN', () => {
  const { results } = analyze(`
    import { signal, untrack } from '@nv/core'
    const a = signal(0)
    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<span>\${() => untrack(() => a())}</span>\`
  `)
  expect(results.length).toBe(1)
  assertVerdict(results[0]!.verdicts, 0, 'PLAIN')
})

test('READ: mix of reactive and untracked reads → ACCEPT (one reactive read is enough)', () => {
  const { results } = analyze(`
    import { signal, untrack } from '@nv/core'
    const a = signal(0), b = signal(0)
    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<span>\${() => a() + untrack(() => b())}</span>\`
  `)
  expect(results.length).toBe(1)
  assertVerdict(results[0]!.verdicts, 0, 'ACCEPT')
})

// ── Event holes without sync-target writes → ACCEPT ───────────────────────────

test('Event holes pass write-safety → ACCEPT regardless of read content', () => {
  // The outer thunk of an event hole returns a function (the handler).
  // The outer thunk itself has no reactive reads (it just creates a closure).
  // But event holes are ACCEPT by the event-hole path (not by read analysis).
  const { results } = analyze(`
    import { signal } from '@nv/core'
    const count = signal(0)
    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<button onclick="\${() => (e: Event) => console.log(count())}">click</button>\`
  `)
  expect(results.length).toBe(1)
  // Event hole: outer thunk returns handler → passes write-safety (count.set not called) → ACCEPT
  assertVerdict(results[0]!.verdicts, 0, 'ACCEPT')
})

// ── Non-html tagged templates → no results ────────────────────────────────────

test('Non-html tagged template → no results', () => {
  const { results } = analyze(`
    import { signal } from '@nv/core'
    const count = signal(0)
    const css = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const styles = css\`color: \${() => count() > 0 ? 'red' : 'blue'}\`
  `)
  expect(results.length, 'css tagged template must not be analyzed').toBe(0)
})

// ── Multi-hole template ────────────────────────────────────────────────────────

test('Multi-hole template: each hole gets its own verdict', () => {
  const { results, syncTargetIds } = analyze(`
    import { signal, sync } from '@nv/core'
    const src = signal(0), target = signal(0)
    const cls = signal('active')
    sync(() => src(), target, v => v)

    const html = (s: TemplateStringsArray, ...e: unknown[]) => ({ s, e })
    const ir = html\`<div class="\${() => cls()}" onclick="\${() => (e: Event) => target.set(0)}">\${() => src()}</div>\`
  `)
  expect(syncTargetIds.size > 0).toBe(true)
  expect(results.length).toBe(1)
  const verdicts = results[0]!.verdicts
  expect(verdicts.length, 'three holes → three verdicts').toBe(3)

  // class attr (index 0): reactive read → ACCEPT
  assertVerdict(verdicts, 0, 'ACCEPT')
  // onclick (index 1): writes to target (sync target) → DECLINE
  assertVerdict(verdicts, 1, 'DECLINE')
  // text hole (index 2): reads src (reactive) → ACCEPT
  assertVerdict(verdicts, 2, 'ACCEPT')
})
