# Sync Residuals Close-Out: emitMount SyncBinding + Dead Field Deletion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last `.nv`→emit execution gap for SyncBinding (Item 1) and delete the permanently-dead `writeTargetId` field (Item 2).

**Architecture:** Two tasks. Task 1 adds a `case 'sync'` to `emitMount`'s binding dispatch, mirroring the interpreter's `wireSync` with the same four behavioral parts using emitMount's existing setup-closure idioms. Task 2 deletes `writeTargetId` from `ir.ts` and updates the related comments. No classifier, no cycle-checker, no `§8.5.2` path is touched.

**Tech Stack:** TypeScript, vitest, JSDOM. Reference implementation: `src/renderer/interpreter.ts:wireSync` (lines 313–373). Test harness: `test/compiler/emitted-mount.test.ts`.

## Global Constraints

- G0 hard stop: any change to `src/compiler/sync-target-classifier.ts`; any change to `src/compiler/write-graph-cycle-checker.ts`; any change to `src/core/core.ts`; any write-graph edge or `signalSymbolId` involvement for SyncBinding
- `emitMount` is a setup-closure emitter — direct-capture pattern (capture IR fields directly, NOT the binding object), matching the existing `case 'prop'`, `case 'event'` idiom
- Behavioral parity with interpreter `wireSync` is the correctness specification — any divergence from interpreter observable behavior is a defect
- `pnpm typecheck` and `pnpm test` green, run separately
- The existing GATE 5 test (`SyncBinding (still deferred) throws at emit time`) must be replaced — it asserts a throw that the new implementation eliminates

---

## Files

- Modify: `src/compiler/emitted-mount.ts`
- Modify: `src/renderer/ir.ts`
- Modify: `src/renderer/nv-emitter.ts` (comment only)
- Modify: `test/compiler/emitted-mount.test.ts`
- Modify: `test/renderer/nv-emitter.test.ts` (comment only)

---

### Task 1: emitMount SyncBinding case

**Goal:** Implement `case 'sync'` in the `emitMount` binding dispatch, with six gate tests replacing the old "still deferred" test.

**Files:**
- Modify: `src/compiler/emitted-mount.ts` (imports + `defaultExtractorForProp` + case)
- Modify: `test/compiler/emitted-mount.test.ts` (G1–G6 tests)

**Existing imports confirmed (do not re-add):**

`test/compiler/emitted-mount.test.ts` already imports:
- `mount` from `../../src/renderer/interpreter.js` (line 35) — returns `() => void` directly (the disposer), NOT `{ dispose }`
- `flushSync`, `signal` from `../../src/core/core.js` (line 32)
- `emitMount` from `../../src/compiler/emitted-mount.js` (line 25)

**Interfaces consumed:**

```typescript
// ir.ts — SyncBinding (unchanged in Task 1; writeTargetId still present, ignore it)
export type SyncBinding = BaseBinding & {
  kind: 'sync'
  propName: string
  readExpr: ReactiveExpr<unknown>
  eventName: string
  writeTarget: WritableSignal<unknown> | (() => WritableSignal<unknown>)
  writeTargetId?: string   // dead — deleted in Task 2; ignore here
  transform?: (eventValue: unknown, current: unknown) => unknown
}

// defaultExtractorForProp — private in interpreter.ts (NOT exported); copy verbatim
function defaultExtractorForProp(prop: string): (ev: unknown) => unknown {
  if (prop === 'checked') {
    return (ev: unknown) => (ev as { target?: { checked?: unknown } } | null)?.target?.checked
  }
  return (ev: unknown) => (ev as { target?: { value?: unknown } } | null)?.target?.value
}
```

- [ ] **Step 1: Extend imports in `src/compiler/emitted-mount.ts`**

**Core import** (line 35) — add `pubsub` and `sync`:
```typescript
import { createRoot, effect, getOwner, onCleanup, pubsub, runWithOwner, signal, sync } from '../core/core.js'
```

**IR type import** (lines 36–47) — add `SyncBinding` and `WritableSignal`:
```typescript
import type {
  Binding,
  ClassListBinding,
  ClassListEntry,
  ComponentBinding,
  NodePath,
  ReactiveExpr,
  SlotContent,
  SlotOutletBinding,
  StyleVarBinding,
  SyncBinding,
  TemplateIR,
  WritableSignal,
} from '../renderer/ir.js'
```

- [ ] **Step 2: Add `defaultExtractorForProp` to `src/compiler/emitted-mount.ts`**

