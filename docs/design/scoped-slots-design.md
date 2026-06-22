# nv — Scoped Slots + Fallback + Component-as-Slot-Child (unified design)

**Stream:** (3) Renderer/templating
**Status:** APPROVED (2026-06-22). All four gates ruled (see Open gates → Resolved). Shape
locked; phasing = Path B (small wins first). Contract-adjacent (§6 ownership + Template-IR
IR shape). Increment-1 CC handoff: `cc-handoff-slot-collapse-fallback.md`.
**Author:** architect. **Reviewer/owner:** Kofi.
**Reads (seams):** `ir.ts`, `interpreter.ts` (`wireSlotOutlet`/`wireComponent`/`mountFragment`),
`nv-parser.ts` (`buildNvSlotSubIR`/`processHtmlTemplate`/`parseNvFileForEmit` slot branch),
`html-tag.ts` (`buildSlotSubIR`/main walk), `nv-emitter.ts` (slot literal emission),
Template-IR §3/§6.1/§7, contract §6/§6.1/§11/§12.24.

---

## 0. Thesis

The three remaining slot features are **one mechanism, not three**. Today
`SlotEntry.content` is a static `TemplateIR`; the outlet renders it as-is. All three
features are the same evolution: *the child invokes the slot content as a richer thing.*

- **Scoped slots** — child invokes the content **with exposed values** (props-in-reverse).
- **Fallback** — child renders an authored default **when the content is absent**.
- **Component-as-slot-child** — the content's binding set **may include `ComponentBinding`**.

Designing the invocation shape once means fallback and component-in-slot ride it. Building
them separately is three passes over `SlotEntry`, both back-ends, the emitter, and the
corpus. This doc fixes the shape; the gates at the end are the calls only the owner makes.

---

## 1. What exists now (seam facts)

- `SlotEntry = { name: string; content: TemplateIR }` — static IR, no parameters.
- `SlotOutletBinding = { kind:'slot-outlet'; pathIndex; name }` — no expr, no props.
- `wireSlotOutlet(binding, anchor, doc, slotsObj, capturedParentOwner)`: looks up
  `slotsObj[name]`; absent → render nothing; present → `runWithOwner(capturedParentOwner,
  () => createRoot(() => mountFragment(slotIR, …)))`. **D-slot-1: parent-lexical ownership.**
- `wireComponent` builds `slotsObj` (name → `TemplateIR`), captures parent owner, calls the
  factory, mounts.
- Slot content is built by **separate** sub-walks (`buildSlotSubIR` / `buildNvSlotSubIR`),
  distinct from the top-level `processHtmlTemplate` walk. The B1/B3 fix unified the per-hole
  *constructor* across the two walks but **not the walks themselves** — the sub-walks still
  only detect comment + attr/prop/event sentinels, not component elements. This is the
  degraded-copy remnant.

---

## 2. The unified IR shape

### 2.1 `SlotEntry.content` becomes a factory

```ts
type SlotProps = PropsObject            // { readonly [name: string]: ReactiveExpr } — reuse
type SlotContent = (props: SlotProps) => TemplateIR

type SlotEntry = { name: string; content: SlotContent }
```

Unscoped slots ignore the argument (`(_props) => ir`). This mirrors the existing factory
precedent already in the codebase — `ComponentRef = (props, slots) => TemplateIR` and
`ListBinding.itemTemplate = (valueSig, indexSig) => TemplateIR`. One shape, uniform; the
"static slot" is just a factory that closes over nothing exposed.

### 2.2 `SlotOutletBinding` gains the exposed-values channel + fallback

```ts
type SlotOutletBinding = BaseBinding & {
  kind: 'slot-outlet'
  name: string
  props?: readonly PropEntry[]   // child-EXPOSED values at this outlet (accessor thunks)
  fallback?: TemplateIR          // child-authored default when the slot is unfilled
}
```

- `props` are accessor thunks the **child** exposes (e.g. `item`, `index`). They are read
  by the **parent-authored** slot content. **One-directional** — props-in-reverse, the same
  transparent-thunk mechanism verified in spike S-A2. No write-back, no `sync`, no cycle.
