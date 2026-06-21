# nv Emitter Factory-Shape Convergence — Design (A2)

**Stream:** (3) Renderer/templating · (2) compiler seam
**Contract reference:** nv Reactive Core Runtime Contract v0.4.2 · Template IR v0.3
**Status:** APPROVED → LANDED 2026-06-21 — emitter-only; verified against `docs/gates/a2-emitter-factory-shape.md`. See decision-log 2026-06-21.
**Prerequisite (clean baseline):** Composition bugs #2 (shape.html anchor leak) and
#3 (prop-expr not erased) FIXED 2026-06-21. This spec assumes that baseline.
**Changelog:**
- v1.0 (2026-06-21): initial A2 design.
- v1.1 (2026-06-21): §3 rewritten to the S-A2-verified ownership mechanism
  (the "double-root = leak" framing was imprecise; corrected below). Status →
  APPROVED after spike.

---

## 1. Problem

Emitted component factories return the wrong shape for composition. The two
back-ends (`wireComponent`, `emitted-mount` `case 'component'`) enforce the
`ir.ts` contract:

```ts
ComponentRef = (props: PropsObject, slots: SlotFns) => TemplateIR
```

Both call `binding.component(propsObj, slotsObj)` and feed the result to
`mountFragment` / `emitSetup`. But `nv-emitter.ts` emits:

```ts
export function Counter(props, slots) {
  return { mount(parent, doc) { return createRoot(/* $script; __ir; mount */) } }
}
```

A factory returning a self-mounting `{ mount }` object — wrong return type, and it
wraps its own `createRoot`. An emitted component therefore cannot be mounted as a
child of another emitted component (`component: Counter` resolves to this
`{ mount }`-returning function, not a `ComponentRef`). Sole remaining blocker for
cross-file / nested composition.

---

## 2. Decision: A2

The emitter converges **to** the back-end contract (back-ends are ground truth and
do not change). Each component emits two surfaces:

1. **`Counter` — the `ComponentRef`.** `(props, slots) => TemplateIR`. Runs the
   `$script` body, returns the IR literal. **No own `createRoot`, no `mount` call.**
   What the back-ends consume for composition.

2. **`Counter.mount` — the root-bootstrap sugar.** Thin top-level convenience:
   `(parent, doc, props?, slots?) => mount(Counter(props, slots), parent, doc)`.
   Used only at the application root, never in composition.

### Why A2 (rejecting B)

- **Performance.** A `ComponentRef` returns a bare IR; the *caller's* root owns it
  — one root per component subtree, identical to today's interpreter contract.
  Option B (back-ends accept a `{ mount }`-style child) needs the back-end to detect
  and bridge a child that wraps its own root: extra owner-tree node + a bridge
  closure per composed child. On a 1000-row list with a child component per row, that
  is 1000 redundant roots + 1000 bridges. A2 pays nothing beyond the single root the
  subtree already needs.
- **Contract discipline.** B widens the back-end contract from
  `ComponentRef → TemplateIR` to `→ TemplateIR | Mountable`. Coverage-widening of a
  static guarantee is the direction the constitution resists (cf. `sync`/`derived`
  "never widen guarantees"). A2 keeps the contract ironclad; the two back-ends stay
  welded by construction.
- **Authoring is unaffected either way.** Authors write `$component`/`$script`/
  `$render` (or `html\`\``); the factory shape is 100% generated. "Ergonomics" here
  is consumer/integration ergonomics, not authoring. A2's single mount entry point
  (`mount(ir, parent, doc)` for everything, `.mount` sugar at the root) is the *more*
  consistent consumer surface.

---

## 3. Ownership (the load-bearing invariant) — SPIKE-VERIFIED

**Claim: back-ends are unchanged because ownership is identical to today; only the
root's *provider* moves from emitter to caller.** Verified by spike S-A2 against
real `core.ts` + `interpreter.ts` (2026-06-21): 10/10 — single-root ownership, live
parent→child prop edge, child-body effect owned + disposed by parent cascade, no leak
after parent dispose; control 8/8 — sugar path + reproduced leak class.