`defaultExtractorForProp` is NOT exported from `interpreter.ts` — copy it verbatim as a module-level function after the last import, before `emitSetup`:

```typescript
// Per-prop default DOM value extractor. Mirrors interpreter.ts:defaultExtractorForProp.
function defaultExtractorForProp(prop: string): (ev: unknown) => unknown {
  if (prop === 'checked') {
    return (ev: unknown) => (ev as { target?: { checked?: unknown } } | null)?.target?.checked
  }
  return (ev: unknown) => (ev as { target?: { value?: unknown } } | null)?.target?.value
}
```

- [ ] **Step 3: Add missing imports to `test/compiler/emitted-mount.test.ts`**

Three separate import edits — do not paste a new block; surgically add to the existing lines.

**vitest import** (line 24) — add `vi`:
```typescript
import { expect, test, vi } from 'vitest'
```

**core import** (line 32) — add `derived`:
```typescript
import { __test, derived, flushSync, signal, sync } from '../../src/core/core.js'
```

**ir.js type import** (lines 36–44) — add exactly `ReactiveExpr`, `SyncBinding`, `WritableSignal` to the existing list (`ChildBinding, ComponentBinding, ConditionalBinding, EventBinding, PropBinding, TemplateIR, TextBinding`). Do not add `Binding`, `ClassListBinding`, `SlotContent`, `SlotOutletBinding` — they are not currently imported and are not needed by these tests.

- [ ] **Step 4: Write failing tests (RED) in `test/compiler/emitted-mount.test.ts`**

**Remove** the existing GATE 5 test in its entirety (lines 388–404 — `'GATE 5: SyncBinding (still deferred) throws at emit time'`). Replace it with the following helper + six tests.

**Event dispatch pattern (JSDOM):** JSDOM does not allow `Object.defineProperty` spoofing of `ev.target` — the dispatcher overwrites it. The correct pattern is `input.value = '...'` then `input.dispatchEvent(new Event('input'))`. `defaultExtractorForProp('value')` reads `ev.target.value`, and with JSDOM `ev.target` is the dispatching element, so setting `input.value` before dispatch is the correct way to provide the value.

**`makeSyncIR` helper** (add before the G1 test):

```typescript
// ── SyncBinding gate tests (G1–G6) ───────────────────────────────────────────

function makeSyncIR(overrides: {
  propName?: string
  eventName?: string
  writeTarget?: WritableSignal<unknown> | (() => WritableSignal<unknown>)
  readExpr?: ReactiveExpr<unknown>
  transform?: (eventValue: unknown, current: unknown) => unknown
}): TemplateIR {
  const baseBinding: SyncBinding = {
    kind: 'sync',
    pathIndex: 0,
    propName: overrides.propName ?? 'value',
    readExpr: overrides.readExpr ?? (() => ''),
    eventName: overrides.eventName ?? 'input',
    writeTarget: overrides.writeTarget ?? (signal('') as WritableSignal<unknown>),
    ...(overrides.transform !== undefined ? { transform: overrides.transform } : {}),
  }
  return {
    id: 'test:sync',
    shape: { html: '<input />', bindingPaths: [[0]] },
    bindings: [baseBinding],
  }
}
```

**G1 — parity with interpreter (shared-oracle):**

```typescript
test('G1 — SyncBinding: emit path observable parity with interpreter path', () => {
  // The same three assertions run against BOTH paths with fresh signals each iteration.
  // Any divergence between paths = test failure.
  const { document } = makeDom()

  for (const path of ['interpreter', 'emit'] as const) {
    const val = signal('initial')
    const ir = makeSyncIR({
      writeTarget: val as WritableSignal<unknown>,
      readExpr: val,
    })
    const parent = document.createElement('div')

    // mount returns the disposer directly (not { dispose })
    const dispose: () => void =
      path === 'interpreter'
        ? mount(ir, parent, document)
        : emitMount(ir).mountFn(parent, document)

    const input = parent.querySelector('input') as HTMLInputElement

    // (a) Initial DOM prop reflects the signal
    expect(input.value, `[${path}] initial DOM value`).toBe('initial')

    // (b) Signal change re-fires the signal→DOM effect
    val.set('updated')
    flushSync()
    expect(input.value, `[${path}] signal→DOM after set`).toBe('updated')

    // (c) Input event writes the signal (JSDOM pattern: set input.value, dispatch event)
    input.value = 'from-dom'
    input.dispatchEvent(new Event('input'))
    flushSync()
    expect(val(), `[${path}] DOM→signal after event`).toBe('from-dom')

    dispose()
  }
})
```

