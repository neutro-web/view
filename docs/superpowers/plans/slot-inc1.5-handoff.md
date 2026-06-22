# CC Handoff — Increment 1.5: emit-path thunk-assembly collapse (E-2b) + component-in-conditional-branch fix

**Role.** You (CC) execute and commit; GitHub is authoritative. Verify by reading placed
files, never green counts. "Done = committed and on main." BCon.

**Scope.** Parser emit-path only (`nv-parser.ts`) + dead-code deletion (`nv-emitter.ts`).
NO `src/core/`. NO IR shape change. NO contract change. reactive-core v0.4.2 and
Template-IR v0.3.3 both UNCHANGED. This is a build-path correctness fix + structural
collapse; it does NOT touch the interpreter, emitted-mount, ir.ts, or html-tag.ts.

**This is NOT increment 2.** Do not touch `SlotEntry.content` factory, `SlotOutletBinding.props`,
`let={...}`, or D-slot-2. Those are increment 2, gated separately.

---

## 0. Read first (GitHub, not PK)

- `src/renderer/nv-parser.ts` — specifically:
  - `parseNvFileForEmit` — the `bindingThunks` assembly block (the `componentThunks` map over
    `pendingComponents`, the `holeThunks` via `computeThunksForTemplate`, and
    `bindingThunks = [...componentThunks, ...holeThunks]`).
  - `computeThunkSource` — the `conditional` case (recurses via `computeThunksForTemplate`).
  - `computeThunksForTemplate` — hole-only; takes `consumed` set, maps holes via `computeThunkSource`.
  - `processHtmlTemplate` — produces `ProcessResult` (`pendingComponents`, `consumedByComponent`);
    note its binding order: **components first, then holes**.
  - `buildNvHoleBinding` — the conditional case calls `processHtmlTemplate(whenTrue/whenFalse)`
    to build branch IR.
- `src/renderer/nv-emitter.ts` — `emitThunkSource` (the dead `conditional`/`component`/`slot-outlet`
  cases) and `emitBindingLiteral` (the LIVE conditional/component/slot-outlet cases that build
  literals directly via `emitIrLiteral`).
- `test/renderer/nv-emitter.test.ts` + `test/renderer/nv-emitter-exec.test.ts` — the
  behavior-neutrality oracle (EM-*, EX-*, TC-C*, EM-D1c).

---

## 1. The bug (confirmed by spike)

`processHtmlTemplate` (IR path) walks elements via `walkNvNodeList` → detects components →
`pendingComponents`. The top-level thunk assembly in `parseNvFileForEmit` consumes
`pendingComponents` to build `component` ThunkSources, ordered components-first to match
`processHtmlTemplate`'s binding order.

`computeThunkSource`'s conditional case recurses via `computeThunksForTemplate`, which is
**hole-only** — no `pendingComponents`, `consumed = new Set()`. So a component inside a
conditional branch (`${cond ? html\`<Card/>\` : ...}`) yields the card's prop holes as flat
`prop`/`text` thunks, never a wrapped `component` ThunkSource. The branch IR (correct) then
pairs with a `text`/`prop` thunk → `emitModule` throws `ComponentBinding thunk kind mismatch`.

Spike confirmed: IR `consequent.bindings[0].kind = 'component'`; thunk
`consequent[0] = { kind: 'prop' }`; `emitModule` THROWS. Slot-outlet-in-branch works (hole-level
detection); only element-level component detection is missing from the branch path.

**Root cause = emit-side degraded copy:** top-level thunk assembly knows about components; the
branch recursion is a second, hole-only assembly path that does not. This is the emit-side twin
of the GATE-2 walk divergence (B1/B3). Fourth instance of the pattern in this subsystem if patched.

---

## 2. Step A — E-2b collapse (behavior-neutral; land + prove FIRST)