- `fallback` is child-authored, so it is owned and rendered at the **outlet** scope.

### 2.3 Outlet wiring (interpreter sketch)

```
const content = slotsObj[binding.name]            // SlotContent | undefined
if (content === undefined) {
  if (binding.fallback) mount fallback at outlet scope
  return
}
const slotProps = buildPropsObject(binding.props)  // name → accessor thunk
const ir = content(slotProps)
mount ir  // ownership per GATE-1
```

Component (emit) path: `content` is emitted as a factory function taking `slotProps`; the
slot's reactive holes erase `slotProps.item()` etc. Symmetric with how component props
already erase to `props.x()`.

---

## 3. The three features on this shape

| Feature | What it needs | IR delta |
|---|---|---|
| **Scoped slots** | child exposes values at the outlet; parent content reads them | `SlotOutletBinding.props`; `content` is a factory |
| **Fallback** | child default when unfilled | `SlotOutletBinding.fallback` |
| **Component-as-slot-child** | slot content may contain `<Card/>` | **no IR change** — `SlotEntry.content` is already a full `TemplateIR` whose bindings may be any kind (§3). Needs the slot **walk** to detect component elements. |

Fallback is "invoke path, content absent → render `fallback`." Component-in-slot is "the
sub-IR's binding set is allowed to include `ComponentBinding`." Both are riders on the
scoped-slot invocation shape, not separate machinery.

---

## 4. GATE-1 (the crux) — ownership of invoked slot content (§6, D-slot-2)

**✅ RULED (2026-06-22): D-slot-2 — invocation-scoped ownership for all slot content,
retiring D-slot-1.** Applies when scoped slots land (increment 2); increment 1 (unscoped
content only) retains D-slot-1 because it has no dependency on child-internal/per-invocation
lifetime, so the switch is deferred to where it is load-bearing. The retirement of D-slot-1
is a logged §6 decision; reactive-core stays v0.4.2 if implemented via existing
`getOwner`/`runWithOwner`/`createRoot` (verify against `wireList` before landing increment 2).

D-slot-1 made slot content **parent-lexical**: owned by the parent scope, so child-internal
churn doesn't tear down parent-authored content (G4.5/G4.6). That was correct when slot
content read **only parent signals**.

Scoped slot content reads **child-exposed values** (e.g. a list row reads the child's
per-item signal). Those values live as long as the **invocation** (the list row), not the
top parent. Under strict parent-lexical ownership, when the child disposes a row, the
row's item signal is disposed but the parent-owned slot-content effect still observes it →
**dangling observer edge (leak) + stale read.** Parent-lexical is wrong for the scoped case.

**Recommended resolution — D-slot-2: invocation-scoped ownership for slot content.**
The content factory's result is owned by a `createRoot` at the **outlet/invocation site**
(child-side, per invocation), disposed when that invocation ends.
- **Soundness for parent-signal reads:** cross-scope reads are already proven sound —
  observation ≠ ownership (§6; contract §12.24b: a tracked read inside `runWithOwner`
  still binds to the observer, and disposing the owner leaves the edge correct). So
  parent-authored content owned at the outlet still reads parent signals correctly, and a
  parent write still updates it while live.
- **Does this break G4.6?** No. G4.6 asserts: after child-only dispose, the **parent
  signal stays writable** and the **disposed region does not mutate**. Under
  invocation-scoped ownership the parent signal is owned by the parent root (untouched);
  only the slot content's *effect* (observer) is disposed with the child — which is exactly
  what "disposed region does not mutate" wants. The guarantee holds; the *owner of the
  effect* moves from parent to outlet.
- **Mechanism:** no new primitive. `getOwner` at `wireComponent`/outlet time +
  `runWithOwner` + per-invocation `createRoot`, the same pattern ListBinding's `wireList`
  uses for per-item roots (contract v0.4.2, §6.1). Confirm against `wireList`.