### How ownership actually works (corrected mechanism)

`createRoot` **auto-attaches to the active owner**:

```ts
export function createRoot(fn) {
  const root = makeNode(KIND_EFFECT)
  root.owner = currentOwner            // attaches to whatever owner is active
  if (currentOwner !== null) addChild(currentOwner, root)
  ...
}
```

Consequence (correction to the v1.0 draft): a nested `createRoot` that runs
**synchronously inside** a parent's owner context *is* owned by the parent and *is*
disposed by the parent cascade — it does **not** leak. The earlier framing ("the
`{ mount }` shape double-roots → leak") was imprecise: synchronous nesting is a
*performance* redundancy at worst, not a correctness fault.

### Why the `{ mount }` shape actually leaks under composition

The real failure mode is narrower, and is what A2 fixes. The old emitter emits
`Counter()` → `{ mount }`, and `.mount(parent, doc)` is invoked by the **consumer**,
*outside* any owner context (`currentOwner === null` at that call site). The child's
internal `createRoot` then attaches to **nothing** — a **freestanding root** outside
the owner tree, reachable only via its own returned disposer. Composed as a child,
the parent's owner cascade **cannot reach it** → leak unless every disposer is
manually threaded back up. S-A2-control reproduces this: the orphaned child effect
keeps running after the parent is gone; only the manual disposer clears it.

### Why A2 is correct by construction

Under A2, `wireComponent` already runs:

```ts
createRoot(dispose => {
  const childIR = binding.component(propsObj, slotsObj)  // [X] $script runs here, INSIDE this root
  mountFragment(childIR, parent, doc, anchorNode)        // [Y] child effects created here, owned by this root
  onCleanup(/* DOM removal */)
  return dispose
})
onCleanup(() => childDisposer())                         // [Z] bridge to parent region
```

The `ComponentRef` body executes at [X] **inside the back-end's root**; the binding
thunks (`() => props.count()`) are wired into effects at [Y], owned by that root.
Parent dispose cascades through [Z] → child root → child effects → severs the
parent-signal edge. One root for the child subtree; disposal by construction. The
root simply moved from emitter-emitted (old, freestanding) to back-end-provided
(A2, owned). This is what makes A2 emitter-only — back-ends unchanged.

### Run-once (§1.3)
The `ComponentRef` body is the run-once region: one call → one execution → effects
owned by the caller's root. Confirmed by S-A2 (child-body effect runs exactly once
at mount, re-runs only on the live prop edge, never after dispose).

### Root sugar ownership
`Counter.mount(parent, doc, props)` = `mount(Counter(props), parent, doc)`. The
renderer's `mount` wraps `createRoot`, so `Counter(props)` runs inside `mount`'s
root — same path as the child case, invoked at the app root only, never nested.
S-A2-control Part 2 verifies single-root + reactive + no-leak.

---

## 4. Emitter changes (`nv-emitter.ts`)

`emitComponentFactory` changes from emitting a `{ mount }` wrapper to emitting a
`ComponentRef` plus a `.mount` sugar.

### 4.1 New emitted shape

```js
export function Counter(props, slots) {
  // $script body, inlined and erased (signals/deriveds created here)
  const count = signal(0)
  // return the IR literal directly — NO createRoot, NO mount
  return {
    id: "nv:b7ff15f2",
    shape: { html: "<span><!--nv-0--></span>", bindingPaths: [[0, 0]] },
    bindings: [
      { kind: 'text', pathIndex: 0, expr: () => (count()) }
    ],
  }
}
Counter.mount = (parent, doc, props = {}, slots = {}) =>
  mount(Counter(props, slots), parent, doc)
```

Differences from current:
- Body is `(props, slots) => TemplateIR`, not `() => ({ mount })`.
- `$script` statements inlined at the top of the function body (unchanged erasure —
  same `emit.scriptBody`).
- IR literal `return`ed directly (was assigned to `__ir` then mounted).
- `createRoot`/`onCleanup` no longer used *inside the factory*.

