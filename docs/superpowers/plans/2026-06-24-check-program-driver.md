# §8.5.2 Build-Integration Driver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver `src/compiler/check-program.ts` — a pure-analysis entry point that accepts a caller-constructed `ts.Program` and returns `{ verdicts, cycles, diagnostics }`, turning §8.5.2 on for hand-written `sync()` in user source.

**Architecture:** Thin orchestration layer over the existing `SyncTargetClassifier` + `WriteGraphCycleChecker` libraries. Those two remain Program-receivers; this unit calls them in sequence and maps verdicts to diagnostics. One new file (`check-program.ts`), one barrel export addition, one new test file. No classifier/checker changes. No core touch.

**Tech Stack:** TypeScript, `typescript` (compiler API), vitest. Existing test infra: `makeTestProgram` + `getVerdicts` from `test/compiler/test-helpers.ts`.

## Global Constraints

- G0 hard stop: `git diff src/core/core.ts` EMPTY; no DOM identifier in `check-program.ts`; `sync-target-classifier.ts` and `write-graph-cycle-checker.ts` touched as callees only (no signature/behavior change)
- G1: `git diff src/compiler/signal-type-utils.ts` EMPTY
- No second `SignalId` scheme — only `signalSymbolId` derivation used
- Diagnostic severity derives from verdict-kind semantics in `types.ts`: REJECT → error (provably wrong); UNDECIDABLE → warn (conservative fallback); ACCEPT → no diagnostic unless cycle found → error
- `check-program.ts` is pure analysis: no emit, no `core.ts` import, no DOM
- No tsconfig/module-resolution policy on the core path of `checkProgram`
- Contract v0.4.2 unchanged — no version bump
- SyncBinding IR-literal edges out of scope (§0.1 boundary)

---

## Files

- Create: `src/compiler/check-program.ts`
- Modify: `src/compiler/index.ts` (add exports)
- Create: `test/compiler/check-program.test.ts`

---

### Task 1: `check-program.ts` — entry point + result type + diagnostic mapping

**Files:**
- Create: `src/compiler/check-program.ts`
- Modify: `src/compiler/index.ts`
- Test: `test/compiler/check-program.test.ts`

**Interfaces:**

Produces (exported from `check-program.ts` and re-exported from `index.ts`):
```typescript
export interface CheckProgramDiagnostic {
  severity: 'error' | 'warn'
  message: string
  file: string
  line: number        // 1-based
  column: number      // 1-based
  callNode: ts.CallExpression
}

export interface CheckProgramResult {
  verdicts: TargetVerdict[]
  cycles: CycleReport[]
  diagnostics: CheckProgramDiagnostic[]
}

export function checkProgram(
  program: ts.Program,
  config: ClassifierConfig,
): CheckProgramResult
```

Diagnostic mapping (from `types.ts` verdict-kind semantics):
- `REJECT` verdict → `severity: 'error'`, message = `verdict.diagnostic` (already a user-facing string)
- `UNDECIDABLE` verdict → `severity: 'warn'`, message = `verdict.reason`
- `ACCEPT` verdict with no cycle → no diagnostic
- Cycle → `severity: 'error'` per `involvedSyncs` call node; message names the cycle path (`cycle.join(' → ')`)

Location (file/line/col) is derived from `callNode` via `program.getSourceFile(callNode.getSourceFile().fileName)` + `ts.getLineAndCharacterOfPosition`.

- [ ] **Step 1: Write failing tests** (G2–G5 + parity, all RED)

Create `test/compiler/check-program.test.ts`:

```typescript
/**
 * check-program driver — Gate tests G2–G5 + single-module parity
 * Contract: §8.5.2
 */
import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as os from 'node:os'
import * as ts from 'typescript'
import { expect, test } from 'vitest'
import { checkProgram } from '../../src/compiler/check-program.js'
import { SyncTargetClassifier } from '../../src/compiler/sync-target-classifier.js'
import { WriteGraphCycleChecker } from '../../src/compiler/write-graph-cycle-checker.js'
import type { CycleReport } from '../../src/compiler/types.js'
import { makeTestProgram, PROJECT_CORE_PATH } from './test-helpers.js'

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

function makeTwoFileResult(
  srcA: string,
  srcB: string,
): ReturnType<typeof checkProgram> {
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
  expect(() => { result = checkProgram(program, { nvCorePath }) }).not.toThrow()
  expect(result!.cycles).toHaveLength(0)
})

// ── Diagnostic mapping ────────────────────────────────────────────────────────
test('REJECT verdict produces error diagnostic', () => {
  // Write target is a thunk returning a dynamic array element — Path B enumeration
  // sees a non-literal index → NON_ENUMERABLE → REJECT. A bare `sigs[i]!` (no thunk)
  // would be classified as Path A (direct signal type) → UNDECIDABLE, not REJECT.
  const src = `