**Question for you:** ratify D-slot-2 (invocation-scoped for *all* slot content, retiring
D-slot-1's parent-lexical rule), OR keep a split (unscoped = parent-lexical; scoped =
invocation-scoped). I lean **all invocation-scoped** — one rule is simpler, G4.6 still
passes, and "slot content lives as long as where it's rendered" is the intuitive model. A
split means "is this slot scoped?" silently changes ownership, which is the kind of
hidden-semantic seam we avoid. But retiring D-slot-1 is a logged §6 decision, so it is
yours to make, not mine to assume.

---

## 5. GATE-2 — unify the walk, or extend the sub-walk? (the surface-area call)

**✅ RULED (2026-06-22): Option 2b — collapse.** Route slot content through the same
recursive `processHtmlTemplate`, retiring the bespoke `buildSlotSubIR`/`buildNvSlotSubIR`
sub-walks. Permanently removes the degraded-copy class (the B1/B3 root cause) rather than
re-arming it. Accepted cost: a real refactor of the slot-capture path (it must hand the
recursive call the slot subtree's hole exprs + positions). This lands in increment 1 (it is
what makes component-as-slot-child fall out for free).
`buildNvSlotSubIR`) detect comment + attr/prop/event sentinels but **not** component
elements. To support `<Card/>` inside slot content they must learn the component-element
case — including capturing *its* slots, recursively. That is re-growing the top-level walk
inside the sub-walk: **the exact degraded-copy class B1/B3 came from.**

- **Option 2a — minimal:** teach the sub-walk the component-element case. Smallest diff,
  but re-arms the divergence trap (now two walks both do component detection, which can
  drift).
- **Option 2b — collapse (recommended):** route slot content through the **same**
  `processHtmlTemplate` recursively, deleting the bespoke sub-walks. Then component-in-slot,
  conditional-in-slot, and outlet-in-slot all fall out *because slot content is processed by
  identical machinery as top-level content* — no second walk to keep in sync. This is the
  "unify and simplify surface area" win you asked for, and it removes the B1/B3 root cause
  permanently rather than patching it again.