**G2 — transform map (arity-1):**

```typescript
test('G2 — SyncBinding: map transform (arity-1) applied on emit path', () => {
  const { document } = makeDom()
  const val = signal(0) as unknown as WritableSignal<unknown>
  const ir = makeSyncIR({
    writeTarget: val,
    readExpr: () => String((val as unknown as WritableSignal<number>)()),
    transform: (ev: unknown) => Number(ev),  // arity-1 = map; TS allows fewer params
  })
  const parent = document.createElement('div')
  const dispose = emitMount(ir).mountFn(parent, document)
  const input = parent.querySelector('input') as HTMLInputElement

  input.value = '42'
  input.dispatchEvent(new Event('input'))
  flushSync()

  expect((val as unknown as WritableSignal<number>)()).toBe(42)
  dispose()
})
```

**G3 — transform reduce (arity-2):**

```typescript
test('G3 — SyncBinding: reduce transform (arity-2) applied on emit path', () => {
  const { document } = makeDom()
  const val = signal(10) as unknown as WritableSignal<unknown>
  const ir = makeSyncIR({
    writeTarget: val,
    readExpr: () => String((val as unknown as WritableSignal<number>)()),
    transform: (ev: unknown, cur: unknown) => (cur as number) + Number(ev),  // arity-2 = reduce
  })
  const parent = document.createElement('div')
  const dispose = emitMount(ir).mountFn(parent, document)
  const input = parent.querySelector('input') as HTMLInputElement

  input.value = '5'
  input.dispatchEvent(new Event('input'))
  flushSync()

  expect((val as unknown as WritableSignal<number>)()).toBe(15)  // 10 + 5
  dispose()
})
```

**G4 — derived-target guard fires `console.error`:**

`derived` and `vi` are added in Step 3. Use them directly — no dynamic import.

