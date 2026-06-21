# nv — Slot Consumption (Design, for review)

**Stream:** (3) Renderer/templating
**Status:** LANDED (2026-06-21) — G6 read-back passed. All gate items G0–G5 passed; pushed to main (b63812b). Forward-queue items confirmed deferred (slot fallback, scoped slots, component-as-slot-child, $style×slots).
**Contract reference:** Reactive Core Runtime Contract **v0.4.2** (consumed unchanged) · Template-IR **v0.3** (consumed unchanged)
**Builds on:** Component API v1 (2026-06-21), A2 emitter factory-shape convergence (2026-06-21)

---

## 1. What this is

Component factories on both back-ends already accept a `slots` parameter (`Name(props, slots) → TemplateIR`) but **do not consume it**: slot content is captured (default-only, static-only) and threaded through, then ignored at render time. This feature makes both back-ends render slot content into the child, and widens capture on both front-ends to **named** slots containing **reactive** holes.

One feature, four paths:

| Path | File | Today | After |
|---|---|---|---|
| Capture (tagged) | `html-tag.ts` | default-only, static-only; reactive → `warn` + `slots:[]`, holes **not** consumed | named + reactive; slot holes captured into sub-IR, consumed |
| Capture (.nv) | `nv-parser.ts` | default-only, static-only; reactive → `warn` + `slots:[]`, holes consumed-but-dropped | named + reactive; slot holes captured into sub-IR |
| Emit erasure | `nv-emitter.ts` (`parseNvFileForEmit`) | `slots: []` hardcoded | slot thunks erased under parent scope, emitted |
| Consume | `interpreter.ts`, `emitted-mount.ts` | factory receives `slotsObj`, ignores it | factory renders slot content at insertion points |

No IR change, no contract change (justified in §6).

## 2. Scope (locked)

- **In:** named slots + default slot; reactive holes inside slot content; both front-ends; emit; both back-ends; FE-equivalence + differential gates over all of it.
- **Out (forward queue):** nested-component content *as* a slot child (a component inside a slot — separate from emitted-component-as-child, already deferred); slot fallback/default content when a slot is unfilled; scoped slots (slot props passed child→parent); `$style` interaction with slotted content.

## 3. Decisions (settled)

### D-slot-1 — Ownership is parent-lexical
Slot content's reactive reads are lexically the parent's (the holes close over the parent's signals/scope). The content is therefore **owned by the owner active at the parent's call site**, not by the child root. Rendered via `runWithOwner(capturedParentOwner, () => emitSetup(slotIR))` at the child's chosen insertion point.

**Why (performance-first, not ergonomics):** the alternative — child-root ownership — would make slot content's lifetime diverge from the lifetime of the signals it reads. If the parent outlives the child, a parent re-render would touch effects already disposed with the child; making that correct requires cross-owner bookkeeping on every slotted component. Parent-lexical needs none: lifetime matches the reads by construction. This is the render-here-own-there split (Solid's `children` model): insertion point is the child's concern, ownership is the parent's.

**Contract status:** consumes §6.1 `getOwner`/`runWithOwner` *as-is*. §6.1 states ownership redirection is observation-neutral (lifetime only, not what any computation observes). So this is **not** the costlier escalation class (it does not determine what a computation observes mid-propagation). Surfaced per discipline (it touches §6.1); resolution is "uses v0.4.2 unchanged." Contrast ListBinding, which *added* `getOwner`/`runWithOwner` and warranted pre-landing escalation; this only *consumes* them.

### D-slot-2 — Named-slot capture syntax: `<slot name="…">` wrapper (parent/content side)
Content for a named slot is wrapped in a `<slot name="header">…</slot>` element among the component's children. Default slot = children **not** wrapped in `<slot>`.

**Why this and not `slot="…"` attribute:**
- Reuses the existing DFS descent + attribute inspection — one tag check, same machinery that finds `data-nv-component`. No new sentinel channel.
- Unambiguous against props: props are attributes *on the component tag* (`.name=` / `data-nv-prop-N`); slots are `<slot>` elements *among children*. A bare `slot="x"` attribute on arbitrary children would force a reserved attribute name into the parser's attribute walk.
- Build-time honest: `<slot>` here is a **capture marker** erased into `SlotEntry{name}` at parse time; it never reaches the DOM. It is not Web-Components runtime distribution (we have none), so the syntax shouldn't imply it.

`SlotEntry`/`SlotFns` already key by `name` — capturing `name="header"` instead of hardcoding `'default'` is the whole IR-side change (none).

### D-slot-3 — Reactive holes in slots are captured as a real sub-`TemplateIR`
Today both front-ends detect reactive slot content and drop it (differently — see §4 Finding). Instead, slot content is parsed into its own `TemplateIR` (`shape` + `bindings`) exactly like a conditional branch's `consequent`. The slot's holes become bindings *in the slot IR*, and the parent must mark those hole indices consumed (so they are not also emitted as parent bindings pointing into a replaced subtree).

## 4. Child-side insertion — RESOLVED (D-slot-4)

### D-slot-4 — `{slots.<name>}` hole → dedicated `SlotOutletBinding` (template-ir v0.3 → v0.3.1)
The child marks where a slot renders with a text-position hole reading `slots.<name>` (default: `{slots.default}`). The front-end recognizes a `slots.<name>` hole and emits a **new binding kind**:

