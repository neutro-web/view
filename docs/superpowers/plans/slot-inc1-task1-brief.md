# Slot Increment 1 — Task 1 Brief: GATE-2 Collapse + Component-as-Slot-Child

**Working directory:** `/Users/kofi/_/view`  
**Branch:** main (implement directly on main — project convention)  
**BASE commit (record this):** `31acc9a`

---

## Context

This is a renderer refactoring task in the `@neutro/view` project — a fine-grained reactive
UI framework. You are implementing Slot Increment 1, Steps A and B only, from the approved
design at `docs/design/scoped-slots-design.md`.

The project has two template front-ends (`html-tag.ts`, `nv-parser.ts`), two back-ends
(`interpreter.ts`, `emitted-mount.ts`), and a shared IR (`ir.ts`). Both front-ends produce
an identical `TemplateIR`; the back-ends execute it. Tests in `test/renderer/` cover this.

The current suite is **3223 tests, all green**. `tsc --noEmit` is clean. `biome check` is
clean.

---

## What you are doing

### Step A — GATE-2 collapse (behavior-neutral refactor)

Retire `buildSlotSubIR` in `src/renderer/html-tag.ts` and `buildNvSlotSubIR` in
`src/renderer/nv-parser.ts`. Slot content is processed by the **same** walking logic used
for top-level template content — not a separate sub-walk.

**Current state:**
- In `html-tag.ts`: the component-element branch of the main walk detects `<Slot name="x">`
  wrapper elements, collects the slot's child nodes, and calls `buildSlotSubIR(slotNodes,
  exprs, slotId, doc)`. `buildSlotSubIR` does its own flat walk (comment + attr/prop/event
  sentinels only, no component-element detection) and uses `buildHtmlHoleBinding` per hole.
- In `nv-parser.ts`: `processHtmlTemplate` detects `<slot name="x">` elements, collects
  `slotHoleGroups`, and calls `buildNvSlotSubIR(slotNodes, holeExprs, doc, slotId, signals)`.
  `buildNvSlotSubIR` does its own flat walk (comment + attr/prop/event sentinels only, no
  component-element detection) and uses `buildNvHoleBinding` per hole.

**Target state (after collapse):**

Extract the node-walking logic from both top-level walks into a shared inner function that
BOTH the top-level path AND the slot-capture path call. The "slot sub-IR" is produced by
calling this shared walk on the slot's subtree nodes with the slot's hole exprs/positions.

Concretely:

**html-tag.ts** — The main tagged-template function walks a DocumentFragment. Extract an
inner `walkNodeList(nodes, exprs, holeMap, consumedByComponent, doc)` function (or equivalent
name) that processes a list of DOM nodes, returning `{ bindings, bindingPaths, holeIndices }`.
The main walk calls it for the full fragment. The slot-capture site calls it for the slot's
child nodes (with the same `exprs` array — hole indices are global across the whole template).
`buildSlotSubIR` is DELETED — its logic lives in `walkNodeList`.

**nv-parser.ts** — `processHtmlTemplate` walks a parsed DOM. Extract the per-node
classification logic into a shared `walkNodeList(nodes, holeExprs, doc, signals)` function
returning `{ bindings, bindingPaths, holeIndices }`. `processHtmlTemplate` calls it for
the full template root. The slot-capture site calls it for the slot's child nodes.
`buildNvSlotSubIR` is DELETED.

Key implementation notes:
- The `consumedByComponent` set (html-tag) tracks which hole indices are consumed by a
  component element in the slot walk. This must work correctly when the slot walk recurses
  into component elements inside slots.
- `holeCompactIdx` alignment: within a slot's sub-IR, `pathIndex` is 0-based (compact index
  within the slot, not the global hole index). The shared walk must use compact indexing for
  the sub-IR, not global.
- `.nv` emit-side: `slotHoleGroups` in `parseNvFileForEmit` and `computeThunkSource` must
  continue to produce index-aligned thunk sources. Do not break the `.nv` IR-kind == emit-kind
  invariant (B1 fix).
- The warning path "dynamic/nested-component slot content → warning, slots:[]" (if it exists
  in the code) is REMOVED — components in slot content are now fully supported.

**Behavior-neutrality gate (mandatory):**
Run `npx vitest run test/renderer/slot-consumption.test.ts` on the collapse alone, with NO
new tests and NO assertion edits. All 34 tests must pass unchanged. Report the result.
If any assertion needs editing to pass, STOP — the refactor is not behavior-neutral; report
the specific assertion and what changed.

### Step B — component-as-slot-child (falls out of the collapse)

With the shared walk now handling component elements, a `<Card/>` inside slot content will
automatically produce a `ComponentBinding` in the slot sub-IR. Confirm and pin:

1. Verify that `<Card/>` inside a named slot (in both html-tag and nv-parser) produces a
   `ComponentBinding` in the slot's content IR — check by reading the IR directly in a test.
2. Verify FE-equivalence: both front-ends produce identical slot sub-IRs for a component-in-slot.
3. Verify that both back-ends (`wireComponent` via slot content mount; emitted-mount component
   case) correctly mount and dispose the nested component.

No IR shape change for component-in-slot — `SlotEntry.content` is already a full `TemplateIR`;
bindings may include `ComponentBinding` per Template-IR §3.

Add corpus tests (see §4 of the CC handoff — component-as-slot-child tests only):
- `component-as-slot-child` — `<Card/>` in a named slot → `ComponentBinding` in sub-IR; FE-equivalence; both back-ends mount + dispose.
- `component-in-default-slot` — same for the default slot.
- `nested-component-in-slot-disposes` — parent dispose tears down the nested component (no-leak).

---

## Files to read first

Read these BEFORE writing any code:
1. `src/renderer/html-tag.ts` — focus on the main tagged-template function, `buildSlotSubIR`, and `buildHtmlHoleBinding`
2. `src/renderer/nv-parser.ts` — focus on `processHtmlTemplate`, `buildNvSlotSubIR`, `buildNvHoleBinding`, `parseNvFileForEmit` slot branch (`slotHoleGroups`)
3. `src/renderer/interpreter.ts` — `wireSlotOutlet`, `wireComponent`, `mountFragment`
4. `src/renderer/emitted-mount.ts` — slot-outlet + component cases
5. `test/renderer/slot-consumption.test.ts` — the behavior-neutrality oracle; understand what each test asserts

---

## Gates you must pass

- `npx tsc -p tsconfig.json --noEmit` — clean (no errors)
- `npx vitest run` — all 3223 tests pass (delta = +3 from new corpus tests → 3226)
- `npx biome check src/ test/` — clean
- Behavior-neutrality: slot-consumption.test.ts passes with ZERO assertion edits on the collapse alone
- `buildSlotSubIR` and `buildNvSlotSubIR` are DELETED from the codebase (`git show --stat` confirms)
- Anti-vacuous sweep: `grep -rPzo "expect\(\s*(true|false)\s*\)\.toBe"` and `grep -rPzo "expect\(\s*!"` over new tests = 0 matches

---

## Commit discipline

Commit in at least two logical units:
1. The collapse (Step A) alone — with the behavior-neutrality gate result noted
2. Component-in-slot corpus tests (Step B)

Use `git push` after your final commit.

---

## Report contract

Write your full report to: `docs/superpowers/plans/slot-inc1-task1-report.md`

Return only:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commits: `<base7>..<head7>`
- Test count: `<N> tests pass`
- Behavior-neutrality gate: PASSED / FAILED (and what failed if so)
- Any concerns (if DONE_WITH_CONCERNS)