**Cost of 2b (honest):** slot content is currently captured as already-walked DOM subtrees,
whereas `processHtmlTemplate` consumes a freshly-parsed fragment with original
`strings`/`holeExprs`. Collapsing requires the slot path to hand the recursive call enough
context (the hole exprs + positions for the slot's subtree). Doable — the hole exprs are in
scope — but it is a real refactor of the capture path, not a one-liner. **My recommendation
is 2b**, accepting the refactor, because it permanently retires the degraded-copy class. If
you want the smaller step now, 2a ships component-in-slot faster at the cost of carrying the
trap. Your call.

---

## 6. GATE-3 — authoring surface (LOCKED candidate; pending GATE-1/2/4)

Authoring-layer (above the reactive-core contract per 2026-06-18) but it shapes the parser,
so it is settled here alongside the IR shape. Resolved as follows.

### 6.1 Child exposes values at the outlet

The child publishes an object of values at the outlet. The exposed **keys are the
child↔parent contract** — `let={...}` on the parent binds these keys, nothing is inferred
from prop names.

- **`.nv`:** bare signals; the compiler erases each expose entry to an **accessor thunk**
  (NOT a value call), so the parent's content stays reactive to it:
  ```jsx
  {slots.row({ item: item, index: index })}      // erases entries → { item: () => item(), … }
  ```
  Author writes the bare signal; the compiler knows an expose-object entry wraps as a thunk.
  **Do not** write `() =>` (that is the tagged-template form) and **do not** write `item()`
  (that snapshots the value at expose time → dead, never updates).
- **tagged-template:** explicit accessor thunks (no compiler):
  ```js
  ${slots('row', { item: () => itemSig(), index: () => idxSig() })}
  ```

**Known v0 limit:** object **shorthand** in the expose object (`{ item, index }`) is NOT
erased by the `.nv` parser (the existing shorthand-erasure gap). Write the long form
`{ item: item, index: index }` until shorthand erasure lands. Follow-on, not v1-blocking.

### 6.2 Parent binds exposed values — `let={ ... }` (single attribute)

One `let={...}` destructure attribute on the `<slot>` fill, naming all bound locals. Chosen
over repeated `let:a let:b` (no token pile-up) and over `slot-props={...}` (keeps the `let`
token the owner prefers).

- **`.nv`:**
  ```jsx
  <slot name="row" let={ item, index }>
    <span>{index}: {item.name}</span>
  </slot>
  ```
- **tagged-template:** the fill is a function of the exposed object — destructure is just
  normal JS, no invented attribute syntax (the two front-ends line up here):
  ```js
  slot('row', ({ item, index }) => html`<span>${() => index()}: ${() => item().name}</span>`)
  ```

**`let` is contextually reserved** — special ONLY as an attribute on a `<slot>` fill. It is
ordinary everywhere else: `$script` bodies use `let x = …` as normal JS (the parser already
tracks block-scoped `let` for shadowing). The `<slot>` element is consumed at parse time and
never emitted, so claiming `let` as its attribute cannot collide with output DOM. **Zero
runtime cost** — `let={...}` vs `let:a let:b` is purely parse-time; both wire the same
content factory to read the same exposed-props object; identical reactivity cost (one
accessor-thunk read per bound name actually used).

**Tag-level `let` deferred.** `<List let={...}>` (scope hoisted to the component tag) is
sugar for `let` on the *default* slot only, and becomes ambiguous the moment a component
exposes scope on two slots (Svelte hit this; v5 moved away from it). v1: scope attaches to
`<slot>` only. Tag-level may be added later as single-default-slot sugar if it earns it.

### 6.3 Fallback (child-authored default)

- **`.nv`:** right-operand form — reads "slot, or this if empty":
  ```jsx
  <header>{slots.header ?? html`<h1>Untitled</h1>`}</header>
  ```
- **tagged-template:**
  ```js
  ${slots('header', { fallback: html`<h1>Untitled</h1>` })}
  ```

### 6.4 Future ergonomic — `let`-name validation (not v1)

The child's exposed key set is statically known at the outlet, so the parser CAN validate
parent `let={...}` names against it and diagnose a typo (`let={ isOpen }` when the child
exposed `open`) instead of silently binding `undefined`. Worth a build-time diagnostic once
the surface lands; noted, not v1-blocking.

---

## 7. Contract impact

- **Template-IR:** real IR-shape change (`SlotEntry.content` type changes; `SlotOutletBinding`
  gains `props?`/`fallback?`). This is a genuine evolution, not doc-only → propose
  **v0.3.2 → v0.4** (parallels v0.3 adding ComponentBinding). Both back-ends require updated
  `slot-outlet`/component handling.
- **reactive-core:** **v0.4.2 unchanged** *if* GATE-1 resolves to invocation-scoped using the
  existing `getOwner`/`runWithOwner`/`createRoot` surface (as ListBinding did). No new
  primitive anticipated. If review finds a §6 gap (as the ListBinding ownership trap
  surfaced one), that escalates separately — surface before landing.

---

## 8. Soundness obligations (the gate when CC builds)

- **FE-equivalence (§6.1):** both front-ends produce identical scoped-slot IR (factory shape,
  `props`, `fallback`) — `irStructurallyEqual`. Same seam that carried every prior proof.
- **BE-equivalence (§6.2):** interpreter vs emitted, scoped-slot content renders identically,
  exposed-value reads update identically, disposal leaks nothing — `structurallyEqual` after
  a child-exposed-value write AND a parent-signal write.
- **Ownership (GATE-1):** differential corpus must include (a) child disposes one invocation
  → that content's effects gone, siblings + parent signal live (the list-row case); (b)
  parent disposes → all invocations gone. Non-vacuous, fail-shows-teeth.
- **One-directional proof:** assert there is **no** write-back path — a write to a
  child-exposed value updates parent content; no parent action writes the child value through
  the slot. Pins "not two-way binding."
- **Corpus extension (durable fix):** scoped-slot, fallback-rendered, component-in-slot,
  conditional-in-slot-via-recursion (if 2b) — each through both front-ends and both back-ends.

---

## 9. Phasing — ✅ RULED: Path B (small wins first)

Two increments. Increment 1 lands the cheap, high-value features on the collapse; increment 2
is the heavy, ownership-touching scoped-slots change on its own gated session.

### Increment 1 — collapse + component-as-slot-child + fallback (CC: `cc-handoff-slot-collapse-fallback.md`)

- **GATE-2 collapse** — retire `buildSlotSubIR`/`buildNvSlotSubIR`; slot content goes through
  recursive `processHtmlTemplate`. Must be **behavior-neutral**: the existing slot corpus
  (G3.1, §8.2-B1/B3) stays green on the refactor alone, *before* any feature is added.
- **Component-as-slot-child** — falls out of the collapse (slot content = top-level walk →
  component-element detection + recursive slot capture for free). No IR shape change
  (`SlotEntry.content` is already a full `TemplateIR`; bindings may include `ComponentBinding`).
- **Fallback** — additive IR field `SlotOutletBinding.fallback?: TemplateIR`; outlet renders
  it when the slot is absent. Owned at the outlet scope (child-authored).
- **Ownership:** retains **D-slot-1** (no scoped dependency yet). Unchanged §6 behavior.
- **Contract:** Template-IR **v0.3.2 → v0.3.3** (additive optional `fallback` field; collapse
  is doc-neutral). reactive-core **v0.4.2 unchanged**, no §6 change.

### Increment 2 — scoped slots (separate gated CC session, later)

- `SlotEntry.content` → factory `(slotProps) => TemplateIR`; `SlotOutletBinding.props?`
  (child-exposed accessor thunks); `let={...}` authoring (§6); **D-slot-2** invocation-scoped
  ownership (GATE-1) — retires D-slot-1, surfaced as a §6 decision before landing.
- **Contract:** Template-IR **v0.3.3 → v0.4** (content-factory shape change + `props`).
  reactive-core v0.4.2 if implemented via existing owner-context utilities (verify vs
  `wireList`); escalate if a §6 gap surfaces.

Increment-1 fields/refactor are not undone by increment 2 — `fallback` stays, the collapsed
walk is what increment 2's factory shape is built on. No double-refactor.

---

## 10. Not in scope

- `$style` scoping and `$style × slots` — blocked on compile-time encapsulation research;
  unrelated to the slot-content seam. Parked.
- Multi-root slot content beyond what multi-root mount already supports (no new constraint).
- SSR/hydration of slots.

---

## Open gates — ✅ ALL RESOLVED (2026-06-22)

1. **GATE-1 (§6, D-slot-2):** RESOLVED — invocation-scoped ownership for all slot content;
   retires D-slot-1. Lands with increment 2 (scoped slots); increment 1 retains D-slot-1.
2. **GATE-2 (surface area):** RESOLVED — collapse slot content into recursive
   `processHtmlTemplate` (2b). Lands in increment 1.
3. **GATE-3 (authoring):** RESOLVED — `let={ ... }` destructure on `<slot>`; expose entries
   erase to accessor thunks; fallback via `??` / `{ fallback }`; `let` contextually reserved;
   tag-level `let` deferred. See §6.
4. **GATE-4 (phasing):** RESOLVED — Path B (small wins first). See §9.

## Forward-looking (do not collide with this)

- **`each` iteration construct + key function.** When list authoring lands (forward queue,
  gated on row-churn reorder data), the iteration token is `each` (more honest than `map`,
  which implies unkeyed). nv keys the *list*, not the element — **no React `key` prop**;
  the key is a function carried by the construct (`ListBinding.key` already). Candidate
  surface `<each .of="${items}" key="id" let={ item, index }>` makes a list item a scoped
  slot the `each` fills per row — folding list-item scope into THIS scoped-slot mechanism.
  Design the `SlotEntry.content` factory + `let={...}` so `each` reuses it rather than
  forking a parallel construct. Exposed keys for `each`: `item, index` (and `array` if
  cheap), the JS `.map` triple.
- nv has exactly three control families and no others (run-once forbids `while`/imperative
  loops): `ConditionalBinding` (if/else), `ListBinding` (keyed each), `SyncBinding`
  (two-way, deferred). Iteration is always keyed-each; "repeat N times" is `each` over a
  range array, userland.