```typescript
type SlotOutletBinding = BaseBinding & {
  kind: 'slot-outlet'
  name: string          // slot name to resolve from slotsObj
  // NO expr: a slot outlet observes nothing reactively. It reads slotsObj
  // (a structural input), not a signal. Ownership is parent-lexical (D-slot-1).
}
```

Target node: Comment anchor (same family as `child`/`conditional`/`component`).

**Why a dedicated kind, not overloaded `ChildBinding`:** `ChildBinding` is `{ expr: ReactiveExpr<primitive> }` — its contract is "call `expr()`, stringify, write text." A slot outlet has no `expr`, isn't reactive-primitive, and reads `slotsObj` not a signal. Routing it through `ChildBinding` would either lie about the `expr` type or smuggle a back-end side-channel. The same reasoning made `ComponentBinding` its own kind rather than a special `child`: the IR stays honest about what each binding observes and how it is owned, and the differential gate can assert on `kind:'slot-outlet'` directly instead of disambiguating overloaded `child` bindings.

**Cost:** template-ir v0.3 → **v0.3.1**, a new `case` in both back-ends, and `slots.<name>` hole recognition in both front-ends — all in scope for this feature.

## 5. Mechanics (back-end consumption)

Insertion point (whichever Q-slot-A spelling) resolves to an anchor `Comment`, same family as `child`/`conditional`/`component`. At mount:

```
// capturedParentOwner = getOwner() taken at the ComponentBinding's instantiation
// (the parent's call site), BEFORE entering the child's createRoot.
const slotDisposers = [];
for (const insertionPoint of childInsertionPoints) {
  const slotIR = slotsObj[insertionPoint.name];        // TemplateIR | undefined
  if (!slotIR) continue;                                 // unfilled slot: render nothing (v1; fallback deferred)
  runWithOwner(capturedParentOwner, () => {
    const d = createRoot((dispose) => {
      const frag = emitSetup(slotIR);                    // slot effects owned by parent, by §6.1
      insertionPoint.anchor.parentNode.insertBefore(frag, insertionPoint.anchor);
      onCleanup(() => frag.remove());
      return dispose;
    });
    slotDisposers.push(d);
  });
}
onCleanup(() => { for (const d of slotDisposers) d(); });  // bridges child teardown → slot teardown
```

Key points the gate must pin:
- `capturedParentOwner` is captured at the parent call site, not inside the child root. If captured inside, slot effects would be owned by the child and disposed on child teardown while the parent still holds the signals — the exact hazard D-slot-1 avoids.
- Slot content disposal is bridged both ways: parent disposal tears down the parent owner (which owns slot effects); child disposal runs the `onCleanup` above (which removes slot DOM + disposes the slot roots). Both must leave zero leaks.
- An unfilled named slot renders nothing in v1 — specifically, no element and no
  meaningful text. The outlet's anchor `Comment` remains in the DOM (same as
  `child`/`conditional`/`component` anchors); it is inert. Fallback content is
  deferred (forward queue).

## 6. IR / contract impact

- `SlotEntry`/`SlotFns`/`ComponentBinding` already model named slots with `TemplateIR` content. Capture populates fields that exist — no change there.
- **New:** `SlotOutletBinding` (D-slot-4) → template-ir **v0.3 → v0.3.1**, added to the `Binding` union in `ir.ts`. This is the one IR change; it is recorded in the decision-log entry at close-out with the version bump noted.
- `runWithOwner`/`getOwner` are v0.4.2 §6.1, conformance-pinned (§12.24). Consumed unchanged — **reactive-core stays v0.4.2**.
- The slot content IR is an ordinary `TemplateIR` — the back-ends already instantiate those (it is what `ConditionalBinding` branches are).

## 7. Front-end equivalence (the divergence this closes)

**Finding (must fix):** today the two front-ends disagree on dynamic-slot hole handling. `html-tag.ts` warns and does **not** mark embedded holes consumed (they fall through to parent bindings — latent landmine once slots render). `nv-parser.ts` marks them consumed, then drops them. Under this feature both must: parse slot content into a sub-IR, capture its holes as slot-IR bindings, and mark exactly those parent hole indices consumed. The FE-equivalence gate asserts both front-ends produce structurally identical slot sub-IRs (shape.html, bindingPaths, binding kinds) for the same template.

## 8. Test surface (feeds the gate)

- **FE-equivalence:** same template via both front-ends → identical slot sub-IR structure (named + default; static + reactive).
- **Differential (interpreter vs compiler):** named slot renders at correct insertion point; reactive hole inside a slot updates on parent signal write; multiple named slots; default + named coexist; unfilled named slot renders nothing.
- **Disposal (both directions, both back-ends):** parent-dispose → slot effects + DOM gone, no leak; child-dispose → slot DOM gone, parent signals still live and writable, no leak (this is the parent-lexical correctness proof).
- **Negative/structural:** slot content with a reactive hole, parent signal write after child disposal → no DOM mutation, no recompute (dead). Sweep for vacuous assertions.

## 9. CC scope note (named, not in design)

`nv-emitter.ts` reactive-slot erasure is real work the A2 handoff didn't carry: slot holes must be erased under the *parent's* `symbols`/`propsAccessors` (a slot reading a parent prop must erase to `props.x()`), parallel to `bindingThunks`, replacing the hardcoded `slots: []`. The gate must include an emit-path differential item, not only an interpreter one.
