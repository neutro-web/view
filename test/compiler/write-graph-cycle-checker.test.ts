/**
 * nv Compiler — Write-Graph Cycle Checker Test Suite
 * Contract: §8.5.2
 *
 * Tests verify:
 *   (a) Cycle detection: simple 2-node, self-write, three-way, no-cycle cases
 *   (b) Source-read analysis: reactive reads correctly extracted from thunks
 *   (c) untrack() exclusion: reads inside untrack are not reactive → no false cycles
 *   (d) Nested-function reads: skipped, readsComplete = false
 *   (e) PubSub source: no reads, no edges
 *   (f) Multi-read source / multi-write target (conditional thunk)
 *   (g) involvedSyncs: the right call nodes are attributed to detected cycles
 *   (h) Cycle deduplication: same cycle not reported twice
 *   (i) Soundness: no false-positive cycles (all reports are real)
 *   (j) SignalId consistency with step 1 (same derivation via signalSymbolId)
 */

import * as ts from 'typescript'
import { expect, test } from 'vitest'
import { SyncTargetClassifier } from '../../src/compiler/sync-target-classifier'
import type { CycleReport, ReadEnumResult, TargetVerdict } from '../../src/compiler/types'
import { WriteGraphCycleChecker } from '../../src/compiler/write-graph-cycle-checker'
import { getVerdicts, makeTestProgram } from './test-helpers'

// ── Helpers ───────────────────────────────────────────────────────────────────

function idContains(id: string, name: string): boolean {
  return id.includes(`#${name}@`)
}

function cycleContains(cycle: string[], name: string): boolean {
  return cycle.some((id) => idContains(id, name))
}

/**
 * Full pipeline: classify targets → check for cycles.
 * Returns CycleReport[] from the combined step 1 + step 2 pass.
 */
function checkCycles(fixtureSource: string): CycleReport[] {
  const { program, nvCorePath } = makeTestProgram(fixtureSource)
  const config = { nvCorePath }
  const classifier = new SyncTargetClassifier(config)
  const checker = program.getTypeChecker()
  const sf = program
    .getSourceFiles()
    .find((f) => !f.isDeclarationFile && f.fileName.includes('fixture'))
  if (!sf) throw new Error('fixture source file not found')

  const verdicts: TargetVerdict[] = []
  ;(function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const v = classifier.classifyCall(node, checker)
      if (v) verdicts.push(v)
    }
    ts.forEachChild(node, visit)
  })(sf)

  const cycleChecker = new WriteGraphCycleChecker(config)
  return cycleChecker.check(program, verdicts)
}

/**
 * Get source-read analysis result for the first sync call in a fixture.
 */
function getSourceReads(fixtureSource: string): ReadEnumResult {
  const { program, nvCorePath } = makeTestProgram(fixtureSource)
  const config = { nvCorePath }
  const checker = program.getTypeChecker()
  const sf = program
    .getSourceFiles()
    .find((f) => !f.isDeclarationFile && f.fileName.includes('fixture'))
  if (!sf) throw new Error('fixture source file not found')

  const cycleChecker = new WriteGraphCycleChecker(config)
  let firstSyncSourceArg: ts.Expression | null = null
  ;(function visit(node: ts.Node) {
    if (firstSyncSourceArg) return
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (
        (ts.isIdentifier(callee) && callee.text === 'sync') ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'sync')
      ) {
        if (node.arguments[0]) firstSyncSourceArg = node.arguments[0]
      }
    }
    ts.forEachChild(node, visit)
  })(sf)

  if (!firstSyncSourceArg) throw new Error('no sync call found in fixture')
  return cycleChecker.analyzeSourceReads(firstSyncSourceArg, checker)
}

// ── Source-read analysis tests ────────────────────────────────────────────────

test('READ: simple identifier read — single signal', () => {
  const result = getSourceReads(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), T = signal(0)
    sync(() => A(), T, v => v)
  `)
  expect(result.kind).toBe('SIGNALS')
  if (result.kind !== 'SIGNALS') return
  expect(result.signals.size).toBe(1)
  expect(
    [...result.signals].some((id) => idContains(id, 'A')),
    `reads should include A: ${[...result.signals]}`,
  ).toBe(true)
})

test('READ: multiple signals in binary expression', () => {
  const result = getSourceReads(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0), T = signal(0)
    sync(() => A() + B(), T, v => v)
  `)
  expect(result.kind).toBe('SIGNALS')
  if (result.kind !== 'SIGNALS') return
  expect(result.signals.size).toBe(2)
  expect([...result.signals].some((id) => idContains(id, 'A'))).toBe(true)
  expect([...result.signals].some((id) => idContains(id, 'B'))).toBe(true)
})

