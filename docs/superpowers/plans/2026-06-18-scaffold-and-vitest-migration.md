# @neutro/view Scaffold + Vitest Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place all PK source/test/doc files into the repo scaffold at their kebab-case paths, fix all imports to the settled style, and migrate the custom test harness to vitest — leaving both standing gates green (typecheck + test), build clean, and lint clean.

**Architecture:** Single published package `@neutro/view` with subpath exports (`/core`, `/compiler`, `/renderer`). Source under `src/`, tests mirror under `test/`, cross-concern tests under `integration/`. All internal imports are relative + extensionless; `@neutro/view/*` aliases are external-only. The PK test harness uses a custom `test()` + `node:assert/strict` pattern that is **incompatible with vitest** (it never calls vitest's test registration functions, and calls `process.exit(1)` on failure which kills the vitest process). All test files must be converted to vitest's native API.

**Tech Stack:** TypeScript 5.6 strict, Vitest 2.1, Biome 1.9, jsdom 25, lefthook, pnpm 9.12.

## Global Constraints

- `moduleResolution: "bundler"` → extensionless relative imports everywhere inside `src/`, `test/`, `integration/`
- `verbatimModuleSyntax: true` + biome `"useImportType": "error"` → type-only imports must use `import type { … }`
- `globals: false` in vitest config → every test file must `import { test, expect } from 'vitest'`
- `src/core/index.ts` must NOT re-export `__test` (it is test-only instrumentation)
- Cross-concern internal imports are relative: e.g. `import { effect } from '../core/core'`, never `@neutro/view/core`
- No `.ts` extensions on import paths
- Do **not** migrate `PK/core_ts6_patched.ts` — it is obsolete (superseded by `Node`→`ReactiveNode` rename)

### assert → expect quick-reference (used throughout)

```
assert.equal(a, b)         → expect(a).toBe(b)
assert.equal(a, b, msg)    → expect(a, msg).toBe(b)
assert.deepEqual(a, b)     → expect(a).toEqual(b)
assert.deepEqual(a, b, msg)→ expect(a, msg).toEqual(b)
assert.ok(v, msg)          → expect(v, msg).toBeTruthy()
assert.throws(fn, /re/)    → expect(fn).toThrow(/re/)
assert.doesNotThrow(fn)    → expect(fn).not.toThrow()
assert.notEqual(a, b, msg) → expect(a, msg).not.toBe(b)
```

---

## File Structure

**Created:**
- `src/core/core.ts` — runtime (PK/core.ts, kebab path was already same)
- `src/compiler/types.ts` — shared compiler types (PK/types.ts)
- `src/compiler/signal-type-utils.ts` — (PK/signalTypeUtils.ts)
- `src/compiler/sync-target-classifier.ts` — (PK/syncTargetClassifier.ts)
- `src/compiler/write-graph-cycle-checker.ts` — (PK/writeGraphCycleChecker.ts)
- `src/compiler/equality-policy-inference.ts` — (PK/equalityPolicyInference.ts)
- `src/compiler/branch-variant-analyzer.ts` — (PK/branchVariantAnalyzer.ts)
- `src/renderer/ir.ts` — (PK/ir.ts)
- `src/renderer/html-tag.ts` — (PK/htmlTag.ts)
- `src/renderer/interpreter.ts` — (PK/interpreter.ts)
- `src/renderer/comparator.ts` — (PK/comparator.ts)
- `test/core/conformance.test.ts` — (PK/conformance.ts, vitest migration)
- `test/compiler/test-helpers.ts` — (PK/testHelpers.ts, path fix + stripped of harness exports)
- `test/compiler/variant-runtime-harness.ts` — (PK/variantRuntimeHarness.ts)
- `test/compiler/sync-target-classifier.test.ts` — (PK/syncTargetClassifier.test.ts)
- `test/compiler/write-graph-cycle-checker.test.ts` — (PK/writeGraphCycleChecker.test.ts)
- `test/compiler/equality-policy-inference.test.ts` — (PK/equalityPolicyInference.test.ts)
- `test/compiler/branch-variant-analyzer.test.ts` — (PK/branchVariantAnalyzer.test.ts)
- `test/compiler/branch-variant-runtime.test.ts` — (PK/branchVariantRuntime.test.ts)
- `test/renderer/interpreter.test.ts` — (PK/interpreter_test.ts)
- `integration/poc-integration.test.ts` — (PK/poc_integration.ts)
- `docs/reactive-core-contract.md` — (PK/nv-reactive-core-contract.md)
- `docs/decision-log.md` — (PK/nv-decision-log.md)
- `docs/template-ir.md` — (PK/nv-template-ir.md)
- `docs/design/step4-soundness-design.md` — (PK/step4-soundness-design.md)
- `docs/decision-log-archive.md` — (new empty file)

**Modified:**
- `src/core/index.ts` — already correct; just verify
- `src/compiler/index.ts` — already correct; just verify
- `src/renderer/index.ts` — already correct; just verify

---

## Task 1: Setup — install deps + create directories + place docs

**Files:**
- Create: `test/core/` `test/compiler/` `test/renderer/` `integration/` dirs
- Create: `docs/reactive-core-contract.md` `docs/decision-log.md` `docs/template-ir.md` `docs/design/step4-soundness-design.md` `docs/decision-log-archive.md`

**Interfaces:**
- Produces: pnpm lockfile resolved; all test/integration dirs exist; docs placed

- [ ] **Step 1: Install dependencies**

```bash
pnpm install
```
Expected: no errors; `node_modules/` populated with vitest, typescript, jsdom, biome, lefthook.

- [ ] **Step 2: Create directory structure**

```bash
mkdir -p test/core test/compiler test/renderer integration docs/design
```
Expected: directories exist with no output.

- [ ] **Step 3: Place docs**

Copy each doc file from PK to the repo:
```bash
cp PK/nv-reactive-core-contract.md docs/reactive-core-contract.md
cp PK/nv-decision-log.md docs/decision-log.md
cp PK/nv-template-ir.md docs/template-ir.md
cp PK/step4-soundness-design.md docs/design/step4-soundness-design.md
touch docs/decision-log-archive.md
```

- [ ] **Step 4: Verify docs landed**

```bash
ls docs/
ls docs/design/
```
Expected: `reactive-core-contract.md  decision-log.md  template-ir.md  design/  decision-log-archive.md` (plus existing files).

- [ ] **Step 5: Commit**

```bash
git add test/ integration/ docs/
git commit -m "scaffold: create directories, install deps, place docs"
```

---

## Task 2: Place + wire core runtime (`src/core/core.ts`)

**Files:**
- Create: `src/core/core.ts`
- Verify: `src/core/index.ts` (no change needed)

**Interfaces:**
- Consumes: nothing
- Produces: `signal`, `derived`, `effect`, `sync`, `pubsub`, `errorBoundary`, `batch`, `untrack`, `createRoot`, `onCleanup`, `flushSync` value exports; `SignalAccessor`, `DerivedAccessor`, `PubSub`, `ExternalSource` type exports; `__test` (test-only, NOT in barrel)

- [ ] **Step 1: Copy core.ts**

```bash
cp PK/core.ts src/core/core.ts
```

- [ ] **Step 2: Check for .ts extension imports inside core.ts**

```bash
grep -n "from '.*\.ts'" src/core/core.ts
```
Expected: no matches (core.ts should have no imports from other files, it is self-contained).

- [ ] **Step 3: Verify the barrel matches reality**

Read `src/core/index.ts`. Confirm every name in the `export { … } from './core'` block exists as a named export in `src/core/core.ts`. Confirm `__test` is NOT listed.

```bash
grep -n "^export\|^  [a-z]" src/core/index.ts
grep -n "^export function\|^export const\|^export type\|^export interface" src/core/core.ts
```

Expected symbols in barrel: `signal derived effect sync pubsub errorBoundary batch untrack createRoot onCleanup flushSync` (values) + `SignalAccessor DerivedAccessor PubSub ExternalSource` (types). `__test` must not appear.

- [ ] **Step 4: Spot-check a key export exists**

```bash
grep -n "export.*flushSync\|export.*__test" src/core/core.ts
```
Expected: `flushSync` is exported; `__test` is also exported (for tests) but NOT re-exported by the barrel.

- [ ] **Step 5: Commit**

```bash
git add src/core/core.ts
git commit -m "scaffold: place src/core/core.ts (runtime)"
```

---

## Task 3: Place + wire compiler sources (`src/compiler/`)

**Files:**
- Create: `src/compiler/types.ts`
- Create: `src/compiler/signal-type-utils.ts`
- Create: `src/compiler/sync-target-classifier.ts`
- Create: `src/compiler/write-graph-cycle-checker.ts`
- Create: `src/compiler/equality-policy-inference.ts`
- Create: `src/compiler/branch-variant-analyzer.ts`
- Verify: `src/compiler/index.ts`

**Interfaces:**
- Consumes: nothing outside `src/compiler/`
- Produces: `SyncTargetClassifier`, `WriteGraphCycleChecker`, `EqualityPolicyInferencer`, `BranchVariantAnalyzer` class exports; `ClassifierConfig TargetVerdict EnumResult EqualityPolicy EqualityPolicyVerdict BranchVariantVerdict CycleReport SyncEdge ReadEnumResult SignalId` type exports

- [ ] **Step 1: Copy compiler source files with kebab-case names**

```bash
cp PK/types.ts              src/compiler/types.ts
cp PK/signalTypeUtils.ts    src/compiler/signal-type-utils.ts
cp PK/syncTargetClassifier.ts    src/compiler/sync-target-classifier.ts
cp PK/writeGraphCycleChecker.ts  src/compiler/write-graph-cycle-checker.ts
cp PK/equalityPolicyInference.ts src/compiler/equality-policy-inference.ts
cp PK/branchVariantAnalyzer.ts   src/compiler/branch-variant-analyzer.ts
```

- [ ] **Step 2: Audit imports in each compiler file**

Find all relative imports that still use camelCase or `.ts` extensions:
```bash
grep -rn "from '\./" src/compiler/
```

For each match, apply these rewrite rules (extensionless kebab-case):
- `'./types.ts'` or `'./types'` → `'./types'` (already fine if no extension)
- `'./signalTypeUtils.ts'` or `'./signalTypeUtils'` → `'./signal-type-utils'`
- `'./syncTargetClassifier.ts'` → `'./sync-target-classifier'`
- `'./writeGraphCycleChecker.ts'` → `'./write-graph-cycle-checker'`
- `'./equalityPolicyInference.ts'` → `'./equality-policy-inference'`
- `'./branchVariantAnalyzer.ts'` → `'./branch-variant-analyzer'`

Use Edit tool to fix each import occurrence. Example edit in `sync-target-classifier.ts`:
```ts
// BEFORE
import { isNvSignalType } from './signalTypeUtils.ts'
import type { ClassifierConfig, TargetVerdict } from './types.ts'

// AFTER
import { isNvSignalType } from './signal-type-utils'
import type { ClassifierConfig, TargetVerdict } from './types'
```

- [ ] **Step 3: Verify barrel matches placed files**

Read `src/compiler/index.ts`. Confirm:
- `SyncTargetClassifier` exported from `./sync-target-classifier` — exists in that file
- `WriteGraphCycleChecker` exported from `./write-graph-cycle-checker` — exists
- `EqualityPolicyInferencer` exported from `./equality-policy-inference` — exists
- `BranchVariantAnalyzer` exported from `./branch-variant-analyzer` — exists
- All listed types from `./types` exist in `src/compiler/types.ts`

```bash
grep -n "^export class\|^export function\|^export const\|^export type\|^export interface" src/compiler/*.ts
```

- [ ] **Step 4: Confirm no @neutro/view aliases inside src/**

```bash
grep -rn "@neutro/view" src/compiler/
```
Expected: zero matches (aliases are external-only).

- [ ] **Step 5: Commit**

```bash
git add src/compiler/
git commit -m "scaffold: place src/compiler/* (5 source files, kebab-case, import rewrites)"
```

---

## Task 4: Place + wire renderer sources (`src/renderer/`)

**Files:**
- Create: `src/renderer/ir.ts`
- Create: `src/renderer/html-tag.ts`
- Create: `src/renderer/interpreter.ts`
- Create: `src/renderer/comparator.ts`
- Verify: `src/renderer/index.ts`

**Interfaces:**
- Consumes: `src/core/core.ts` via relative cross-concern import `../core/core`
- Produces: `mount` (interpreter.ts), `createHtmlTag` (html-tag.ts), `structurallyEqual` (comparator.ts); all IR types from ir.ts

- [ ] **Step 1: Copy renderer source files**

```bash
cp PK/ir.ts          src/renderer/ir.ts
cp PK/htmlTag.ts     src/renderer/html-tag.ts
cp PK/interpreter.ts src/renderer/interpreter.ts
cp PK/comparator.ts  src/renderer/comparator.ts
```

- [ ] **Step 2: Fix intra-renderer imports (html-tag.ts)**

```bash
grep -n "from '\./" src/renderer/html-tag.ts
```
Expected: `from './ir.ts'` or `from './ir'`. If extension present, remove it:
```ts
// BEFORE
import type { … } from './ir.ts'
// AFTER
import type { … } from './ir'
```

- [ ] **Step 3: Fix cross-concern import in interpreter.ts (CRITICAL)**

The PK version imports core as `./core.ts` (relative to PK dir) or a patched copy. In the repo, core is in the sibling concern:
```bash
grep -n "from '.*core" src/renderer/interpreter.ts
```

Change any core import to the relative cross-concern form:
```ts
// BEFORE (any of these)
import { effect, createRoot, onCleanup } from './core.ts'
import { effect, createRoot, onCleanup } from './core'
// AFTER
import { effect, createRoot, onCleanup } from '../core/core'
```

The exact imports depend on what interpreter.ts uses — use the same names, just fix the path.

- [ ] **Step 4: Fix comparator.ts imports if any**

```bash
grep -n "from '\./" src/renderer/comparator.ts
```
Apply same kebab-case + extensionless rules to any imports.

- [ ] **Step 5: Verify barrel matches placed files**

Read `src/renderer/index.ts`. Confirm:
- `mount` exported from `./interpreter`
- `createHtmlTag` exported from `./html-tag`
- `structurallyEqual` exported from `./comparator`
- All listed types from `./ir`

```bash
grep -n "^export function\|^export const\|^export class" src/renderer/*.ts
```

- [ ] **Step 6: Confirm no @neutro/view aliases and no .ts extensions**

```bash
grep -rn "@neutro/view\|from '.*\.ts'" src/renderer/
```
Expected: zero matches.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/
git commit -m "scaffold: place src/renderer/* (4 source files, cross-concern import wired)"
```

---

## Task 5: Transform + place core conformance test

**Files:**
- Create: `test/core/conformance.test.ts`

**Interfaces:**
- Consumes: `src/core/core.ts` via `../../src/core/core`
- Produces: 36 vitest tests (§12.1–§12.23, §fuzz, §B2–§B8 with B5a/B5b)

**Why vitest migration is mandatory:** The PK custom `test()` function never calls vitest's test registration API. vitest would report 0 tests. Worse, if any custom test fails, `process.exit(1)` terminates the vitest process. Both outcomes are broken.

- [ ] **Step 1: Copy conformance.ts as starting point**

```bash
cp PK/conformance.ts test/core/conformance.test.ts
```

- [ ] **Step 2: Replace the import block**

In `test/core/conformance.test.ts`:

```ts
// REMOVE these lines
import assert from 'node:assert/strict'
import {
  signal, derived, effect, sync, pubsub,
  batch, untrack, createRoot, onCleanup, errorBoundary,
  flushSync, __test,
} from '../src/core.ts'

// ADD at top instead
import { test, expect } from 'vitest'
import {
  signal, derived, effect, sync, pubsub,
  batch, untrack, createRoot, onCleanup, errorBoundary,
  flushSync, __test,
} from '../../src/core/core'
```

- [ ] **Step 3: Remove the custom harness boilerplate**

Delete these lines entirely:
```ts
let passed = 0
let failed = 0

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const r = fn()
    if (r instanceof Promise) {
      r.then(() => { passed++; console.log(`  ✓ ${name}`) })
       .catch((e: unknown) => { failed++; console.error(`  ✗ ${name}\n    ${e}`) })
    } else {
      passed++
      console.log(`  ✓ ${name}`)
    }
  } catch (e) {
    failed++
    console.error(`  ✗ ${name}\n    ${e}`)
  }
}
```

- [ ] **Step 4: Remove the tail (summary + async wait)**

Delete the final lines:
```ts
// Give async tests a tick to complete
await new Promise((r) => setTimeout(r, 100))

const total = passed + failed
console.log(`\n${passed}/${total} passed${failed > 0 ? `  (${failed} FAILED)` : ''}`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 5: Replace assert calls — apply conversion table globally**

Open `test/core/conformance.test.ts`. Replace all occurrences using this exact mapping:

| Find | Replace |
|------|---------|
| `assert.equal(` | `expect(` → needs manual reorder (see below) |
| `assert.deepEqual(` | similarly |
| `assert.ok(` | similarly |
| `assert.throws(` | `expect(` |
| `assert.doesNotThrow(` | `expect(` |
| `assert.notEqual(` | `expect(` |

**Pattern for `assert.equal(actual, expected, msg?)`:**
```ts
// BEFORE
assert.equal(val, 5, 'D should be 2+3=5')
assert.equal(dRuns, 1, 'D computed more than once — run-once violated')
assert.deepEqual(seen[0], [1, 2], 'Effect saw intermediate state')
assert.ok(runs < 10_000, `Effect ran ${runs} times — cascade cap not working`)
assert.throws(() => D(), /deliberate/, 'Should re-throw cached error')
assert.doesNotThrow(() => D())
assert.notEqual(verdicts[0].kind, 'ACCEPT', 'Classifier must never...')

// AFTER
expect(val, 'D should be 2+3=5').toBe(5)
expect(dRuns, 'D computed more than once — run-once violated').toBe(1)
expect(seen[0], 'Effect saw intermediate state').toEqual([1, 2])
expect(runs, `Effect ran ${runs} times — cascade cap not working`).toBeLessThan(10_000)
expect(() => D()).toThrow(/deliberate/)
expect(() => D()).not.toThrow()
expect(verdicts[0].kind, 'Classifier must never...').not.toBe('ACCEPT')
```

Note: `assert.ok(runs < 10_000, msg)` → `expect(runs, msg).toBeLessThan(10_000)` (more precise than `.toBeTruthy()`). For plain `assert.ok(value)` with no arithmetic, use `.toBeTruthy()`.

For `assert.ok(runs > 0, 'Effect never ran')`:
```ts
expect(runs, 'Effect never ran').toBeGreaterThan(0)
```

- [ ] **Step 6: Verify test count in the file**

```bash
grep -c "^test(" test/core/conformance.test.ts
```
Expected: **36**

- [ ] **Step 7: Commit**

```bash
git add test/core/conformance.test.ts
git commit -m "scaffold: place + vitest-migrate test/core/conformance.test.ts (36 tests)"
```

---

## Task 6: Transform + place compiler test helpers

**Files:**
- Create: `test/compiler/test-helpers.ts`
- Create: `test/compiler/variant-runtime-harness.ts`

**Interfaces:**
- Produces (from test-helpers): `PROJECT_CORE_PATH`, `makeTestProgram`, `getVerdicts`, `nvCoreInTmp` — all still exported; `test`/`passed`/`failed`/`summarize` are NOT exported (consumers use vitest's `test` directly)
- Produces (from variant-runtime-harness): `HarnessSignal`, `HarnessDerived` (no change needed — no test harness in this file)

- [ ] **Step 1: Copy variant-runtime-harness.ts**

```bash
cp PK/variantRuntimeHarness.ts test/compiler/variant-runtime-harness.ts
```

No harness boilerplate exists in this file — it is a pure helper class. No vitest migration needed.

- [ ] **Step 2: Check variant-runtime-harness.ts for any .ts imports**

```bash
grep -n "from '\./" test/compiler/variant-runtime-harness.ts
```
Expected: no imports (it is self-contained). If any exist, remove `.ts` extensions.

- [ ] **Step 3: Copy testHelpers.ts as starting point**

```bash
cp PK/testHelpers.ts test/compiler/test-helpers.ts
```

- [ ] **Step 4: Fix PROJECT_CORE_PATH (sandbox path → real path)**

The PK version has:
```ts
export const PROJECT_CORE_PATH = path.resolve('/mnt/project/core.ts')
```

This is the **most critical fix** in this task. Replace the entire top of the file:

```ts
// REMOVE
import * as path from 'node:path'
// ... (keep the other node imports)
export const PROJECT_CORE_PATH = path.resolve('/mnt/project/core.ts')

// REPLACE WITH
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
// Add this to compute the path dynamically from this file's location:
const _dir = path.dirname(new URL(import.meta.url).pathname)
export const PROJECT_CORE_PATH = path.resolve(_dir, '../../src/core/core.ts')
```

The test-helpers file will live at `test/compiler/test-helpers.ts`. From there, `../../src/core/core.ts` resolves correctly to the runtime source.

- [ ] **Step 5: Fix SyncTargetClassifier import path**

```ts
// BEFORE
import { SyncTargetClassifier } from '../src/syncTargetClassifier'

// AFTER
import { SyncTargetClassifier } from '../../src/compiler/sync-target-classifier'
```

- [ ] **Step 6: Fix types import path**

```ts
// BEFORE
import type { ClassifierConfig, TargetVerdict } from '../src/types'

// AFTER
import type { ClassifierConfig, TargetVerdict } from '../../src/compiler/types'
```

- [ ] **Step 7: Remove the test harness exports**

Delete these exported items entirely (callers will use vitest's `test` directly):
```ts
// DELETE all of this
export let passed = 0
export let failed = 0

export function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`    ${e}`)
  }
}

export function summarize(): void {
  const total = passed + failed
  console.log(`\n${passed}/${total} passed${failed > 0 ? `  (${failed} FAILED)` : ''}`)
  if (failed > 0) process.exit(1)
}
```

- [ ] **Step 8: Verify the resulting test-helpers exports**

After edits, the file should export only:
- `PROJECT_CORE_PATH` (string constant)
- `nvCoreInTmp()` (copies core to tmp, returns path)
- `makeTestProgram(fixtureSource)` (returns `{ program, nvCorePath, fixtureFile }`)
- `getVerdicts(fixtureSource)` (returns `TargetVerdict[]`)

```bash
grep -n "^export" test/compiler/test-helpers.ts
```
Expected: 4 export lines, none named `test`, `passed`, `failed`, or `summarize`.

- [ ] **Step 9: Commit**

```bash
git add test/compiler/test-helpers.ts test/compiler/variant-runtime-harness.ts
git commit -m "scaffold: place + fix compiler test helpers (PROJECT_CORE_PATH, strip harness exports)"
```

---

## Task 7: Transform + place compiler tests (5 files)

**Files:**
- Create: `test/compiler/sync-target-classifier.test.ts`
- Create: `test/compiler/write-graph-cycle-checker.test.ts`
- Create: `test/compiler/equality-policy-inference.test.ts`
- Create: `test/compiler/branch-variant-analyzer.test.ts`
- Create: `test/compiler/branch-variant-runtime.test.ts`

**Interfaces:**
- Consumes: `test-helpers.ts` (getVerdicts, makeTestProgram, nvCoreInTmp), `../../src/compiler/*`, vitest
- Produces: 21 + 20 + 45 + 21 + 7 = **114 compiler tests**

### 7a: sync-target-classifier.test.ts

- [ ] **Step 1: Copy and rename**

```bash
cp PK/syncTargetClassifier.test.ts test/compiler/sync-target-classifier.test.ts
```

- [ ] **Step 2: Replace imports**

```ts
// REMOVE
import assert from 'node:assert/strict'
import { getVerdicts, test, summarize } from './testHelpers'
import type { TargetVerdict } from '../src/types'

// ADD
import { test, expect } from 'vitest'
import { getVerdicts } from './test-helpers'
import type { TargetVerdict } from '../../src/compiler/types'
```

- [ ] **Step 3: Convert assert calls**

`assertAccept`, `assertReject`, `assertUndecidable` are local helper functions that use `assert.*`. Convert their internals:

```ts
// BEFORE
function assertAccept(v: TargetVerdict, targetCount: number): Set<string> {
  assert.equal(v.kind, 'ACCEPT', `Expected ACCEPT, got ${v.kind}: ${'reason' in v ? v.reason : ''}`)
  if (v.kind !== 'ACCEPT') throw new Error('unreachable')
  assert.equal(v.targets.size, targetCount, `Expected ${targetCount} targets…`)
  return new Set(v.targets)
}

// AFTER
function assertAccept(v: TargetVerdict, targetCount: number): Set<string> {
  expect(v.kind, `Expected ACCEPT, got ${v.kind}: ${'reason' in v ? v.reason : ''}`).toBe('ACCEPT')
  if (v.kind !== 'ACCEPT') throw new Error('unreachable')
  expect(v.targets.size, `Expected ${targetCount} targets, got ${v.targets.size}`).toBe(targetCount)
  return new Set(v.targets)
}
```

Convert all other `assert.*` calls in test bodies using the global mapping table.

- [ ] **Step 4: Remove summarize()**

Delete the final line: `summarize()`

- [ ] **Step 5: Verify count**

```bash
grep -c "^test(" test/compiler/sync-target-classifier.test.ts
```
Expected: **21**

### 7b: write-graph-cycle-checker.test.ts

- [ ] **Step 6: Copy and rename**

```bash
cp PK/writeGraphCycleChecker.test.ts test/compiler/write-graph-cycle-checker.test.ts
```

- [ ] **Step 7: Replace imports**

```ts
// REMOVE
import assert from 'node:assert/strict'
import { SyncTargetClassifier } from '../src/syncTargetClassifier'
import { WriteGraphCycleChecker } from '../src/writeGraphCycleChecker'
import type { CycleReport, ReadEnumResult, TargetVerdict } from '../src/types'
import { getVerdicts, makeTestProgram, test, summarize, nvCoreInTmp } from './testHelpers'

// ADD
import { test, expect } from 'vitest'
import * as ts from 'typescript'
import { SyncTargetClassifier } from '../../src/compiler/sync-target-classifier'
import { WriteGraphCycleChecker } from '../../src/compiler/write-graph-cycle-checker'
import type { CycleReport, ReadEnumResult, TargetVerdict } from '../../src/compiler/types'
import { getVerdicts, makeTestProgram, nvCoreInTmp } from './test-helpers'
```

- [ ] **Step 8: Convert all assert calls + remove summarize()**

Apply global mapping table. Remove `summarize()` at end.

- [ ] **Step 9: Verify count**

```bash
grep -c "^test(" test/compiler/write-graph-cycle-checker.test.ts
```
Expected: **20**

### 7c: equality-policy-inference.test.ts

- [ ] **Step 10: Copy and rename**

```bash
cp PK/equalityPolicyInference.test.ts test/compiler/equality-policy-inference.test.ts
```

- [ ] **Step 11: Replace imports**

```ts
// REMOVE
import assert from 'node:assert/strict'
import * as ts from 'typescript'
import { EqualityPolicyInferencer } from '../src/equalityPolicyInference'
import type { EqualityPolicy, EqualityPolicyVerdict } from '../src/types'
import { makeTestProgram, test, summarize } from './testHelpers'

// ADD
import { test, expect } from 'vitest'
import * as ts from 'typescript'
import { EqualityPolicyInferencer } from '../../src/compiler/equality-policy-inference'
import type { EqualityPolicy, EqualityPolicyVerdict } from '../../src/compiler/types'
import { makeTestProgram } from './test-helpers'
```

- [ ] **Step 12: Convert all assert calls + remove summarize()**

Apply global mapping table. Remove `summarize()` at end.

- [ ] **Step 13: Verify count**

```bash
grep -c "^test(" test/compiler/equality-policy-inference.test.ts
```
Expected: **45**

### 7d: branch-variant-analyzer.test.ts

- [ ] **Step 14: Copy and rename**

```bash
cp PK/branchVariantAnalyzer.test.ts test/compiler/branch-variant-analyzer.test.ts
```

- [ ] **Step 15: Replace imports**

```ts
// REMOVE
import assert from 'node:assert/strict'
import * as ts from 'typescript'
import { BranchVariantAnalyzer } from '../src/branchVariantAnalyzer'
import type { BranchVariantVerdict } from '../src/types'
import { makeTestProgram, test, summarize } from './testHelpers'

// ADD
import { test, expect } from 'vitest'
import * as ts from 'typescript'
import { BranchVariantAnalyzer } from '../../src/compiler/branch-variant-analyzer'
import type { BranchVariantVerdict } from '../../src/compiler/types'
import { makeTestProgram } from './test-helpers'
```

- [ ] **Step 16: Convert all assert calls + remove summarize()**

Apply global mapping table. Remove `summarize()` at end.

- [ ] **Step 17: Verify count**

```bash
grep -c "^test(" test/compiler/branch-variant-analyzer.test.ts
```
Expected: **21**

### 7e: branch-variant-runtime.test.ts

- [ ] **Step 18: Copy and rename**

```bash
cp PK/branchVariantRuntime.test.ts test/compiler/branch-variant-runtime.test.ts
```

- [ ] **Step 19: Replace imports**

```ts
// REMOVE
import assert from 'node:assert/strict'
import { HarnessSignal, HarnessDerived } from './variantRuntimeHarness'
import { test, summarize } from './testHelpers'

// ADD
import { test, expect } from 'vitest'
import { HarnessSignal, HarnessDerived } from './variant-runtime-harness'
```

- [ ] **Step 20: Convert all assert calls + remove summarize()**

Apply global mapping table. Key pattern here — d._diverged assertions:
```ts
// BEFORE
assert.equal(d._diverged, false, 'no divergence on initial run with correct union')
// AFTER
expect(d._diverged, 'no divergence on initial run with correct union').toBe(false)
```

Remove `summarize()` at end.

- [ ] **Step 21: Verify count**

```bash
grep -c "^test(" test/compiler/branch-variant-runtime.test.ts
```
Expected: **7**

- [ ] **Step 22: Commit all compiler tests**

```bash
git add test/compiler/*.test.ts
git commit -m "scaffold: place + vitest-migrate compiler tests (21+20+45+21+7 = 114 tests)"
```

---

## Task 8: Transform + place renderer test

**Files:**
- Create: `test/renderer/interpreter.test.ts`

**Interfaces:**
- Consumes: `../../src/core/core` (__test, signal, flushSync), `../../src/renderer/interpreter` (mount), `../../src/renderer/html-tag` (createHtmlTag), `../../src/renderer/comparator` (structurallyEqual), `../../src/renderer/ir` (TemplateIR type)
- Produces: **34 renderer tests**
- Note: keeps explicit `new JSDOM(…)` (not vitest-environment jsdom) — jsdom is in devDeps; explicit setup is more controlled

- [ ] **Step 1: Copy as starting point**

```bash
cp PK/interpreter_test.ts test/renderer/interpreter.test.ts
```

- [ ] **Step 2: Replace imports**

```ts
// REMOVE
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { signal, flushSync, __test } from './core.ts'
import { createHtmlTag } from './htmlTag.ts'
import { mount } from './interpreter.ts'
import { structurallyEqual } from './comparator.ts'
import type { TemplateIR, ChildBinding, PropBinding, EventBinding, ConditionalBinding, TextBinding } from './ir.ts'

// ADD
import { test, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { signal, flushSync, __test } from '../../src/core/core'
import { createHtmlTag } from '../../src/renderer/html-tag'
import { mount } from '../../src/renderer/interpreter'
import { structurallyEqual } from '../../src/renderer/comparator'
import type { TemplateIR, ChildBinding, PropBinding, EventBinding, ConditionalBinding, TextBinding } from '../../src/renderer/ir'
```

- [ ] **Step 3: Remove the custom test harness boilerplate**

Delete:
```ts
let passed = 0
let failed = 0

function test(name: string, fn: () => void): void { … }

function summarize(): void { … }
```

- [ ] **Step 4: Convert assert calls**

Apply global mapping. Key renderer-specific pattern:
```ts
// BEFORE
assert.ok(structurallyEqual(parent, expected('<span>Hello</span>')), 'text binding wrong')
assert.equal(__test.observerCount(sig), 0, 'signal still has observers after dispose')

// AFTER
expect(structurallyEqual(parent, expected('<span>Hello</span>')), 'text binding wrong').toBe(true)
expect(__test.observerCount(sig), 'signal still has observers after dispose').toBe(0)
```

- [ ] **Step 5: Remove summarize() at end**

Delete final `summarize()` call.

- [ ] **Step 6: Verify count**

```bash
grep -c "^test(" test/renderer/interpreter.test.ts
```
Expected: **34**

- [ ] **Step 7: Commit**

```bash
git add test/renderer/interpreter.test.ts
git commit -m "scaffold: place + vitest-migrate test/renderer/interpreter.test.ts (34 tests)"
```

---

## Task 9: Transform + place integration test

**Files:**
- Create: `integration/poc-integration.test.ts`

**Interfaces:**
- Consumes: `../src/core/core`, `../src/renderer/interpreter`, `../src/renderer/ir` (type), `../src/compiler/sync-target-classifier`, `../src/compiler/write-graph-cycle-checker`, `../src/compiler/types` (types)
- Produces: **15 integration tests**
- Note: also uses `typescript`, `node:fs`, `node:os`, `node:path`, `jsdom` — all in devDeps

- [ ] **Step 1: Copy as starting point**

```bash
cp PK/poc_integration.ts integration/poc-integration.test.ts
```

- [ ] **Step 2: Replace the import block**

```ts
// REMOVE
import assert from 'node:assert/strict'
import * as ts from 'typescript'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { JSDOM } from 'jsdom'
import { signal, derived, flushSync, __test } from './core.ts'
import { mount } from './interpreter.ts'
import type { TemplateIR } from './ir.ts'
import { SyncTargetClassifier } from './syncTargetClassifier.ts'
import { WriteGraphCycleChecker } from './writeGraphCycleChecker.ts'
import type { ClassifierConfig, TargetVerdict } from './types.ts'

// ADD
import { test, expect } from 'vitest'
import * as ts from 'typescript'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import { JSDOM } from 'jsdom'
import { signal, derived, flushSync, __test } from '../src/core/core'
import { mount } from '../src/renderer/interpreter'
import type { TemplateIR } from '../src/renderer/ir'
import { SyncTargetClassifier } from '../src/compiler/sync-target-classifier'
import { WriteGraphCycleChecker } from '../src/compiler/write-graph-cycle-checker'
import type { ClassifierConfig, TargetVerdict } from '../src/compiler/types'
```

- [ ] **Step 3: Fix the core path constant inside the file**

The integration test has an inline core-path constant (similar to test-helpers) for building TypeScript fixtures. Find and fix it:

```bash
grep -n "mnt/project\|core\.ts\|PROJECT_CORE" integration/poc-integration.test.ts
```

Replace any sandbox path with a dynamic one derived from `import.meta.url`:
```ts
// BEFORE
const nvCorePath = path.resolve('/mnt/project/core.ts')

// AFTER — add near top of file, before any test
const _dir = nodePath.dirname(new URL(import.meta.url).pathname)
const nvCorePath = nodePath.resolve(_dir, '../src/core/core.ts')
```

- [ ] **Step 4: Remove the custom test harness boilerplate**

Delete:
```ts
let passed = 0
let failed = 0
function test(name: string, fn: () => void): void { … }
// (and any summarize function)
```

- [ ] **Step 5: Convert assert calls**

Apply global mapping.

- [ ] **Step 6: Remove any final summarize() call**

Delete final `summarize()` or equivalent.

- [ ] **Step 7: Verify count**

```bash
grep -c "^test(" integration/poc-integration.test.ts
```
Expected: **15**

- [ ] **Step 8: Commit**

```bash
git add integration/poc-integration.test.ts
git commit -m "scaffold: place + vitest-migrate integration/poc-integration.test.ts (15 tests)"
```

---

## Task 10: Typecheck gate

**Files:**
- Modify: any source/test file found to have type errors

**Interfaces:**
- Consumes: all placed files
- Produces: clean `pnpm typecheck` (zero errors, zero warnings)

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 2: Triage any errors**

For each error, determine the category:
- **Import path error** (`Cannot find module`): Fix the path — likely a typo, missed kebab-case rename, or leftover `.ts` extension.
- **Type error** (`Property 'X' does not exist`): Do NOT change logic. If it's a missing type annotation introduced by placement (e.g. implicit `any` from a renamed import), add the explicit type annotation. If it looks like a real logic bug, surface it as a finding.
- **`verbatimModuleSyntax` error** (`Import is a type and must use 'import type'`): Change the import to `import type { … }`.
- **`noUncheckedIndexedAccess` error**: Add a `!` non-null assertion or a null check — do not change logic.

- [ ] **Step 3: Verify clean**

```bash
pnpm typecheck 2>&1 | tail -5
```
Expected: `Found 0 errors.`

- [ ] **Step 4: Grep for @neutro/view aliases inside src/ and test/**

```bash
grep -rn "@neutro/view" src/ test/ integration/
```
Expected: **zero matches**. The aliases are only for external consumers.

- [ ] **Step 5: Commit any fixes**

```bash
git add -p   # stage only typecheck fixes, not unrelated changes
git commit -m "fix: typecheck errors from placement (import paths, verbatimModuleSyntax)"
```

---

## Task 11: Test gate + count verification

**Files:**
- Modify: any test file found to fail

**Interfaces:**
- Consumes: all test files
- Produces: all 199 tests passing, counts match expected

- [ ] **Step 1: Run tests**

```bash
pnpm test
```

- [ ] **Step 2: Check test counts per suite**

Read the vitest output. Expected counts:
| Suite | Expected |
|-------|----------|
| `test/core/conformance.test.ts` | 36 |
| `test/compiler/sync-target-classifier.test.ts` | 21 |
| `test/compiler/write-graph-cycle-checker.test.ts` | 20 |
| `test/compiler/equality-policy-inference.test.ts` | 45 |
| `test/compiler/branch-variant-analyzer.test.ts` | 21 |
| `test/compiler/branch-variant-runtime.test.ts` | 7 |
| `test/renderer/interpreter.test.ts` | 34 |
| `integration/poc-integration.test.ts` | 15 |
| **Total** | **199** |

If any count is off:
- **Lower than expected**: a test was dropped during migration. Find it by comparing `grep -c "^test(" PK/<original>` vs the new file. Reinstate the missing test.
- **Higher than expected**: an extra test was added or a helper function was accidentally named `test(`. Inspect and correct.

- [ ] **Step 3: Triage any failures**

For each failing test:
- **Import-related failure** (module not found at runtime): fix the path.
- **Assertion mismatch** (expected X, got Y): check if the `assert.*` → `expect.*` conversion was applied correctly. The *value and order* of arguments to `expect()` vs the matcher matter.
- **Async test timing** (test times out): the conformance test has no async tests. If something times out, it is a vitest configuration issue, not a logic bug.
- **Real logic failure** (test was passing in PK but fails here): this is a finding to surface — do NOT fix the component logic in this pass.

- [ ] **Step 4: Commit any migration fixes**

```bash
git add -p
git commit -m "fix: test migration issues (assertion conversions, import paths)"
```

---

## Task 12: Build + lint + hooks + cross-consistency

**Files:**
- No new files; dist/ is generated

**Interfaces:**
- Produces: `dist/{core,compiler,renderer}/index.{js,d.ts}` matching `package.json` exports map; lefthook wired; lint clean

- [ ] **Step 1: Run build**

```bash
pnpm build
```
Expected: no errors. `dist/` is created.

- [ ] **Step 2: Verify dist structure matches exports map**

```bash
ls dist/core/ dist/compiler/ dist/renderer/
```
Expected in each: `index.js  index.d.ts` (at minimum — there may also be source maps and `.d.ts.map` files).

Check these exact paths from `package.json` exports resolve:
- `dist/core/index.js` ✓
- `dist/core/index.d.ts` ✓
- `dist/compiler/index.js` ✓
- `dist/compiler/index.d.ts` ✓
- `dist/renderer/index.js` ✓
- `dist/renderer/index.d.ts` ✓

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```
Expected: no errors. If biome finds `useImportType` violations, fix those imports with `import type`. If it finds formatting violations, run `pnpm format` to auto-fix, then review the diff.

- [ ] **Step 4: Install lefthook**

```bash
pnpm lefthook install
```
Expected: `Lefthook initialized` or similar. No errors.

- [ ] **Step 5: Confirm both gates in the pre-push hook**

```bash
cat .git/hooks/pre-push
```
Expected: script that calls lefthook, which in turn runs `pnpm typecheck` and `pnpm test`.

- [ ] **Step 6: Final cross-consistency sweep**

```bash
# No @neutro/view aliases inside src/ or test/ (should already be verified)
grep -rn "@neutro/view" src/ test/ integration/

# No .ts extensions in imports inside src/ or test/
grep -rn "from '.*\.ts'" src/ test/ integration/

# __test not re-exported from core barrel
grep "__test" src/core/index.ts

# All dist files present
ls dist/core/index.js dist/compiler/index.js dist/renderer/index.js
```
All four commands should produce zero matches / confirmed file existence.

- [ ] **Step 7: Commit**

```bash
git add dist/    # if dist is tracked; otherwise skip
git commit -m "scaffold: build clean, lint clean, hooks wired — both gates green"
```

---

## Self-Review

**Spec coverage check:**
- ✅ File placement per MIGRATION.md table — covered in Tasks 2–4, 6–9
- ✅ Import rewrites (kebab-case, extensionless, cross-concern relative) — Tasks 3–4 + all test tasks
- ✅ Barrel verification — Tasks 2–4
- ✅ `__test` not in core barrel — Task 2 step 3
- ✅ vitest migration (mandatory, not optional) — Tasks 5–9
- ✅ testHelpers.ts PROJECT_CORE_PATH fix — Task 6
- ✅ pnpm typecheck gate — Task 10
- ✅ pnpm test gate + count verification — Task 11
- ✅ pnpm build gate + dist structure — Task 12
- ✅ pnpm lint gate — Task 12
- ✅ lefthook install — Task 12
- ✅ @neutro/view alias grep — Tasks 3, 4, 10
- ✅ CI scripts exist in package.json (lint, typecheck, test, build) — already present; no task needed
- ✅ `core_ts6_patched.ts` NOT migrated — noted in constraints

**Placeholder scan:** No TBDs, no "implement later", no "similar to task N" references. All import rewrites show before/after. All assert→expect conversions are shown with concrete examples.

**Type consistency:** `PROJECT_CORE_PATH` is used consistently in test-helpers and integration test. `HarnessSignal`/`HarnessDerived` names match their source file. All barrel export names verified against source.

---

**Missing from PK (check before executing):**

The following files are referenced in MIGRATION.md but I could not verify their content. Confirm they exist in PK before Task 3:
- `PK/types.ts` — compiler shared types
- `PK/signalTypeUtils.ts` — signal type utilities
- `PK/equalityPolicyInference.ts` — equality policy inferencer class (export name: `EqualityPolicyInferencer`)
- `PK/branchVariantAnalyzer.ts` — branch variant analyzer class (export name: `BranchVariantAnalyzer`)

Run `ls PK/` to confirm all 24 source files are present before starting.