Extract the top-level component-thunk assembly from `parseNvFileForEmit` into a single
**recursive** thunk-builder that produces a positionally-aligned `ThunkSource[]` for ANY
template (top-level, conditional branch, slot content) from that template's IR-walk results.

Sketch (adjust names/signature to fit the real seam — this is the shape, not a mandate):

```
computeBindingThunks(
  procResult: ProcessResult,        // { ir, pendingComponents, consumedByComponent, ... }
  holeExprs, positions,             // the template's holes
  doc, symbols, diagnostics,
  propsParamName?, propsAccessors?
): ThunkSource[]

// 1. componentThunks: map procResult.pendingComponents → { kind:'component', componentSrc,
//    propSrcs, propNames, slots } — slots built recursively per slotHoleGroup.
// 2. holeThunks: non-consumed holes via computeThunkSource (which, for conditional holes,
//    recurses into computeBindingThunks for each branch's ProcessResult).
// 3. return [...componentThunks, ...holeThunks]  // components-first, matches binding order
```

Then:
- `parseNvFileForEmit`'s inline assembly becomes a single call to `computeBindingThunks` with
  `renderResult`'s data.
- `computeThunkSource`'s conditional case calls `computeBindingThunks` with **the branch's**
  `ProcessResult` (see §3 — this is the load-bearing seam).

**Binding-order invariant (must preserve):** `bindingThunks[i]` aligns with `ir.bindings[i]`,
components-first then holes, recursively at every level. This is what `emitIrLiteral` relies on
when it zips `ir.bindings` with `thunks`. If alignment breaks, `emitBindingLiteral` will pair
wrong kinds → mismatch throw. The alignment is the gate.

**Behavior-neutrality gate (mandatory, before the Q1 fix):**
- The ENTIRE existing emit corpus (all EM-*, EX-*, TC-C*, EM-D1c) passes UNCHANGED on the
  collapse alone — zero assertion edits. Report full-suite count delta = 0 for Step A in isolation.
- If any existing emit assertion must change, STOP — the extraction is not behavior-neutral, surface it.

---

## 3. ESCALATION RULE (load-bearing — do not skip)

The conditional recursion needs the **branch's `ProcessResult`** (its `pendingComponents` +
`consumedByComponent`), not just its hole expressions. `buildNvHoleBinding`'s conditional case
already calls `processHtmlTemplate(branch)` to build the branch IR — that call produces a
`ProcessResult` the thunk path needs.

**Thread that existing `ProcessResult` to `computeBindingThunks`.** Do NOT re-walk the branch
solely to get thunk-side component data, and do NOT detect components locally inside
`computeThunkSource`'s conditional case (that is E-2a — a fourth degraded copy).

**If** the branch `ProcessResult` cannot be threaded to the thunk assembly through the existing
`processHtmlTemplate` / `buildNvHoleBinding` seam without (a) re-walking the branch or (b) a
signature change whose cleanliness you're unsure of — **STOP and surface to architect.** Do not
fall back to local component detection in the conditional case. The double-walk-vs-signature
choice is an architecture call, not a CC judgment call. This is the explicit E-2b tripwire.

---

## 4. Step B — the Q1 fix falls out

With the collapse, the conditional recursion runs `computeBindingThunks` on the branch's
`ProcessResult` → branch components produce wrapped `component` ThunkSources → alignment holds →
`emitModule` no longer throws.

**Fail-shows-teeth test (the Q1 source, durable):**

```ts
const Toggle = $component(() => {
  $script(() => { const show = signal(true) })
  $render(() => html`<div>${show ? html`<Card .label="${show}"/>` : html`<p>no</p>`}</div>`)
})
```

- `parseNvFileForEmit` → `bindingThunks[0]` is `conditional`; `consequent[0].kind === 'component'`
  (NOT `'prop'`/`'text'`); `consequent[0].componentSrc === 'Card'`.
- `ir.bindings[0].consequent.bindings[0].kind === 'component'` (already correct pre-fix; assert
  alignment with the thunk).
