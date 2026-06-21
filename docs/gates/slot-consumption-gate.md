# Acceptance Gate — Slot Consumption

**Feature:** Slot consumption (named + reactive), both front-ends + emit + both back-ends.
**Design:** `docs/design/slot-consumption.md` (APPROVED).
**Contract impact:** Template-IR **v0.3 → v0.3.1** (new `SlotOutletBinding`). Reactive-core **v0.4.2 unchanged**.
**Filled by:** architect, before CC starts. **Read back by:** architect, against placed files on main's HEAD.
**CC does NOT self-assess pass/fail.** CC produces the evidence bundle (raw output); the architect reads it back.

---

## G0 — Disqualifiers (any one fails the gate outright)

| # | Condition that FAILS | Evidence command |
|---|---|---|
| G0.1 | Changes are not committed+pushed to **main** (worktree-only = silent no-op). | `git log --oneline -5 origin/main` shows the feature commit(s); `git show --stat <sha>` lists the touched files. |
| G0.2 | `pnpm typecheck` not clean (tsc --strict, DOM lib in scope). | `pnpm typecheck` exits 0, zero errors. Raw output in bundle. |
| G0.3 | `pnpm test` not green. | `pnpm test` exits 0; report total count (expect strictly **> 3189**, the A2 baseline). |
| G0.4 | `pnpm lint` not clean. | `pnpm lint` exits 0. |
| G0.5 | `pnpm build` does not emit `dist/`. | `pnpm build` exits 0; `dist/` present. |

If any G0 row fails, stop — do not read further items.

## G1 — Contract / ordering invariants (the load-bearing correctness conditions)

| # | Invariant | FAILS if | Evidence |
|---|---|---|---|
| G1.1 | **Reactive-core untouched.** Slot consumption consumes §6.1 `runWithOwner`/`getOwner` as-is; adds nothing to core. | `git diff <baseline>..HEAD -- src/**/core.ts` is non-empty, OR contract version moved off v0.4.2. | `git diff --stat <baseline>..HEAD -- 'src/**/core.ts'` empty; `reactive-core-contract.md` header still v0.4.2. |
| G1.2 | **Template-IR bump recorded.** New `SlotOutletBinding` kind present; doc bumped. | `ir.ts` lacks `SlotOutletBinding` in the `Binding` union, OR `template-ir.md` header still v0.3. | `grep "SlotOutletBinding" src/renderer/ir.ts` in the union; `template-ir.md` header reads v0.3.1 with changelog line. |
| G1.3 | **Parent-lexical ownership.** Slot content is rendered under the owner captured at the parent's call site, NOT inside the child's `createRoot`. | The owner handle is captured *inside* the child root (or `getOwner()` is read after entering the child root). | Read-back: in both back-ends, `getOwner()` for slots is taken before the child-factory `createRoot`; the slot render is wrapped in `runWithOwner(capturedParentOwner, …)`. (Proven behaviorally by G4.5/G4.6.) |
| G1.4 | **Slot outlet observes nothing reactively.** `SlotOutletBinding` carries a `name`, no `expr`; it is not an effect over a signal. | `SlotOutletBinding` carries a `ReactiveExpr`/`expr` field, or its back-end case creates a tracking effect over slot content selection. | Type: `grep -A3 "SlotOutletBinding" ir.ts` shows `{ kind:'slot-outlet'; name; pathIndex }`, no `expr`. |
| G1.5 | **Both front-ends agree on slot-hole consumption.** Holes inside captured slot content are bindings of the *slot* sub-IR and are marked consumed in the parent; neither front-end emits them as parent bindings. | Either front-end leaves a slot-internal hole unconsumed in the parent (falls through to a parent binding), OR the two disagree. | G3.1 (FE-equivalence) covers it; plus read-back that both `html-tag.ts` and `nv-parser.ts` add slot-internal hole indices to `consumedByComponent`. |

## G2 — Artifacts (each names the file + the failable condition)

