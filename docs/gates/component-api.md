# Component API — Verification Gate (acceptance checklist)

> **Gate instantiation** of `docs/gates/README.md` (the template). First worked
> example; the rich GATE 2–6 fill below is the reference for how concretely to
> populate the per-feature artifact slots. **Status: PASSED 2026-06-21** (read back
> against main's HEAD; bugs #2/#3 found post-gate during emitter seam review — see
> the A2 gate for those). Standing test-sweeps (liveness / no-leak / differential /
> diagnostics / vacuous / deferred-not-half-built / red-before-green) live in the
> template's tests gate and apply here.

**Purpose.** Defines what "done" means for the Component API implementation — *up front*, so completion is evidenced, not litigated. Hand this to the CC session as the acceptance criteria; it is also the architect's read-back checklist.

**Governing principle (AGENTS).** Verify by reading placed files on main's HEAD — never by trusting summaries or green test counts. **Tests green ≠ typechecks ≠ passed gate.** Negative/structural results are valid findings; vacuous assertions are rejected.

**How to use.** Every item below requires *evidence pasted back*, not a "yes." Where it says "show," paste the command output or the file region. The architect verifies against this list before the gate is called passed.

---

## GATE 0 — Disqualifiers (check first; if either fails, STOP — not done)

- [ ] **On main's HEAD, not a worktree.** Show `git status` (working tree clean) + `git log --oneline -20` (phase commits on main). A worktree with uncommitted files is a silent no-op. *"Done means committed and on main."*
- [ ] **Full gate green on HEAD, all four.** Show the actual output of `pnpm typecheck && pnpm test && pnpm lint && pnpm build`. Green tests with a typecheck/lint/build failure is **not** done. Paste the run, not a paraphrase.

---

## GATE 1 — Contract & ordering invariants (the things that cost correctness)

- [ ] **No `core.ts` change.** Show `git diff <pre-A>..main -- src/core/` is **empty**. Any core edit is an unescalated §1/§6 contract touch — surface it regardless of correctness (standing escalation rule).
- [ ] **reactive-core still v0.4.2.** No version bump, no new primitive in the core contract.
- [ ] **A-0 ordering honored.** `template-ir.md` revised to **v0.3 and committed BEFORE the `ir.ts` field edit.** Show commit timestamps/order from `git log` proving the doc revision precedes the type edit. (The `ir.ts` header rule forbids fields ahead of the design doc; this is the prerequisite gate most likely skipped under momentum.)
- [ ] **No hot-struct disturbance.** If `ReactiveNode` or any hot struct was touched, flag it — components don't need it. Expected: untouched.

---

## GATE 2 — IR shape (`ir.ts`, placed & read)

- [ ] `ComponentBinding` present with: `kind: 'component'`, `component: ComponentRef`, `props: readonly PropEntry[]`, `propNames: readonly string[]`, `slots: readonly SlotEntry[]`.
- [ ] `ComponentRef` is the **factory shape** `(props: PropsObject, slots: SlotFns) => TemplateIR` — modeled on `ListBinding.itemTemplate`, NOT a bare IR or a different shape.
- [ ] `PropsObject` / `SlotFns` are **local structural types** in `ir.ts` — **no import from core or DOM** (per the `WritableSignal` precedent). Show the type defs.
- [ ] `ComponentBinding` added to the `Binding` union (after `SyncBinding`; `kind` discriminant unique).
- [ ] `template-ir.md` v0.3 documents the binding + the slot mechanism + the target-node table row (Comment anchor).

---

## GATE 3 — Shared destructuring analyzer + D3 (the closes-two-things claim)

- [ ] **Shared analyzer exists and is used by all three call sites** — `$script` erasure (`eraseScriptBlock`), handler erasure (`eraseHandlerExpr`), props erasure. Not three separate partial implementations. Show the shared function and its three callers.
- [ ] **Alias extraction** reads `BindingElement.propertyName` — `{ count: l }` maps `l → props.count()` (verified Form A). Show the alias path.
- [ ] **Rest branch** handles `BindingElement.dotDotDotToken` over the enumerable `propNames` set-difference (verified Form B). `rest.foo` → `props.foo()` (member-access, no allocation); whole-`rest` → generated accessor literal.
- [ ] **D3 gap actually closed.** The old `eraseHandlerExpr` "Known gap: destructuring assignment targets… not detected" comment is **gone**, and a destructuring-write to a signal in a handler is now correctly handled (or correctly diagnosed) via the shared analyzer. Show the removed gap + a TC covering it.
- [ ] **Shadowing composes** — a destructured prop name shadowed in a nested scope stops the rewrite inside the shadow, continues outside (verified Form C). Reuses `gatherFunctionShadows`/`gatherBlockShadows`.

---

## GATE 4 — Front-ends, lockstep (the doubled-effort area; most likely half-done)

- [ ] **`html-tag.ts` parity buildout real, not stubbed.** It now handles prop/event/child holes it lacked (Phase B-0). Show the new handling — not a throw, not a TODO.
- [ ] **Component-element detection in BOTH walks** — capitalized tag → `ComponentBinding`, in `nv-parser.ts` AND `html-tag.ts`. Show both.
- [ ] **Whole-element-anchor sentinel logic** — the component element is replaced by an `<!--nv-N-->` anchor in `shape.html`; its static HTML does NOT leak into the parent shape. Both front-ends. Show the sentinel-builder change.
- [ ] **Prop capture → `propNames`** populated from the parent's listed attributes, both front-ends.
- [ ] **Default-slot capture** — inter-tag content becomes the `default` slot IR, both front-ends.
- [ ] **No `.skip` / `.todo`** hiding a front-end that wasn't actually brought to parity. Grep the test files.

