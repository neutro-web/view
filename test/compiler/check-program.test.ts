/**
 * check-program driver — Gate tests G2–G5 + single-module parity
 * Contract: §8.5.2
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import * as ts from 'typescript'
import { expect, test } from 'vitest'
import { checkProgram } from '../../src/compiler/check-program.js'
import { SyncTargetClassifier } from '../../src/compiler/sync-target-classifier.js'
import type { CycleReport } from '../../src/compiler/types.js'
import { WriteGraphCycleChecker } from '../../src/compiler/write-graph-cycle-checker.js'
import { PROJECT_CORE_PATH, makeTestProgram } from './test-helpers.js'

// ── Two-file test helper ──────────────────────────────────────────────────────
// Builds a Program from two fixture sources (a.ts and b.ts, both in same tmpdir).
// MUST use the same CompilerOptions as makeTestProgram (CommonJS, lib.dom, skipLibCheck,
// esModuleInterop) so that core.ts resolves its DOM types and isNvSignalType fires.
const TWO_FILE_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  esModuleInterop: true,
}

function makeTwoFileResult(srcA: string, srcB: string): ReturnType<typeof checkProgram> {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'nv-check-test-'))
  try {
    const coreDest = nodePath.join(tmp, 'core.ts')
    fs.copyFileSync(PROJECT_CORE_PATH, coreDest)
    const aPath = nodePath.join(tmp, 'a.ts')
    const bPath = nodePath.join(tmp, 'b.ts')
    // Rewrite @nv/core alias to relative path (same pattern as makeTestProgram)
    const rewrite = (src: string) => src.replace(/from\s+['"]@nv\/core['"]/g, `from './core'`)
    fs.writeFileSync(aPath, rewrite(srcA), 'utf-8')
    fs.writeFileSync(bPath, rewrite(srcB), 'utf-8')
    const program = ts.createProgram([coreDest, aPath, bPath], TWO_FILE_OPTIONS)
    return checkProgram(program, { nvCorePath: coreDest })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ── G2: cross-module cycle detected ──────────────────────────────────────────
// a.ts writes signal 'a', reads signal 'b' (imported from b.ts).
// b.ts writes signal 'b', reads signal 'a' (imported from a.ts).
// Neither file alone shows the cycle; the driver must assemble the global graph.
test('G2 — cross-module cycle: driver reports cycle across two files', () => {
  const srcA = `
import { signal, sync } from '@nv/core'
import { b } from './b'
export const a = signal(0)
sync(() => b(), a)
`
  const srcB = `
import { signal, sync } from '@nv/core'
import { a } from './a'
export const b = signal(0)
sync(() => a(), b)
`
  const result = makeTwoFileResult(srcA, srcB)
  // Both signals must be ACCEPT-classified for edges to exist; 0 cycles with 2 verdicts
  // means alias resolution failed to unify the cross-module read — diagnose separately.
  expect(result.verdicts.filter((v) => v.kind === 'ACCEPT').length).toBe(2)
  expect(result.cycles.length).toBeGreaterThan(0)
  const cycle = result.cycles[0]!.cycle
  expect(cycle.some((id) => id.includes('#a@'))).toBe(true)
  expect(cycle.some((id) => id.includes('#b@'))).toBe(true)
})

// ── G3: acyclic two-module fixture — no false positive ────────────────────────
// a.ts: writes 'a', reads 'c' (c→a edge). b.ts: writes 'b', reads 'a' (a→b edge).
// Graph: c→a→b — a strict chain, no loop.
test('G3 — acyclic two-module: driver reports no cycles', () => {
  const srcA = `
import { signal, sync } from '@nv/core'
export const a = signal(0)
export const c = signal(0)
sync(() => c(), a)
`
  const srcB = `
import { signal, sync } from '@nv/core'
import { a } from './a'
export const b = signal(0)
sync(() => a(), b)
`
  const result = makeTwoFileResult(srcA, srcB)
  expect(result.cycles).toHaveLength(0)
})

// ── G4: single-module parity ──────────────────────────────────────────────────
// driver output must equal WriteGraphCycleChecker.check called directly with the
// same Program and verdicts — both use the same Program so SignalIds are identical.
test('G4 — single-module parity: driver output equals direct checker output', () => {
  const src = `
import { signal, sync } from '@nv/core'
const a = signal(0)
const b = signal(0)
sync(() => b(), a)
sync(() => a(), b)
`
  const { program, nvCorePath } = makeTestProgram(src)
  const config = { nvCorePath }

  // Direct call (ground truth)
  const classifier = new SyncTargetClassifier(config)
  const directVerdicts = classifier.classifyProgram(program)
  const checker = new WriteGraphCycleChecker(config)
  const directCycles: CycleReport[] = checker.check(program, directVerdicts)

  // Driver
  const result = checkProgram(program, config)

  // Verdict count and kinds must match exactly
  expect(result.verdicts.length).toBe(directVerdicts.length)
  for (let i = 0; i < directVerdicts.length; i++) {
    // Bind locals so TypeScript narrows the discriminated union correctly;
    // element-access results are not narrowed across separate statements under strict.
    const rv = result.verdicts[i]!
    const dv = directVerdicts[i]!
    expect(rv.kind).toBe(dv.kind)
    if (rv.kind === 'ACCEPT' && dv.kind === 'ACCEPT') {
      // Same Program → same SignalIds → exact set equality
      expect(rv.targets).toEqual(dv.targets)
    }
  }

  // Cycle count must match; each cycle path must contain the same signal IDs
  expect(result.cycles.length).toBe(directCycles.length)
  for (let i = 0; i < directCycles.length; i++) {
    const dr = directCycles[i]!
    const dv = result.cycles[i]!
    // Same Program → same IDs; normalize by sorting before comparing
    expect([...dv.cycle].sort()).toEqual([...dr.cycle].sort())
    expect(dv.involvedSyncs.length).toBe(dr.involvedSyncs.length)
  }
})

// ── G5: conservative on incompleteness ───────────────────────────────────────
test('G5 — conservative on incompleteness: unresolvable read does not throw or fabricate cycle', () => {
  const src = `
import { signal, sync } from '@nv/core'
const a = signal(0)
const b = signal(0)
// Source reads inside a nested function body → PARTIAL/UNKNOWN (§8.5.3)
sync(() => { function inner() { return a() } return inner() }, b)
`
  const { program, nvCorePath } = makeTestProgram(src)
  let result: ReturnType<typeof checkProgram> | undefined
  expect(() => {
    result = checkProgram(program, { nvCorePath })
  }).not.toThrow()
  expect(result!.cycles).toHaveLength(0)
})

// ── Diagnostic mapping ────────────────────────────────────────────────────────
test('REJECT verdict produces error diagnostic', () => {
  // Write target is a thunk whose body is a CallExpression — Path B enumeration
  // sees a CallExpression → NON_ENUMERABLE → REJECT. The thunk return type must
  // be a recognized nv signal type so Path B fires; the body being a call means
  // the signal identity depends on runtime → provably non-enumerable.
  const src = `
import { signal, sync } from '@nv/core'
const a = signal(0)
const getSignal = (): typeof a => a
sync(() => 0, () => getSignal())
`
  const { program, nvCorePath } = makeTestProgram(src)
  const result = checkProgram(program, { nvCorePath })
  const errors = result.diagnostics.filter((d) => d.severity === 'error')
  expect(errors.length).toBeGreaterThan(0)
})

test('UNDECIDABLE verdict produces warn diagnostic', () => {
  // any-typed signal — UNDECIDABLE (cannot prove it's an nv signal)
  const src = `
import { signal, sync } from '@nv/core'
const a = signal(0)
declare const maybeSignal: any
sync(() => a(), maybeSignal)
`
  const { program, nvCorePath } = makeTestProgram(src)
  const result = checkProgram(program, { nvCorePath })
  const warns = result.diagnostics.filter((d) => d.severity === 'warn')
  expect(warns.length).toBeGreaterThan(0)
})

test('cycle produces error diagnostics with cycle path on involvedSyncs', () => {
  const src = `
import { signal, sync } from '@nv/core'
const a = signal(0)
const b = signal(0)
sync(() => b(), a)
sync(() => a(), b)
`
  const { program, nvCorePath } = makeTestProgram(src)
  const result = checkProgram(program, { nvCorePath })
  expect(result.cycles.length).toBeGreaterThan(0)
  const cycleErrors = result.diagnostics.filter(
    (d) => d.severity === 'error' && d.message.includes('→'),
  )
  // One error per involvedSync call node
  expect(cycleErrors.length).toBe(result.cycles[0]!.involvedSyncs.length)
})