```typescript
test('G4 — SyncBinding: console.error fired when writeTarget is derived (non-writable)', () => {
  const { document } = makeDom()
  const base = signal(0)
  // derived() has no .set — triggers the guard in the case 'sync' wire closure
  const readOnly = derived(() => base() * 2)

  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const ir = makeSyncIR({ writeTarget: readOnly as unknown as WritableSignal<unknown> })
    const parent = document.createElement('div')
    const dispose = emitMount(ir).mountFn(parent, document)
    // Guard fires synchronously inside wire() at mount time — spy must be set before mountFn
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('not a writable signal'),
    )
    dispose()
  } finally {
    errSpy.mockRestore()
  }
})

**G5 — cleanup: event listener removed on dispose:**

```typescript
test('G5 — SyncBinding: event listener removed on dispose (no leak)', () => {
  const { document } = makeDom()
  const val = signal('before')
  const ir = makeSyncIR({
    writeTarget: val as WritableSignal<unknown>,
    readExpr: val,
  })
  const parent = document.createElement('div')
  const dispose = emitMount(ir).mountFn(parent, document)
  const input = parent.querySelector('input') as HTMLInputElement

  dispose()

  // After disposal: input event must NOT update the signal (listener removed)
  input.value = 'after-dispose'
  input.dispatchEvent(new Event('input'))
  flushSync()

  expect(val()).toBe('before')
})
```

**G6 — element guard fires on non-element node:**

```typescript
test('G6 — SyncBinding: throws [nv/emit] when target is not an Element', () => {
  // shape: 'text only' → fragment's childNodes[0] is a Text node (nodeType 3)
  // pathIndex [0] resolves to that Text node via the accessor
  const { document } = makeDom()
  const ir: TemplateIR = {
    id: 'test:sync-guard',
    shape: { html: 'text only', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'sync',
        pathIndex: 0,
        propName: 'value',
        readExpr: () => '',
        eventName: 'input',
        writeTarget: signal('') as WritableSignal<unknown>,
      } as SyncBinding,
    ],
  }
  const parent = document.createElement('div')
  expect(() => emitMount(ir).mountFn(parent, document)).toThrow('[nv/emit]')
})
```

- [ ] **Step 5: Run tests — confirm G1–G6 RED**

```bash
cd /Users/kofi/_/view && pnpm test test/compiler/emitted-mount.test.ts
```

Expected: G1–G6 fail (no `case 'sync'` exists yet). G6 may partially pass (throws from the `default` case — but the message contains `[nv/emit]` so `.toThrow('[nv/emit]')` is satisfied; that is acceptable RED-that-passes-for-wrong-reason since G6's final state is identical either way).

- [ ] **Step 6: Implement `case 'sync'` in `src/compiler/emitted-mount.ts`**

Add the case immediately before the `default` case (before line ~642). Direct-capture: extract fields from the binding at emit time, capture the values in the wire closure — NOT the binding object itself:

```typescript
case 'sync': {
  const propName = (binding as SyncBinding).propName
  const eventName = (binding as SyncBinding).eventName
  const writeTarget = (binding as SyncBinding).writeTarget
  const readExpr = (binding as SyncBinding).readExpr
  const transform = (binding as SyncBinding).transform

  wireSpecs.push({
    accessor,
    wire(targetNode) {
      // Part 1: element guard
      if (targetNode.nodeType !== 1 /* ELEMENT_NODE */) {
        throw new Error(
          `[nv/emit] SyncBinding expects an Element node; got nodeType ${targetNode.nodeType}`,
        )
      }
      const element = targetNode as Element

      // Part 2: signal→DOM (read direction)
      effect(() => {
        ;(element as unknown as Record<string, unknown>)[propName] = readExpr()
      })

      // Part 3: DOM→signal (write-back) — external-source sync via pubsub
      const ps = pubsub()
      const listener = (e: Event): void => ps.publish(e)
      element.addEventListener(eventName, listener)
      onCleanup(() => element.removeEventListener(eventName, listener))

      // Part 4: external-source sync with transform arity dispatch
      const extractor = defaultExtractorForProp(propName)
      let compute: ((ev: unknown) => unknown) | ((ev: unknown, cur: unknown) => unknown)
      if (transform) {
        if (transform.length >= 2) {
          // reduce: transform(extractedValue, currentSignalValue)
          compute = (ev: unknown, cur: unknown) => transform(extractor(ev), cur)
        } else {
          // map: transform(extractedValue)
          compute = (ev: unknown) => (transform as (v: unknown) => unknown)(extractor(ev))
        }
      } else {
        compute = extractor
      }

      // Derived-target guard: warn if writeTarget resolves to a non-writable signal
      const wt = writeTarget
      const resolvedForGuard =
        typeof wt === 'function' && typeof (wt as unknown as { set?: unknown }).set !== 'function'
          ? (wt as () => WritableSignal<unknown>)()
          : (wt as WritableSignal<unknown>)
      if (typeof resolvedForGuard?.set !== 'function') {
        console.error(
          '[nv] sync: write target is not a writable signal. Use signal(), not derived(), as a :PROP sync target.',
        )
      }

      sync(
        ps,
        writeTarget as WritableSignal<unknown> | (() => WritableSignal<unknown>),
        compute as (incoming: unknown) => unknown,
      )
      // sync's disposer intentionally discarded — sync owns its node via
      // currentOwner and disposes with the enclosing createRoot.
    },
  })
  break
}
```

Also update the `default` case message to remove the stale `SyncBinding is deferred` note:
```typescript
default: {
  const kind = (binding as Binding).kind
  throw new Error(`[nv/emit] Binding kind '${kind}' is not implemented.`)
}
```

- [ ] **Step 7: Run all tests — G1–G6 GREEN; full suite passes**

```bash
cd /Users/kofi/_/view && pnpm test
```

Expected: all tests pass.

- [ ] **Step 8: Typecheck**

```bash
cd /Users/kofi/_/view && pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 9: G0 verification**

```bash
cd /Users/kofi/_/view && git diff HEAD -- \
  src/compiler/sync-target-classifier.ts \
  src/compiler/write-graph-cycle-checker.ts \
  src/core/core.ts
```

Expected: empty.

- [ ] **Step 10: Commit**

```bash
git add src/compiler/emitted-mount.ts test/compiler/emitted-mount.test.ts
git commit -m "feat(emit): SyncBinding case in emitMount — parity with interpreter wireSync (G1–G6 green)"
```

---

### Task 2: Delete dead `writeTargetId` field + update comments

**Goal:** Remove `writeTargetId` permanently from `ir.ts` and update the associated two-line comment in `nv-emitter.ts` and the comment in `nv-emitter.test.ts`.

**Files:**
- Modify: `src/renderer/ir.ts`
- Modify: `src/renderer/nv-emitter.ts`
- Modify: `test/renderer/nv-emitter.test.ts`

- [ ] **Step 1: Delete `writeTargetId` and rewrite the doc comment in `ir.ts`**