### 4.2 Import emission
- `mount` (renderer) — still required (for `.mount` sugar).
- `createRoot` / `onCleanup` — drop from the forced list; include only if the
  `$script` body references them (existing `detectUsedPrimitives` path handles this).

### 4.3 Composition: `component:` field
App's IR literal references `component: Counter` — now a `ComponentRef`.
`wireComponent` calls `Counter(propsObj, slotsObj)` → `TemplateIR`. Correct by
construction; no back-end change (S-A2 verified).

### 4.4 Naming / export — RESOLVED
`Counter.mount` as a property on the function (not sibling `mountCounter`). Slots
threaded through the sugar as a 4th arg defaulting `{}`. `.mount`-on-function
accepted despite minor tree-shaking retention (sugar is one `mount` call; runtime
perf untouched). Arch sign-off 2026-06-21, all perf-neutral.

---

## 5. Back-end changes

**None.** `wireComponent` and `emitted-mount` `case 'component'` already implement
`ComponentRef → TemplateIR`. Verify (do not modify): both call
`binding.component(propsObj, slotsObj)`, both `createRoot` → call → mount →
`onCleanup`. Interpreter remains ground truth; `emitted-mount` stays observationally
identical (Invariant BE). S-A2 confirms the interpreter path; TC-C15 differential
parity (below) confirms the compiler path matches.

---

## 6. Migration (call-site churn)

Top-level mount call sites that used `Component().mount(p,d)`:
- `nv-emitter-exec.test.ts` EX-01/02/03 (`mod.Counter().mount(parent, doc)`),
  TC-C14f (`mod.App().mount(parent, doc)`).
- Migration: `mod.Counter().mount(p,d)` → `mod.Counter.mount(p, d)` (sugar). Prefer
  the sugar in tests to keep the `.mount` affordance exercised.
- `new Function()` round-trip tests in `nv-emitter.test.ts` build the IR from
  `emit.bindingThunks` and mount via the renderer `mount` — **unaffected**.

---

## 7. Test additions (differential corpus)

- **TC-C15-exec (headline):** two emitted components; parent instantiates
  `<Counter .count="${n}"/>` as a real child. Bundle → import → mount parent →
  assert child renders prop → `n.set(...)` → flush → assert child DOM updates.
  Must fail before implementation (today the child returns `{ mount }`,
  `mountFragment` receives a non-IR).
- **TC-C15-dispose:** dispose parent → child DOM removed AND child reactive edges
  severed (no-leak). The S-A2 assertion, now through the emitted path.
- **TC-C16 (shape):** emitted `Counter` callable as `(props, slots) => IR`; return
  has `shape`/`bindings`, NOT a `mount` method. Pins the `ComponentRef` shape.
- **TC-C17 (sugar):** `Counter.mount(parent, doc, props)` mounts at root, reactive,
  no-leak on dispose.
- **Differential parity:** the same nested-component IR via interpreter `mount` vs
  `emitted-mount` → structurally identical DOM (Invariant BE), before and after a
  prop-signal write.

---

## 8. Open questions — ALL RESOLVED (arch sign-off 2026-06-21)

1. **`.mount` property vs sibling export** → property. Perf-neutral.
2. **Slots through the root sugar** → yes, 4th arg default `{}`. Allocation only on
   the root call, never per-child.
3. **`.mount` + tree-shaking** → accept. Bundle-size only; runtime perf untouched.

---

## 9. Scope discipline

- **In scope:** emitter factory reshape, import-emission adjustment, `.mount` sugar,
  call-site migration, TC-C15/16/17 + differential parity.
- **Not in scope:** slot *consumption* (factories thread but ignore `slotsObj`
  content — separate gate), `$style` scoping, SyncBinding.
- **Contract:** reactive-core v0.4.2 unchanged; Template IR v0.3 unchanged
  (`ComponentRef` already specifies `(props, slots) => TemplateIR`; this spec makes
  the emitter *conform*). **No contract version bump.**
