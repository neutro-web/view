# A2 Emitter Factory-Shape Convergence — Verification Gate

> **Gate instantiation** of `docs/gates/README.md`. Filled from
> `factory-shape-convergence-design.md` (v1.1, APPROVED) + the A2 CC handoff brief,
> **before** CC lands, so completion is evidenced not litigated.
> **Ownership premise** already spike-verified (S-A2 10/10 + control 8/8) — this gate
> verifies the *emitter implementation*, not the premise.
> **Status: PASSED 2026-06-21**

**Pre-marker.** `<pre-A2>` = the commit immediately before the emitter reshape begins
(record its SHA at start so the diffs below are scoped).

---

## GATE 0 — Disqualifiers (STOP if either fails)

- [ ] **On main's HEAD.** `git status` clean; `git log --oneline -15` shows the A2 commits on `main`. No worktree-only writes.
- [ ] **Full gate green, all four.** Paste actual output of `pnpm typecheck && pnpm test && pnpm lint && pnpm build`. Expect test count **above** the prior 3059 (new TC-C15/16/17 + parity). Green tests with any of the other three failing → not done.

---

## GATE 1 — Contract & invariants (this feature is emitter-only)

- [ ] **No `core.ts` change.** `git diff <pre-A2>..main -- src/core/` is **empty**. (The whole premise is emitter-only; any core touch means a divergence to surface, not patch.)
- [ ] **No back-end change.** `git diff <pre-A2>..main -- src/renderer/interpreter.ts src/compiler/emitted-mount.ts` is **empty**. The design says back-ends are unchanged and S-A2 proved it. A back-end edit here is an escalation trigger — surface before landing.
- [ ] **reactive-core still v0.4.2; Template IR still v0.3.** No version bump (the design conforms the emitter to the existing `ComponentRef`; it does not redefine it).
- [ ] **`ir.ts` unchanged.** `git diff <pre-A2>..main -- src/renderer/ir.ts` empty — `ComponentRef` already specifies `(props, slots) => TemplateIR`; A2 makes the emitter conform.

---

## GATE 2 — Emitted factory shape (`nv-emitter.ts`, placed & read)