---

## GATE 5 — Back-end mount, both (welded to the same owner-tree)

- [ ] **`wireComponent` in `interpreter.ts`** — mounts the child in its own `createRoot`, bridges teardown via `onCleanup`. Show it.
- [ ] **Static-owner decision recorded.** §5.1 was "resolve in implementation." Show *which* choice was made (no `runWithOwner` for the static case vs. otherwise) and the reasoning, verified against `wireList`/`wireConditional` — not asserted.
- [ ] **`emitSetup` component case in `emitted-mount.ts`** — recursively emits slot IRs with **`emptyVerdicts`** (the documented foot-gun; slot pathIndices are independent). Confirm `emptyVerdicts` is passed. Direct-capture (never the binding object).
- [ ] **Owner-tree shape matches** between interpreter and compiler back-end — enforced by the no-leak differential (TC-C10), not by inspection alone.

---

## GATE 6 — Emitter + cross-file (the least-precedented, highest-risk pieces)

- [ ] **`Name(props, slots)` uniform signature** in `nv-emitter.ts` — emitted factories take both params; slotless gets empty slots. Show an emitted factory.
- [ ] **Cross-factory call emission** — a parent with a `ComponentBinding` emits a real call into the child factory threading prop accessor thunks (`() => (expr)` style). Show emitted output for a parent+child case.
- [ ] **`ThunkSource` component variant** + `emitBindingLiteral` / `emitThunkSource` component cases present.
- [ ] **Cross-file `.nv`→`.js` specifier rewrite in `nv-esbuild-plugin.ts`** (§6.4) — the net-new concern. Confirm it's **real**, not faked: an `import { Counter } from './counter.nv'` in a parent survives to a working `.js` import through the plugin. Show the rewrite logic. *(Highest risk of being stubbed.)*

---

## GATE 7 — Tests assert the RIGHT things (count is the weakest signal)

For each, confirm the assertion is substantive — not existence-only, not vacuous:

- [ ] **Liveness (TC-C04/05/06):** writes a signal → `flushSync()` → asserts the **child DOM changed to the new value**. A test that asserts only "binding exists" or omits `flushSync` proves nothing (the `mkSig` near-miss lesson). Show the assertion bodies.
- [ ] **No-leak (TC-C10/C12):** toggles/churns 1000× → asserts `observerCount`→0 and/or `childElementCount`→0 **after dispose**. Mount-only is not a leak test.
- [ ] **Differential (every TC-C0x):** runs **both front-ends × both back-ends** through `structurallyEqual`. No path skipped. Show the harness wires all four.
- [ ] **Cross-file (TC-C14):** bundles **two separate `.nv` files** through the real plugin, mounts, updates. Not a faked import.
- [ ] **Diagnostics (TC-C07 prop-write, TC-C11 nested):** assert the **specific** error message fires, identically in both front-ends — not just "threw."
- [ ] **Vacuous-assertion sweep:** grep the new TC files for `expect(true)`, `toBe(true)`, empty test bodies, and liveness tests missing `flushSync`. Expected: none. Show the grep result.
- [ ] **Deferred-not-half-built:** named slots, Tier-3 rest, nested destructure emit **diagnostics** and are NOT partially implemented. A partial named-slot impl is worse than none. Confirm diagnostics fire; confirm no half-built path.

---

## GATE 8 — Docs & log hygiene (the close-out)

- [ ] `template-ir.md` → v0.3, cross-references/version consistent (consistency pass after the structural change).
- [ ] `implementation-state.md` updated — ComponentBinding inventoried (real, not stub); placeholder factory retired; handler-write gap marked closed.
- [ ] Decision-log entry for the implementation landing (append-only; cites the approval entry).
- [ ] The disposable factory placeholder (the no-param `export function Name() {…}`) is **gone** — no dead placeholder left behind.

---

## Evidence bundle to request (most efficient single ask)

Rather than item-by-item back-and-forth, request these three and most gates verify from them:

1. `git log --oneline <pre-A>..main` + `git status` + the full `pnpm typecheck && test && lint && build` output. → Gates 0, 1 (ordering), 8 (commits).
2. `git diff <pre-A>..main -- src/ docs/template-ir.md` (the whole feature diff). → Gates 1 (no-core-change), 2, 3, 4, 5, 6.
3. The TC corpus file(s) in full. → Gate 7.

**Priority if pulling the full diff is heavy** (catches ~90% of where "done" goes wrong here): (a) gate output + git log/status, (b) the TC corpus file, (c) `ir.ts` + `template-ir.md`, (d) `nv-esbuild-plugin.ts` + `nv-emitter.ts`.

---

## Pass condition

The gate is **passed** only when: Gate 0 + 1 clean, every Gate 2–8 item evidenced (not asserted), and no vacuous/skipped/half-built finding outstanding. Any unescalated `core.ts` touch, any skipped front-end/back-end path, any faked cross-file import, or any liveness test without flush-and-observe → **not passed**, regardless of the green count.