Current block (lines 186–202):
```typescript
/**
 * DESIGNED, NOT IN PoC SCOPE.
 *
 * writeTargetId: agreed deferred field (compiler path only).
 * Must use same signalSymbolId derivation as compiler steps 1–2/4 so the
 * §8.5.2 write-graph cycle check can connect the renderer's write-back edge.
 */
export type SyncBinding = BaseBinding & {
  kind: 'sync'
  propName: string
  readExpr: ReactiveExpr<unknown>
  eventName: string
  writeTarget: WritableSignal<unknown> | (() => WritableSignal<unknown>)
  writeTargetId?: string
  transform?: (eventValue: unknown, current: unknown) => unknown
}
```

Replace with:
```typescript
// SyncBinding is an external-source sync (§8.5); contributes no §8.5.2 write-graph edge.
export type SyncBinding = BaseBinding & {
  kind: 'sync'
  propName: string
  readExpr: ReactiveExpr<unknown>
  eventName: string
  writeTarget: WritableSignal<unknown> | (() => WritableSignal<unknown>)
  transform?: (eventValue: unknown, current: unknown) => unknown
}
```

- [ ] **Step 2: Delete both comment lines in `src/renderer/nv-emitter.ts`**

The comment is two lines (lines 223–224):
```typescript
        // writeTargetId intentionally NOT emitted — cross-boundary symbol space problem;
        // see decision-log 2026-06-24 retraction entry. Field stays in ir.ts as placeholder.
```

Delete both lines entirely. The surrounding code (`writeTarget: ...` line above, `]` closing array below) must remain intact.

- [ ] **Step 3: Update the test comment in `test/renderer/nv-emitter.test.ts` line 978**

Current:
```typescript
    // writeTargetId must NOT be emitted (cross-boundary symbol space problem)
    expect(emitted).not.toContain('writeTargetId')
```

Replace the comment:
```typescript
    // writeTargetId field removed (A2 reversed 2026-06-24); external-source sync needs no write-graph ID
    expect(emitted).not.toContain('writeTargetId')
```

The assertion stays — it guards against accidental future emission.

- [ ] **Step 4: Run typecheck + tests**

```bash
cd /Users/kofi/_/view && pnpm typecheck
```
```bash
cd /Users/kofi/_/view && pnpm test
```

Expected: 0 typecheck errors (proves nothing reads the deleted field), all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ir.ts src/renderer/nv-emitter.ts test/renderer/nv-emitter.test.ts
git commit -m "cleanup(ir): delete dead writeTargetId field + update comments (A2 reversed 2026-06-24)"
```

---

## Self-Review

**Spec coverage:**
- G0: classifier/checker/core untouched ✓
- G1: shared-oracle parity — both interpreter and emit paths exercised with identical assertions; `mount` return value used as direct disposer (not `.dispose`) ✓
- G2: map transform (arity-1) via JSDOM `input.value` pattern ✓
- G3: reduce transform (arity-2) via JSDOM `input.value` pattern ✓
- G4: derived-target guard — `console.error` spy asserts the guard fires on `derived()` target; spy set before `mountFn` (guard fires synchronously at wire time) ✓
- G5: cleanup — listener removed on dispose; post-dispose event does not update signal ✓
- G6: element guard — throws `[nv/emit]` on Text node target ✓
- JSDOM event pattern: `input.value = '...'` + `new Event('input')` throughout (no `Object.defineProperty` target spoofing) ✓
- `WritableSignal` added to both `emitted-mount.ts` and test file imports ✓
- `SyncBinding`, `ReactiveExpr` added to test file imports ✓
- `derived` added to core import (line 32); `vi` added to vitest import (line 24) — both top-level, no dynamic import ✓
- `signal()` returns `SignalAccessor<T>` (core.ts), structurally compatible with ir.ts `WritableSignal<T>` via method bivariance on `.set`; single cast `as WritableSignal<unknown>` is valid ✓
- `defaultExtractorForProp` copied verbatim (not exported from interpreter) ✓
- Old "SyncBinding still deferred" GATE 5 removed ✓
- `default` case message updated (stale SyncBinding reference removed) ✓
- Both comment lines 223–224 deleted from `nv-emitter.ts` ✓
- `writeTargetId` deleted; typecheck proves no reader; not-emitted assertion stays ✓
- Direct-capture idiom (fields captured, not binding object) ✓
- `sync`'s disposer discarded (matches interpreter comment) ✓