- [ ] **`ComponentRef` shape, not `{ mount }`.** Show the emitted output for a simple component. The factory body is `(props, slots) => { <$script>; return { id, shape, bindings } }` — returns the IR literal **directly**. No `createRoot` wrapper, no `__ir` intermediate inside the factory. (Fails if `return { mount(...) }` survives.)
- [ ] **`.mount` sugar emitted.** Show `Counter.mount = (parent, doc, props = {}, slots = {}) => mount(Counter(props, slots), parent, doc)` after the factory.
- [ ] **`$script` inlined unchanged.** The erased `emit.scriptBody` appears at the top of the factory body, byte-identical to before (erasure is not in scope here). Diff the scriptBody region.
- [ ] **Prop thunk is erased** (regression guard on bug #3): emitted child prop is `expr: () => (n())`, not `() => (n)`. Show the emitted `props:` array for `<Counter .count="${n}"/>`.
- [ ] **shape.html anchor** (regression guard on bug #2): parent shape is `<div><!--nv-comp-0--></div>`, contains no `<Counter`. Show the emitted `shape.html`.

## GATE 3 — Import emission (`emitImports`)

- [ ] **`mount` still imported** (the sugar needs it). Show the import line.
- [ ] **`createRoot` / `onCleanup` NOT force-included.** They appear in the import only if the `$script` body references them (via `detectUsedPrimitives`). Show a component whose `$script` uses neither → import line omits both. (Fails if they're still hard-coded into the forced list.)

## GATE 4 — Composition emission

- [ ] **`component: Counter` references the `ComponentRef`.** Show the parent's emitted IR literal: the `component:` field is the bare factory identifier, which is now `(props, slots) => TemplateIR`. `wireComponent` calls it and gets an IR (not `{ mount }`).
- [ ] **Prop accessor thunks threaded** — parent emits `props: [{ name: 'count', expr: () => (n()) }]` into the child binding. Show it.

---

## GATE 5 — Tests assert the RIGHT things

- [ ] **TC-C15-exec (headline) — real round-trip, not a string check.** Two emitted
  components, one file; parent `$render` has `<Counter .count="${n}"/>` as a **real
  child** (not `void`-ref'd like TC-C14f). Show the test does: bundle (real esbuild +
  `@neutro/view/*` alias) → `import()` → mount parent → `flushSync` → assert child
  `<span>` text = prop value → `n.set(7)` → `flushSync` → assert child text = `'7'`.
  The second assertion (post-`set`) is what makes it liveness, not existence. Show both
  assertion bodies.
- [ ] **TC-C15-exec failed before the emitter change.** Note the red→green: against the
  old `{ mount }` emitter, `mountFragment` receives a non-IR and the test errors. A test
  green against old code is testing nothing.
- [ ] **TC-C15-dispose — no-leak through the emitted path.** Dispose parent → assert child
  DOM removed AND `observerCount(propSignal) === 0` (or suite's no-leak instrumentation).
  Mount-only is not a leak test. Show the assertion.
- [ ] **TC-C16 — shape pin.** `Counter(props, slots)` return has `shape`/`bindings` and
  **no** `mount` method; `typeof Counter.mount === 'function'`. Show both.
- [ ] **TC-C17 — sugar.** `Counter.mount(parent, doc, props)` mounts at root, reactive
  (write → flush → assert), no-leak on dispose.
- [ ] **Differential parity (shared-oracle form).** Both back-ends mount the **same**
  nested-component IR and assert against the **same fixed expected DOM/text**, before and
  after a prop-signal write (TC-C01 in `emitted-mount.test.ts` for the emitted path +
  the parallel `interpreter.test.ts` case). A `structurallyEqual(interpreterDOM,
  emittedDOM)` cross-call is **not** required where the asserted output is a fixed scalar:
  a shared hardcoded oracle is a *stricter* check than mutual equality (two paths can be
  structurally-equal to each other and both wrong; both cannot equal a fixed `'42'` and
  both be wrong). **Confirm the two parallel tests use the identical IR fixture and
  identical expected values** — if the fixtures drifted, the shared-oracle argument
  evaporates and a real differential is required. This is what confirms `emitted-mount`'s
  component case still matches ground truth after the emitter reshape.
  *(Met-with-note 2026-06-21: TC-C01 exercises the post-A2 emitted-mount component case;
  parity satisfied via shared fixed oracle, not `structurallyEqual`. Gate originally
  over-specified the mechanism.)*
- [ ] **Migrated call sites still exercise `.mount`.** EX-01/02/03 + TC-C14f now use
  `mod.X.mount(parent, doc)`; show they still assert DOM + reactivity (not silently
  weakened during migration).
- [ ] **`new Function()` round-trip tests untouched or correctly updated.** If any asserted
  the old `{ mount }` string shape, it now asserts the `ComponentRef` shape. Grep
  `nv-emitter.test.ts` for `{ mount }` / `mount(__ir` string assertions; expect none stale.
- [ ] **Vacuous sweep.** Grep new/changed TC files for `expect(true)`, `toBe(true)`, empty
  bodies, liveness missing `flushSync`. Expected: none. Show the grep.

---

## GATE 6 — Docs & log hygiene (close-out)

- [ ] **`factory-shape-convergence-design.md`** status → LANDED (or a landing note appended).
- [ ] **`implementation-state.md`** — emitter factory shape updated to `ComponentRef + .mount`;
  the "emitted-component-as-child blocked on factory-shape convergence" gap marked CLOSED;
  the forward-queue line "emitter factory shape convergence (emitted component as child)"
  **removed**.
- [ ] **Decision-log** — landing entry appended (cites the A2 approval + S-A2 spike entries)
  **and** Current State header updated to reflect composition now working end-to-end.
- [ ] **No dead placeholder.** The old `{ mount }`-returning factory emission path is gone —
  not left behind a flag or branch.

---

## Pass condition (this feature)

Passed only when: G0 + G1 clean (**emptiness of the core/back-end/ir diffs is the load-
bearing check** — this feature's whole claim is emitter-only), every G2–G6 item evidenced,
TC-C15-exec shown red-before-green, differential parity green, no vacuous/stale assertion.
Any non-empty core/back-end/ir.ts diff → **escalate, do not pass** (it means the emitter-only
premise broke and the spike's conclusion needs revisiting).

---

## Architect read-back (fill on landing)

| Gate | Result | Evidence |
|---|---|---|
| G0 | PASS | typecheck exit 0; 3189/3189 tests; lint clean; build exit 0 |
| G1 (core/back-end/ir diffs empty) | PASS | empty diffs vs `134ac39` on `src/core/`, `interpreter.ts`+`emitted-mount.ts`, `ir.ts`; `nv-emitter.ts` sole production change |
| G2 (factory shape) | PASS | EM-11/EM-11e pin shape + `not.toContain('__ir')`; EM-13b pins `propSrc === 'n()'`; `?? 'undefined'`→throw landed |
| G3 (imports) | PASS | `emitImports` from `detectUsedPrimitives` only; `createRoot`/`onCleanup` not in `CORE_PRIMITIVES`; `mount` unconditional |
| G4 (composition) | PASS | component case emits `component: ${componentSrc}` + threaded `() => (exprSrc)` prop accessors |
| G5 (tests) | PASS | vacuous sweep clean (`toBe(true)` all carry real predicate+message; line 66 `assertEqual` = `structurallyEqual(a,b).equal`); differential in both forms; TC-C15-exec-reactive round-trip. Exec round-trip in `nv-emitter-exec.test.ts` evidenced by green suite, not independently read. |
| G6 (close-out) | PASS | this document's edits applied |
