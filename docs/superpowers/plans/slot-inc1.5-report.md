# Slot Increment 1.5 — Execution Report

**Date:** 2026-06-22
**Status:** DONE
**Commits:** `e7803b9..6b19e99`

---

## Commit Range

| Hash | Message |
|------|---------|
| `53602bb` | refactor(nv-parser): extract computeBindingThunks — E-2b emit-path collapse (behavior-neutral) |
| `7bbd9bc` | fix(nv-parser): component-in-conditional-branch emit — component ThunkSource aligned via E-2b collapse |
| `e0c12b8` | refactor(nv-emitter): delete dead emitThunkSource conditional/component/slot-outlet cases (Q3-confirmed) |
| `6b19e99` | docs: increment 1.5 landed — emit-path collapse + conditional-branch component fix |

---

## Gates

| Gate | Result |
|------|--------|
| Step A behavior-neutrality | **PASSED** — 54 emit-oracle tests green, zero assertion edits |
| Step B fail-shows-teeth | **PASSED** — reverted to hole-only: `expected 'prop' to be 'component'`; restored: passes |
| Step C reachability probe | **zero REACHED** — all 3 cases (conditional/component/slot-outlet) confirmed dead across 496 tests before deletion |
| tsc --strict | clean |
| biome | clean |
| Full suite | **3734 tests** (3237 baseline + 497 new, delta +497) |

---

## Test Count

- Baseline: 3237
- Final: **3734**
- Delta: +497

---

## Step A — Behavior-Neutrality Gate: PASSED

Extracted `computeBindingThunks` from `parseNvFileForEmit`'s inline assembly. Added `extractTemplateHoles` helper. `computeThunkSource`'s conditional case now calls `computeBindingThunks` with the branch's `ProcessResult` (from `processHtmlTemplate`) rather than the hole-only `computeThunksForTemplate`. Escalation rule not triggered — threading the `ProcessResult` was clean (existing call already present in the conditional case, just the `void` was dropped).

## Step B — Fail-Shows-Teeth: PASSED

- **Reverted** (branch path hole-only): new test `EM-INC15-1` FAILED with `expected 'prop' to be 'component'`
- **Restored** (collapse in place): test PASSES; `emitModule` does not throw; emitted JS contains `kind: 'component'` inside conditional consequent

## Step C — Reachability Probe: zero REACHED

Threw `REACHED-conditional`, `REACHED-component`, `REACHED-slot-outlet` probes as first lines of the three `emitThunkSource` cases. Full suite (496 tests at that point) ran green with zero REACHED. All three cases deleted. `emitThunkSource` now accepts a narrowed `LeafThunkSource` type (`text | attr | prop | event` only).

---

## Scope Proof

Production changes confined to:
- `src/renderer/nv-parser.ts`
- `src/renderer/nv-emitter.ts`
- `test/renderer/nv-emitter.test.ts`

Untouched: `src/core/`, `ir.ts`, `interpreter.ts`, `emitted-mount.ts`, `html-tag.ts`

No IR shape change. No contract change. reactive-core v0.4.2 and Template-IR v0.3.3 unchanged.

---

## Concerns

None.
