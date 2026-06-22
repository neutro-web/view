# Slot Increment 1 — Task 1 Report: GATE-2 Collapse + Component-as-Slot-Child

**Status:** DONE
**Base:** `31acc9a`
**Commits:** `47ab250` (Step A — collapse), `9203ad3` (Step B — corpus)
**Range:** `31acc9a..9203ad3`

---

## Step A — GATE-2 collapse (behavior-neutral)

Retired `buildSlotSubIR` (html-tag.ts) and `buildNvSlotSubIR` (nv-parser.ts). Slot
content is now processed by the SAME node-walk as top-level template content.

**html-tag.ts**
- New `walkNodeList(nodes, exprs, root, doc)` — the single DFS walk. Detects text
  holes, attr/prop/event sentinels, and `data-nv-component` elements (capturing
  their props + slot content recursively). Returns compact, encounter-order
  `{ holeInfos, holePaths, components, consumed }`.
- New `buildSlotContentIR(...)` wraps slot nodes, calls `walkNodeList`, builds a
  COMPACT sub-IR (hole bindings in encounter order at pathIndex 0,1,2…, component
  bindings appended). Returns the GLOBAL hole indices consumed.
- The top-level `html()` factory now calls `walkNodeList` once on the fragment and
  maps the compact hole infos back to GLOBAL hole indices (its existing convention:
  non-component holes keep `pathIndex == i`, component anchors appended).
- `makeUnresolvedComponentBinding` shared between both call sites (identical
  throw-on-invoke factory as before).

**nv-parser.ts**
- New `walkNvNodeList(...)` and `buildNvSlotContentIR(...)` — symmetric to the
  html-tag pair, carrying the nv-specific `reactiveHoles` / `slotHoleGroups` and
  the stubExpr/stubHandler bindings, and reusing `buildNvHoleBinding` (so
  slot-outlet / conditional detection inside slot content still works).
- `processHtmlTemplate` now calls `walkNvNodeList` once, then keeps its existing
  compaction (`holeCompactIdx`) and component-binding-prepend logic unchanged.
- `slotHoleGroups` are still produced per slot (index-aligned), so the emit-side
  (`parseNvFileForEmit` / `computeThunkSource`) thunk alignment is preserved — the
  `.nv` IR-kind == emit-kind invariant (B1 fix) is intact.

No warning path for "dynamic/nested-component slot content → slots:[]" existed in
the code, so none was removed; component-in-slot is now fully supported by virtue
of the shared walk.

### Behavior-neutrality gate: PASSED

`npx vitest run test/renderer/slot-consumption.test.ts` → **34/34 pass on the
collapse alone, ZERO assertion edits.** Full suite 3223/3223 green after Step A.

---

## Step B — component-as-slot-child corpus

Added three corpus areas (9 `it` cases) to `test/renderer/slot-consumption.test.ts`:

1. **component-as-slot-child** — `<Card .label=…>` inside a named slot →
   `ComponentBinding` in the slot sub-IR (html-tag + nv-parser), FE-equivalence
   via `irStructurallyEqual`, and both back-ends (interpreter `wireComponent` via
   slot content mount; emitted-mount component case) mount + dispose the nested
   component.
2. **component-in-default-slot** — same for the default slot (FE, FE, FE-equiv).
3. **nested-component-in-slot-disposes** — parent dispose removes the nested DOM
   and runs the nested component's `onCleanup` exactly once (no-leak), both
   back-ends.

Note: nv `<Card>` component detection requires at least one `${…}` hole in the
template (a pre-existing `processHtmlTemplate` early-return for
`NoSubstitutionTemplateLiteral` — out of scope here), so the nv/html sources carry
a trivial `.label` prop hole. This is unrelated to the collapse.

---

## Gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| `biome check src/ test/` | clean |
| Behavior-neutrality (slot-consumption alone) | **PASSED, 34/34, 0 edits** |
| Full suite `vitest run` | **3232 pass** (3223 + 9 new) |
| `buildSlotSubIR` / `buildNvSlotSubIR` deleted | confirmed (grep: 0 defs) |
| Anti-vacuous sweep (new tests) | 0 matches |

## Out of scope (NOT implemented, per brief)

`SlotOutletBinding.fallback`, `SlotEntry.content` factory, `SlotOutletBinding.props`,
`let={...}`, D-slot-2 ownership — all increment 2 / Step C.

## Concerns

None.