test('READ: property access read (obj.sig())', () => {
  const result = getSourceReads(`
    import { signal, sync } from '@nv/core'
    const T = signal(0)
    const obj = { a: signal(0) }
    sync(() => obj.a(), T, v => v)
  `)
  expect(result.kind).toBe('SIGNALS')
  if (result.kind !== 'SIGNALS') return
  expect(result.signals.size).toBe(1)
  expect([...result.signals].some((id) => idContains(id, 'a'))).toBe(true)
})

test('READ: block-body source (reads inside block statements)', () => {
  const result = getSourceReads(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0), T = signal(0)
    sync(() => { const x = A(); return x + B() }, T, v => v)
  `)
  expect(result.kind).toBe('SIGNALS')
  if (result.kind !== 'SIGNALS') return
  expect(result.signals.size).toBe(2)
  expect([...result.signals].some((id) => idContains(id, 'A'))).toBe(true)
  expect([...result.signals].some((id) => idContains(id, 'B'))).toBe(true)
})

test('READ: untrack() exclusion — reads inside untrack are NOT reactive', () => {
  const result = getSourceReads(`
    import { signal, sync, untrack } from '@nv/core'
    const A = signal(0), B = signal(0), T = signal(0)
    // A is reactive; B is inside untrack → not a reactive read
    sync(() => A() + untrack(() => B()), T, v => v)
  `)
  expect(result.kind).toBe('SIGNALS')
  if (result.kind !== 'SIGNALS') return
  expect(result.signals.size, `only A should be in reads, not B: ${[...result.signals]}`).toBe(1)
  expect([...result.signals].some((id) => idContains(id, 'A'))).toBe(true)
  expect(
    ![...result.signals].some((id) => idContains(id, 'B')),
    'B (untracked) must NOT be in reads',
  ).toBe(true)
})

test('READ: nested arrow function in source body → PARTIAL, not SIGNALS', () => {
  const result = getSourceReads(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), T = signal(0)
    // The signal read is inside a nested function — walkReads skips it
    sync(() => { const fn = () => A(); return 0 }, T, v => v)
  `)
  // nested fn is skipped → incomplete = true, no reads outside → UNKNOWN or PARTIAL
  expect(
    result.kind === 'PARTIAL' || result.kind === 'UNKNOWN',
    `Expected PARTIAL or UNKNOWN for nested fn source, got ${result.kind}`,
  ).toBe(true)
})

test('READ: pubsub source → UNKNOWN (not an analyzable function)', () => {
  const result = getSourceReads(`
    import { signal, sync, pubsub } from '@nv/core'
    const T = signal(0)
    const clicks = pubsub<void>()
    sync(clicks, T, (_, curr: number) => curr + 1)
  `)
  expect(result.kind).toBe('UNKNOWN')
})

// ── Cycle detection tests ─────────────────────────────────────────────────────

test('CYCLE: simple 2-node cycle (A→B, B→A)', () => {
  const cycles = checkCycles(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0)
    sync(() => A(), B, v => v)   // reads A, writes B → edge A→B
    sync(() => B(), A, v => v)   // reads B, writes A → edge B→A
  `)
  expect(cycles.length, `Expected 1 cycle, got ${cycles.length}`).toBe(1)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycles[0]!.cycle.length).toBe(2)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycleContains(cycles[0]!.cycle, 'A')).toBe(true)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycleContains(cycles[0]!.cycle, 'B')).toBe(true)
})

test('CYCLE: self-write (sync reads and writes the same signal)', () => {
  const cycles = checkCycles(`
    import { signal, sync } from '@nv/core'
    const T = signal(0)
    sync(() => T(), T, v => v + 1)  // reads T, writes T → edge T→T (self-loop)
  `)
  expect(cycles.length).toBe(1)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycles[0]!.cycle.length).toBe(1)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycleContains(cycles[0]!.cycle, 'T')).toBe(true)
})

test('CYCLE: three-way cycle (A→B→C→A)', () => {
  const cycles = checkCycles(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0), C = signal(0)
    sync(() => A(), B, v => v)  // edge A→B
    sync(() => B(), C, v => v)  // edge B→C
    sync(() => C(), A, v => v)  // edge C→A
  `)
  expect(cycles.length).toBe(1)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycles[0]!.cycle.length).toBe(3)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycleContains(cycles[0]!.cycle, 'A')).toBe(true)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycleContains(cycles[0]!.cycle, 'B')).toBe(true)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycleContains(cycles[0]!.cycle, 'C')).toBe(true)
})