| # | Artifact | Done when | FAILS if |
|---|---|---|---|
| G2.1 | `SlotOutletBinding` in `ir.ts` + `Binding` union. | Type present, exported, in union. | Missing from union (back-ends can't switch on it exhaustively). |
| G2.2 | `<slot name="…">` capture in `html-tag.ts`. | Named-slot wrapper → `SlotEntry{name}`; reactive holes → slot sub-IR bindings; consumed. | Reactive slot content still `warn`+`slots:[]`, or default-only. |
| G2.3 | `<slot name="…">` capture in `nv-parser.ts`. | Same as G2.2 for `.nv`. | Same failure as G2.2. |
| G2.4 | `{slots.<name>}` insertion recognized → `SlotOutletBinding` in both front-ends. | Hole reading `slots.<name>` emits `SlotOutletBinding{name}` (default spelling pinned: `{slots.default}`). | Slot insertion classified as a plain text binding. |
| G2.5 | `interpreter.ts` `case 'slot-outlet'`. | Resolves `slotsObj[name]`, renders under `runWithOwner(capturedParentOwner,…)` at anchor. | No case (throws/ignores), or renders under child owner. |
| G2.6 | `emitted-mount.ts` `case 'slot-outlet'`. | Same behavior as G2.5, compiled path. | Same failure as G2.5. |
| G2.7 | `nv-emitter.ts` reactive-slot erasure. | Slot holes erased under the **parent's** `symbols`/`propsAccessors`; `slots:[]` hardcode replaced. | `slots: []` still hardcoded, or slot holes erased under the wrong scope (a slot reading a parent prop does NOT become `props.x()`). |

## G3 — Front-end equivalence (FE-equivalence §6.1)

| # | Property (all paths to one oracle) | FAILS if |
|---|---|---|
| G3.1 | For each corpus template, `html-tag` and `nv-parser` produce **structurally identical** slot sub-IRs: `shape.html`, `bindingPaths`, binding kinds, slot names. Oracle = structural comparator (§8.3), NOT outerHTML. | Any structural divergence between the two front-ends on any corpus entry. |

## G4 — Differential conformance (interpreter vs compiler, one shared oracle)

Each row: run the template through **both** back-ends, assert the **property** (structural equality to one oracle), not a mechanism. Compiled path includes the emit (`nv-emitter`) output, not only hand-authored IR — G2.7 must be exercised here.

| # | Scenario | Property | FAILS if |
|---|---|---|---|
| G4.1 | Named slot renders at its outlet. | Both back-ends place slot content at the `{slots.header}` anchor; structurally equal. | Divergence, or content at wrong position. |
| G4.2 | Default + named coexist. | `{slots.default}` and `{slots.header}` both filled, both correct, both back-ends equal. | Either misplaced or divergent. |
| G4.3 | Reactive hole inside a slot updates. | Write the parent signal a slot hole reads → both back-ends update the slotted DOM identically. | No update (stale), or back-ends diverge. |
| G4.4 | Unfilled named slot renders nothing (v1; fallback deferred). | Outlet with no matching `slotsObj` entry → empty, both back-ends equal. | Throws, or renders stale/garbage, or diverges. |
| G4.5 | **Parent-dispose teardown.** Dispose the parent → slot effects + slot DOM gone; no reactive-edge leak (§12.6). | Both back-ends. | Any leaked edge or retained DOM, either back-end. |
| G4.6 | **Child-dispose, parent survives (the parent-lexical proof).** Dispose only the child → slot DOM gone, but the parent signal a slot hole read is **still live and writable**, and writing it after child disposal causes **no** DOM mutation / no recompute for the disposed region. | Both back-ends. | Parent signal dead/erroring after child dispose (= ownership was child-rooted, the D-slot-1 hazard), OR dead region still mutates, OR back-ends diverge. |

## G5 — Tests assert the right things (anti-vacuous sweep)

| # | Check | FAILS if |
|---|---|---|
| G5.1 | No vacuous assertions in the new tests. | `grep -Pzo "expect\(\s*true\s*\)\.toBe\(\s*true\s*\)"` (and newline-tolerant variants) matches any new test. |
| G5.2 | G4.6 asserts a *positive* live-write on the surviving parent AND a *negative* no-mutation on the disposed region — not just "no throw." | The child-dispose test only asserts absence of error. |
| G5.3 | G4.3 asserts the **post-write** DOM value, against the shared oracle, on **both** back-ends — not just that an effect ran. | Update test asserts only effect invocation / a recompute counter, not the DOM result. |
| G5.4 | Differential rows compare to a **single** oracle (hardcoded expected for scalar/positional cases; structural cross-call only where output is rich — reorder/multi-root). | A row uses `structurallyEqual(domI, domC)` where a hardcoded expected value would be the stricter oracle. |

## G6 — Close-out (architect stages after read-back passes)

- [x] Read-back table filled (every G-item: PASS + evidence pointer). *(2026-06-21)*
- [x] `docs/design/slot-consumption.md` → status LANDED. *(d09674c)*
- [x] `docs/implementation-state.md` updated. *(d09674c)*
- [x] `template-ir.md` → **v0.3.1** (SlotOutletBinding + named/reactive slot capture; changelog line). *(06f16f3)*
- [x] Decision-log entry (event record) + Current State header line. *(d09674c)*
- [x] Forward-queue items confirmed still deferred (slot fallback, scoped slots, component-as-slot-child, `$style`×slots). *(decision-log 2026-06-21)*
- [x] G3.1 tightened post-landing: structural-comparator oracle (`ir-equivalence.ts`) replaces name/length/kind check. *(e605e19)*

## Pass condition

All G0 rows pass AND every G1 invariant holds AND every G2 artifact present AND G3.1 holds AND every G4 row passes on **both** back-ends (compiled path via emit, not only hand-authored IR) AND the G5 sweep is clean. Read back against placed files on main's HEAD — not CC summaries, not green counts.

---

### Evidence bundle (CC produces; raw, not summarized)

1. `git log --oneline -5 origin/main` + `git show --stat <sha>` for each feature commit.
2. Raw `pnpm typecheck`, `pnpm test` (with total count), `pnpm lint`, `pnpm build` output.
3. `git diff --stat <baseline>..HEAD -- 'src/**/core.ts'` (expect empty).
4. The new/changed test file paths + the specific G4.5/G4.6 test bodies (for the anti-vacuous read-back).
5. `grep "SlotOutletBinding" src/renderer/ir.ts` and the type definition.
6. The G5.1 grep output (expect no matches).
