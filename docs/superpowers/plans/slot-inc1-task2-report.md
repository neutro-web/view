# Slot Increment 1 — Task 2 Report: Fallback (Step C)

**Status:** DONE
**Base..Head:** `204da1b..e6164de`
**Commits:**
- `30c4488` feat(slot): slot-outlet fallback — additive IR field + both front-ends + back-ends
- `e6164de` test(slot): §8.3 fallback corpus — FE-equivalence + render both back-ends

## What was implemented (Step C only)

- **C.1 — `src/renderer/ir.ts`**: added optional `fallback?: TemplateIR` to `SlotOutletBinding`. Only IR shape change; `SlotEntry` and `SlotOutletBinding.props` untouched.
- **C.2 — `src/renderer/html-tag.ts`**: `SlotSentinel` gains optional `__nvFallback`; `slots(name, opts?: { fallback })` carries it; `buildHtmlHoleBinding` spreads `fallback` onto the produced binding. `isSlotSentinel` unchanged (structural check on `__nvSlotOutlet` still sufficient).
- **C.3 — `src/renderer/nv-parser.ts`**: `buildNvHoleBinding` detects `{slots.name ?? html`...`}` (`BinaryExpression` / `QuestionQuestionToken`, `slots.x` left, `html` TTE right) and sets `fallback` via `processHtmlTemplate(right, doc, signals).ir`. `computeThunkSource` detects the same pattern for the emit path; `slot-outlet` `ThunkSource` gains `fallbackThunks?` computed via `computeThunksForTemplate`.
- **C.4 — `src/renderer/interpreter.ts`**: `wireSlotOutlet` absent-slot path renders `binding.fallback` (when present) at outlet scope under `runWithOwner(capturedParentOwner, ...)` with its own `createRoot` + `onCleanup` DOM teardown — same ownership/mount pattern as the filled case (D-slot-1 retained).
- **C.5 — `src/compiler/emitted-mount.ts`**: `slot-outlet` wire renders the fallback IR via `emitSetup` inside `createRoot` under the captured parent owner when the slot is absent. (Owner falls back to `getOwner()` only if no slot context — keeps the no-context unfilled case safe.)
- **C.6 — `src/renderer/nv-emitter.ts`**: `emitBindingLiteral` slot-outlet case emits `fallback: <nested IR literal>` via `emitIrLiteral(sob.fallback, fallbackThunks, indent)` when present, with a thunk-kind guard.

## Corpus (`test/renderer/slot-consumption.test.ts`, §8.3)

- FE-equivalence: html-tag `slots('x', { fallback })` and nv-parser `slots.x ?? html`` produce structurally-identical outlet IRs with `fallback` set (`irStructurallyEqual`).
- `fallback-renders-when-unfilled` — interpreter + compiler (fallback `<h1>` present, filled `<strong>` absent).
- `fallback-suppressed-when-filled` — interpreter + compiler (filled `<strong>` present, fallback `<h1>` absent).

## Gates

- `tsc --noEmit`: clean.
- `npx vitest run`: **3237 tests pass** (3232 base + 5 new), 133 files.
- `biome check`: clean (also enforced by pre-commit hook).
- **Fail-shows-teeth:** guarding the interpreter fallback render branch with `if (false && ...)` → `fallback-renders-when-unfilled (interpreter)` FAILED (`expected undefined to be 'Untitled'`); restored → PASS. Reverted state not committed.
- **Anti-vacuous sweep:** zero `expect(true/false).toBe` / `expect(!` in new tests.
- **Scope:** `git show --stat` confirms changes confined to the 6 named src files + the test file. No `src/core/`.

## Concerns

None blocking. Note: in the compiler back-end, the fallback owner falls back to `getOwner()` when there is no slot context — this preserves D-slot-1 when a slot context exists and keeps the rare no-context path from throwing; behavior matches the interpreter for the in-scope (component-driven) case.