test('NO CYCLE: linear chain (A→B→C, no back-edge)', () => {
  const cycles = checkCycles(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0), C = signal(0)
    sync(() => A(), B, v => v)  // edge A→B
    sync(() => B(), C, v => v)  // edge B→C
    // No sync reading C → no back-edge → no cycle
  `)
  expect(cycles.length).toBe(0)
})

test('NO CYCLE: independent syncs (no shared signals)', () => {
  const cycles = checkCycles(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0), C = signal(0), D = signal(0)
    sync(() => A(), B, v => v)  // edge A→B
    sync(() => C(), D, v => v)  // edge C→D
    // Disjoint — no cycle
  `)
  expect(cycles.length).toBe(0)
})

test('NO CYCLE: untrack breaks the cycle path', () => {
  // Without untrack: reads {A, B}, writes {B} → edge A→B AND B→B (self-loop, cycle!)
  // With untrack:    reads {A},    writes {B} → edge A→B only → no cycle
  const cycles = checkCycles(`
    import { signal, sync, untrack } from '@nv/core'
    const A = signal(0), B = signal(0)
    sync(() => A() + untrack(() => B()), B, v => v)
  `)
  expect(cycles.length, 'untrack should exclude B from reads, breaking the self-loop cycle').toBe(0)
})

test('CYCLE: multi-read source (reads A and B, both can feed cycle back)', () => {
  const cycles = checkCycles(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0), C = signal(0)
    sync(() => A() + B(), C, v => v)  // reads {A, B}, writes {C} → edges A→C, B→C
    sync(() => C(), A, v => v)         // reads {C}, writes {A} → edge C→A
    // Cycle: A→C→A (through the two syncs)
    // B→C exists but no back-edge to B, so no B-cycle
  `)
  expect(cycles.length).toBe(1)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycleContains(cycles[0]!.cycle, 'A')).toBe(true)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycleContains(cycles[0]!.cycle, 'C')).toBe(true)
})

test('CYCLE: multi-write target (conditional thunk) creates multiple cycle paths', () => {
  const cycles = checkCycles(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0), C = signal(0), cond = signal(true)
    // sync1: reads {A}, writes {B, C} (conditional thunk) → edges A→B, A→C
    sync(() => A(), () => cond() ? B : C, v => v)
    // sync2: reads {B}, writes {A} → edge B→A → cycle A→B→A
    sync(() => B(), A, v => v)
    // No sync reads C back to A, so A→C is a dead end (no cycle through C)
  `)
  // At least one cycle (A→B→A)
  expect(cycles.length >= 1).toBe(true)
  const abCycle = cycles.find((r) => cycleContains(r.cycle, 'A') && cycleContains(r.cycle, 'B'))
  expect(abCycle, 'Expected a cycle through A and B').toBeTruthy()
})

test('CYCLE: involvedSyncs correctly attributed to cycle edges', () => {
  const { program, nvCorePath } = makeTestProgram(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0)
    sync(() => A(), B, v => v)  // sync1
    sync(() => B(), A, v => v)  // sync2
  `)
  const config = { nvCorePath }
  const classifier = new SyncTargetClassifier(config)
  const checker = program.getTypeChecker()
  const sf = program
    .getSourceFiles()
    .find((f) => !f.isDeclarationFile && f.fileName.includes('fixture'))
  if (!sf) throw new Error('fixture source file not found')

  const verdicts: TargetVerdict[] = []
  ;(function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const v = classifier.classifyCall(node, checker)
      if (v) verdicts.push(v)
    }
    ts.forEachChild(node, visit)
  })(sf)

  expect(verdicts.length, 'should have 2 ACCEPT verdicts').toBe(2)
  const cycleChecker = new WriteGraphCycleChecker(config)
  const cycles = cycleChecker.check(program, verdicts)

  expect(cycles.length).toBe(1)
  // Both syncs should be in involvedSyncs (one creates A→B, the other B→A)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  expect(cycles[0]!.involvedSyncs.length, 'both syncs should be attributed to the cycle').toBe(2)
  // Each involved sync should be one of the two ACCEPT verdict call nodes
  const verdictNodes = verdicts.map((v) => v.callNode)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  for (const s of cycles[0]!.involvedSyncs) {
    expect(
      verdictNodes.includes(s),
      'involvedSync should be one of the classified sync calls',
    ).toBe(true)
  }
})

test('CYCLE: deduplication — same cycle not reported twice', () => {
  // Three-way cycle: DFS from A, B, or C could each detect the same cycle
  const cycles = checkCycles(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0), C = signal(0)
    sync(() => A(), B, v => v)
    sync(() => B(), C, v => v)
    sync(() => C(), A, v => v)
  `)
  expect(
    cycles.length,
    `Same cycle should not be reported multiple times, got ${cycles.length}`,
  ).toBe(1)
})