import { signal, sync } from '@nv/core'
const sigs = [signal(0), signal(1)]
const i = Math.floor(Math.random() * 2)
// @ts-ignore — thunk return type intentionally mismatched to force Path B
sync(() => 0, () => sigs[i]!)
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
```

- [ ] **Step 2: Run tests — confirm all RED**

```bash
cd /Users/kofi/_/view && npx vitest run test/compiler/check-program.test.ts
```

Expected: all fail with "Cannot find module `check-program`".

- [ ] **Step 3: Implement `src/compiler/check-program.ts`**

```typescript
import * as ts from 'typescript'
import type { ClassifierConfig, CycleReport, TargetVerdict } from './types.js'
import { SyncTargetClassifier } from './sync-target-classifier.js'
import { WriteGraphCycleChecker } from './write-graph-cycle-checker.js'

export interface CheckProgramDiagnostic {
  severity: 'error' | 'warn'
  message: string
  file: string
  line: number
  column: number
  callNode: ts.CallExpression
}

export interface CheckProgramResult {
  verdicts: TargetVerdict[]
  cycles: CycleReport[]
  diagnostics: CheckProgramDiagnostic[]
}

export function checkProgram(
  program: ts.Program,
  config: ClassifierConfig,
): CheckProgramResult {
  // Step 1: classify all sync() calls in the program
  const classifier = new SyncTargetClassifier(config)
  const verdicts = classifier.classifyProgram(program)

  // Step 2: build write-graph and detect cycles
  const checker = new WriteGraphCycleChecker(config)
  const cycles = checker.check(program, verdicts)

  // Step 3: map verdicts and cycles → diagnostics
  const diagnostics: CheckProgramDiagnostic[] = []

  for (const verdict of verdicts) {
    if (verdict.kind === 'REJECT') {
      diagnostics.push(makeDiagnostic('error', verdict.diagnostic, verdict.callNode, program))
    } else if (verdict.kind === 'UNDECIDABLE') {
      diagnostics.push(makeDiagnostic('warn', verdict.reason, verdict.callNode, program))
    }
    // ACCEPT: no diagnostic unless it is part of a cycle (handled below)
  }

  for (const cycle of cycles) {
    const message = `[nv] §8.5.2 write-graph cycle detected: ${cycle.cycle.join(' → ')}`
    for (const callNode of cycle.involvedSyncs) {
      diagnostics.push(makeDiagnostic('error', message, callNode, program))
    }
  }

  return { verdicts, cycles, diagnostics }
}

function makeDiagnostic(
  severity: 'error' | 'warn',
  message: string,
  callNode: ts.CallExpression,
  program: ts.Program,
): CheckProgramDiagnostic {
  const sf = callNode.getSourceFile()
  const pos = ts.getLineAndCharacterOfPosition(sf, callNode.getStart())
  return {
    severity,
    message,
    file: sf.fileName,
    line: pos.line + 1,
    column: pos.character + 1,
    callNode,
  }
}
```

- [ ] **Step 4: Export from `src/compiler/index.ts`**

Add to `src/compiler/index.ts`:

```typescript
export { checkProgram } from './check-program.js'
export type { CheckProgramResult, CheckProgramDiagnostic } from './check-program.js'
```

- [ ] **Step 5: Run tests — confirm all GREEN**

```bash
cd /Users/kofi/_/view && npx vitest run test/compiler/check-program.test.ts
```

Expected: all pass.

- [ ] **Step 6: Run full suite + typecheck**

```bash
cd /Users/kofi/_/view && npm run typecheck && npx vitest run
```

Expected: 0 type errors, all existing tests still pass.

- [ ] **Step 7: Verify G0/G1 hard stops**

```bash
cd /Users/kofi/_/view && git diff HEAD -- src/core/core.ts src/compiler/signal-type-utils.ts src/compiler/sync-target-classifier.ts src/compiler/write-graph-cycle-checker.ts
```

Expected: empty (no diff on any of these files).

- [ ] **Step 8: Commit**

```bash
git add src/compiler/check-program.ts src/compiler/index.ts test/compiler/check-program.test.ts
git commit -m "feat(compiler): checkProgram driver — §8.5.2 build-integration entry point (G2–G5 green)"
```

## Self-Review

**Spec coverage:**
- Entry-point signature accepting caller-constructed `ts.Program` + `ClassifierConfig` ✓
- Returns `{ verdicts, cycles, diagnostics }` ✓
- Diagnostic mapping from `types.ts` verdict-kind semantics ✓
- G2 (cross-module cycle detected) ✓
- G3 (no false positive on acyclic) ✓
- G4 (single-module parity with direct checker call) ✓
- G5 (conservative on incompleteness — no throw, no fabricated cycle) ✓
- G0: no core.ts touch, no DOM, classifier/checker untouched ✓
- G1: signal-type-utils.ts untouched ✓
- No SyncBinding IR-literal recognition ✓
- No tsconfig/module-resolution policy on core path ✓

**Type consistency:**
- `CheckProgramResult.verdicts` is `TargetVerdict[]` — matches `classifyProgram` return type ✓
- `CheckProgramResult.cycles` is `CycleReport[]` — matches `check` return type ✓
- `CheckProgramDiagnostic.callNode` is `ts.CallExpression` — same as in `TargetVerdict` and `CycleReport.involvedSyncs` ✓