- `emitModule(results)` does NOT throw; emitted JS contains `kind: 'component'` inside the
  conditional consequent literal.
- **Fail-shows-teeth:** with Step A's collapse reverted (branch path hole-only again), this test
  FAILS with `ComponentBinding thunk kind mismatch`; with collapse in place, PASSES. Report both;
  do not commit the reverted state.

**Also add the component-in-default-slot-in-conditional nesting** if it's cheap on the same seam
(component inside a slot inside a conditional branch) — this is the case that proves the recursion
is genuinely uniform, not just one-level-deep. If it doesn't fall out trivially, note it as a
follow-on; do not force it.

---

## 5. Step C — delete dead emitThunkSource cases (Q3-confirmed dead)

Spike confirmed (3239 green, zero REACHED): `emitThunkSource`'s `conditional`, `component`, and
`slot-outlet` cases are unreachable — `emitBindingLiteral` builds those literals directly via
`emitIrLiteral`, never routing them through `emitThunkSource`.

- **Reachability proof first:** add `throw new Error('REACHED-<case>')` as the first line of each
  of the three cases. Full suite green, zero REACHED thrown (including the new Step B tests).
  Report.
- **Then delete** the three cases. `emitThunkSource` retains only `text`/`attr`/`prop`/`event`.
  Its return type narrows accordingly; update the type/signature so `tsc --strict` proves the
  three kinds can no longer reach it.
- If ANY test throws REACHED (i.e. a case is live after the Step A/B changes), STOP — the
  collapse changed reachability; surface it. (Step A/B should not make them reachable —
  `emitBindingLiteral` is still the only structural emitter — but the probe is the proof.)

---

## 6. Gates (report each)

- `tsc --strict` clean (DOM lib). Full vitest green; report count delta vs 3239.
- `biome` clean; `build` clean.
- **Step A behavior-neutrality** reported separately: existing emit corpus green, zero assertion
  edits, Step-A-isolation count delta = 0.
- **Step B fail-shows-teeth pair** (collapse reverted → mismatch throw; restored → pass) reported.
- **Step C reachability probe** (zero REACHED) reported before deletion; `tsc` proves narrowed
  type after deletion.
- **Anti-vacuous sweep** on new tests: `grep -rPzo "expect\(\s*(true|false)\s*\)\.toBe"` +
  `grep -rPzo "expect\(\s*!"` → zero matches.
- **Scope proof:** `git show --stat` — production changes confined to `src/renderer/nv-parser.ts`
  + `src/renderer/nv-emitter.ts` + tests. NO `src/core/`, NO `ir.ts`, NO `interpreter.ts`, NO
  `emitted-mount.ts`, NO `html-tag.ts`.

---

## 7. On land — docs

LANDED decision-log entry: emit-path thunk-assembly collapsed (E-2b) — single recursive
`computeBindingThunks` retires the top-level/branch divergence (emit-side twin of the GATE-2 walk
collapse); component-in-conditional-branch emit bug fixed (was: branch recursion hole-only →
`component` IR paired with `prop`/`text` thunk → mismatch throw); dead `emitThunkSource`
conditional/component/slot-outlet cases deleted. Cite *Slot increment 1 LANDED [2026-06-22]* and
the GATE-2 collapse as the structural precedent. **No contract/IR version change** — reactive-core
v0.4.2, Template-IR v0.3.3 both unchanged. Update `implementation-state.md`: `nv-parser.ts` emit
path now single recursive thunk-builder; `nv-emitter.ts` `emitThunkSource` leaf-only. Update
Current State: note increment 1.5 landed (emit-path collapse + conditional-branch component fix),
increment 2 (scoped slots + D-slot-2) still queued.

**Out of scope (increment 2):** `SlotEntry.content` factory, `SlotOutletBinding.props`,
`let={...}`, D-slot-2. Do not start these.