test('NO CYCLE: non-ACCEPT verdicts contribute no edges (REJECT/UNDECIDABLE ignored)', () => {
  // sync1: REJECT target (runtime index) → no edges
  // sync2: ACCEPT target, reads and writes disjoint → no cycle
  const cycles = checkCycles(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0), i = signal(0)
    const arr = [signal(0)]
    // @ts-ignore
    sync(() => A(), () => arr[i()], v => v)  // REJECT — contributes no edges
    sync(() => A(), B, v => v)               // ACCEPT — edge A→B, no cycle
  `)
  expect(cycles.length).toBe(0)
})

test('SOUNDNESS: partial source analysis misses edges, falls to runtime cap (not wrong)', () => {
  // If source analysis fails (pubsub = no reads), we get no edges → no cycle detected.
  // This is the correct conservative behavior: we might miss a runtime cycle,
  // but we never report a cycle that doesn't exist.
  const cycles = checkCycles(`
    import { signal, sync, pubsub } from '@nv/core'
    const T = signal(0)
    const clicks = pubsub<void>()
    // pubsub source → no readable reads → no graph edges → no cycle
    sync(clicks, T, (_, curr: number) => curr + 1)
  `)
  expect(cycles.length).toBe(0)
  // (runtime cycle cap would handle any actual cascade — verified in §12 conformance)
})

test('SIGNAL ID CONSISTENCY: step 1 target ID === step 2 source read ID for same signal', () => {
  // This verifies the critical seam: signalSymbolId used by both passes must
  // produce identical IDs for the same signal, so write-graph edges connect.
  const { program, nvCorePath } = makeTestProgram(`
    import { signal, sync } from '@nv/core'
    const A = signal(0), B = signal(0)
    sync(() => A(), B, v => v)   // step1: target = B_id; step2: source reads A_id
    sync(() => B(), A, v => v)   // step1: target = A_id; step2: source reads B_id
  `)
  const config = { nvCorePath }
  const classifier = new SyncTargetClassifier(config)
  const cycleChecker = new WriteGraphCycleChecker(config)
  const checker = program.getTypeChecker()
  const sf = program
    .getSourceFiles()
    .find((f) => !f.isDeclarationFile && f.fileName.includes('fixture'))
  if (!sf) throw new Error('fixture source file not found')

  const verdicts: TargetVerdict[] = []
  const sourceArgs: ts.Expression[] = []
  ;(function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const v = classifier.classifyCall(node, checker)
      if (v) {
        verdicts.push(v)
        if (node.arguments[0]) sourceArgs.push(node.arguments[0])
      }
    }
    ts.forEachChild(node, visit)
  })(sf)

  expect(verdicts.length).toBe(2)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  const verdict0 = verdicts[0]!
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  const verdict1 = verdicts[1]!
  const accept0 =
    verdict0.kind === 'ACCEPT'
      ? (verdict0 as Extract<(typeof verdicts)[0], { kind: 'ACCEPT' }>)
      : null
  const accept1 =
    verdict1.kind === 'ACCEPT'
      ? (verdict1 as Extract<(typeof verdicts)[1], { kind: 'ACCEPT' }>)
      : null
  expect(accept0 && accept1, 'Both verdicts should be ACCEPT').toBeTruthy()
  if (!accept0 || !accept1) return

  expect(sourceArgs.length).toBe(2)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  const reads0 = cycleChecker.analyzeSourceReads(sourceArgs[0]!, checker)
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  const reads1 = cycleChecker.analyzeSourceReads(sourceArgs[1]!, checker)
  expect(reads0.kind).toBe('SIGNALS')
  expect(reads1.kind).toBe('SIGNALS')
  if (reads0.kind !== 'SIGNALS' || reads1.kind !== 'SIGNALS') return

  // sync0 target is B, sync1 source reads B — these IDs must match
  const sync0TargetIds = [...accept0.targets] // [B_id]
  const sync1ReadIds = [...reads1.signals] // [B_id]
  expect(sync0TargetIds.length).toBe(1)
  expect(sync1ReadIds.length).toBe(1)
  expect(
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
    sync0TargetIds[0]!,
    'Step 1 target ID for B must equal step 2 source read ID for B — same signalSymbolId derivation',
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  ).toBe(sync1ReadIds[0]!)
})
