# nv Template IR — Design v0.4
 
**Stream:** (3) Renderer/templating  
**Contract reference:** nv Reactive Core Runtime Contract v0.4.2  
**Status:** Approved — v0.4 (2026-06-22). Increment 2 (scoped-slot shape + authoring) landed.  
**Changelog:**  
- v0.2 (2026-06-17): initial approved IR spec — six binding kinds (PoC scope) + two designed-deferred (List, Sync).  
- v0.2.1 (2026-06-20): multi-root template shapes; list item single-root constraint noted.  
- v0.3 (2026-06-20): add ComponentBinding, PropEntry, SlotEntry, ComponentRef, PropsObject, SlotFns.
- v0.3.1 (2026-06-21): add SlotOutletBinding (kind:'slot-outlet', name, no expr); named + reactive slot capture on both front-ends.
- v0.3.2 (2026-06-21): doc-only. Tagged-template front-end now uses `slots('name')` sentinel for outlet detection; `.nv` front-end keeps `slots.name` AST detection. Both mechanisms produce identical `SlotOutletBinding` — IR shape unchanged. See §6.1.
- v0.3.3 (2026-06-22): additive `fallback?: TemplateIR` on `SlotOutletBinding`; walk-collapse (GATE-2) — slot content now processed by the same recursive walk as top-level content; component-as-slot-child falls out. reactive-core v0.4.2 unchanged. D-slot-1 retained.
- v0.4 (2026-06-22): `SlotEntry.content` → factory `(props: SlotProps) => TemplateIR` (hard-cut, no union). `SlotOutletBinding.props?: readonly PropEntry[]` — child-exposed accessor thunks. `SlotFns` updated accordingly. `let={...}` authoring on both front-ends. D-slot-1 retained. reactive-core v0.4.2 unchanged.
 
---
 
## What this document is
 
The template IR is the contract between four components: a `.nv` file front-end,
a tagged-template front-end, a runtime interpreter back-end, and a compiler
back-end. Everything else in the renderer stream is derived from it. A wrong IR
cannot be patched downstream without forking the two back-ends, which is the
failure mode this architecture exists to prevent.
 
This document answers the five required questions from the stream brief concretely,
flags two escalation surface areas, and defines the differential conformance suite
that enforces back-end equivalence over time. **Nothing here is implementation;
it is the contract that implementations must satisfy.**
 
---
 
## 1. Overview
 
One template language produces one IR. Two front-ends parse source into that IR;
two back-ends consume the IR to produce live DOM + bindings. The delimiter
difference (`{}` vs `${}`) and the source-file difference (`.nv` vs tagged
template) are front-end lexing concerns, erased before the IR is produced.
 
```
.nv file source      ──┐                    ┌── runtime interpreter ── live DOM
                       ├── TemplateIR ───────┤
tagged-template src  ──┘                    └── compiler ── emitted code ── live DOM
```
 
The IR is the seam. Its stability is what allows the two back-ends to stay
semantically welded. The differential conformance suite (§8) is the mechanical
enforcement.
 
---
 
## 2. Core Structure
 
### 2.1 TemplateIR
 
```typescript
/**
 * Top-level IR for one template region.
 *
 * A TemplateIR is produced per-instantiation on the tagged-template path
 * (expressions are live closures capturing the component scope). On the .nv/
 * compiler path, the structural form (with AST expressions) is produced at
 * parse time and reused across instantiations — the compiler emits a factory
 * function that, when called, produces a TemplateIR.
 *
 * The `id` is stable across instantiations of the same template site.
 */
type TemplateIR = {
  id:       string;           // stable template identity (file + source position)
  shape:    TemplateShape;    // static DOM structure (shared across instances)
  bindings: readonly Binding[];  // reactive/imperative holes, index-aligned with shape.bindingPaths
  meta?:    TemplateMeta;     // diagnostic metadata; does not affect semantics
};
 
type TemplateMeta = {
  source?:   SourceSpan;
  frontEnd?: 'nv-file' | 'tagged-template';
};
 
type SourceSpan = { file: string; start: number; end: number };
```
 
### 2.2 TemplateShape — the static/dynamic split
 
The shape owns everything that never changes: the static DOM structure and the
positional addresses of all reactive holes. It is the heart of fine-grained
rendering — the static part is cloned once per instantiation; the holes are the
only points that ever touch the DOM reactively.
 
```typescript
/**
 * The static DOM description for a template.
 *
 * `html` is a serialized HTML string with `<!--nv-->` comment sentinels at each
 * binding position. The sentinels are for human-readable debugging and are not
 * required by back-ends; `bindingPaths` is the authoritative locator.
 *
 * `bindingPaths[i]` is the NodePath locating the DOM node targeted by
 * `bindings[i]`. Paths are stable across clones of the same shape.
 *
 * One TemplateShape per template site. Shared (not cloned) across instances.
 */
type TemplateShape = {
  html:          string;               // static HTML with <!--nv--> sentinels
  bindingPaths:  readonly NodePath[];  // bindingPaths.length === bindings.length
};
 
/**
 * A positional path from a cloned template root (a DocumentFragment) to a
 * target DOM node. Each element is the 0-based child index at that tree level.
 *
 * Example: [0, 2] = root.childNodes[0].childNodes[2]
 *
 * Back-ends walk the cloned tree using this path on instantiation to obtain
 * a stable reference to the binding target. No DOM sentinel scanning required.
 */
type NodePath = readonly number[];
```
 
**Static/dynamic invariant.** The `html` string contains no reactive values —
only structure, static attributes, static text, and `<!--nv-->` sentinels at hole
positions. Every reactive value lives in a `Binding`. A template instantiation
therefore does exactly two things: clone the shape once (one `cloneNode(true)`
call), then walk each `bindingPaths[i]` once to locate the binding target. After
that, all reactivity is in the effects and their DOM-write closures — no further
structural traversal.
 
**Binding target node types.** Each binding targets a specific DOM node kind:
 
| Binding kind          | Target node kind      | What happens to the sentinel |
|----------------------|----------------------|------------------------------|
| `text`               | `Text` node          | Sentinel replaced with empty Text node at instantiation |
| `attr`, `prop`, `event`, `sync` | `Element`  | Sentinel is a sibling comment; path targets the element |
| `child`              | `Comment` (anchor)   | Sentinel IS the anchor; content inserted before it |
| `conditional`, `list` | `Comment` (anchor)  | Same as `child` |
| `component`          | `Comment` (anchor)   | Same as `child`; child DOM comes from the factory |
 
The path for `text` bindings points to the `Text` node (post-replacement).
The path for `attr`/`prop`/`event` bindings points to the `Element` itself.
The path for structural bindings (`child`, `conditional`, `list`) points to the
anchor `Comment` node; the back-end inserts/removes content before this anchor.
 
---
 
## 3. Binding Kinds
 
Ten kinds total: six in PoC scope, two designed-and-deferred, one added in v0.3, one added in v0.3.1.
 
```typescript
type Binding =
  | TextBinding        // ─┐
  | AttrBinding        //  │
  | PropBinding        //  ├── PoC scope
  | EventBinding       //  │
  | ChildBinding       //  │
  | ConditionalBinding // ─┘
  | ListBinding        //  ── designed, deferred (§3.7)
  | SyncBinding        //  ── designed, deferred (§3.8)
  | ComponentBinding   //  ── v0.3 (component API)
  | SlotOutletBinding; //  ── v0.3.1 (slot consumption); v0.3.3 adds optional `fallback?: TemplateIR`
 
type BaseBinding = {
  pathIndex: number;   // index into shape.bindingPaths — which node this targets
  meta?:     { source?: SourceSpan };
};
```
 
### 3.1 TextBinding
 
Updates a `Text` node's content reactively. The common case for template
interpolations that always yield a primitive.
 
```typescript
type TextBinding = BaseBinding & {
  kind: 'text';
  expr: ReactiveExpr<string | number | boolean | null | undefined>;
};
```
 
Back-end mapping (§5): creates one `effect`:
```
effect(() => { textNode.data = String(expr() ?? ''); })
```
The effect is owned by the template's root owner (§6). On disposal the edge is
severed automatically; no explicit DOM cleanup needed (the text node disappears
with the parent).
 
### 3.2 AttrBinding
 
Updates an HTML attribute reactively. `null`/`undefined`/`false` removes the
attribute (standard HTML boolean-attribute semantics).
 
```typescript
type AttrBinding = BaseBinding & {
  kind: 'attr';
  name: string;
  expr: ReactiveExpr<string | number | boolean | null | undefined>;
};
```
 
Back-end mapping: one `effect`:
```
effect(() => {
  const v = expr();
  if (v == null || v === false) el.removeAttribute(name);
  else el.setAttribute(name, v === true ? '' : String(v));
})
```
 
### 3.3 PropBinding
 
Sets a DOM property directly (bypassing attribute reflection). Used for
`value`, `checked`, `innerHTML`, and any property that differs from its
attribute counterpart.
 
```typescript
type PropBinding = BaseBinding & {
  kind: 'prop';
  name: string;
  expr: ReactiveExpr<unknown>;
};
```
 
Back-end mapping: one `effect`:
```
effect(() => { (el as any)[name] = expr(); })
```
 
### 3.4 EventBinding
 
Registers an event listener imperatively. The handler expression is treated as
reactive so that a handler that changes over time (e.g., `() => handlers.current`)
always calls the latest handler without re-registering.
 
```typescript
type EventBinding = BaseBinding & {
  kind:        'event';
  eventName:   string;
  handler:     HandlerExpr;    // () => (e: Event) => void
  handlerKind: 'stable' | 'reactive';
  // 'stable'   — handler is a fixed function; the wrapper-effect still runs, but
  //              only once and thereafter goes inert. v0 always emits 'reactive'.
  // 'reactive' — handler expression depends on signals; the effect re-runs on change.
  //
  // v0 rule: front-ends always emit 'reactive'. The optimization that skips the
  // effect for 'stable' is a performance hypothesis, deferred to benchmark
  // validation in Claude Code (same §10 hard rule as equality-policy inference).
  // The field exists now to prevent an IR shape change when that optimization lands.
  options?:    AddEventListenerOptions;
};
```
 
Back-end mapping (v0 — always wrapper-effect, regardless of `handlerKind`):
 
```
// Handler wrapper: listener is registered once; effect tracks the expression
let current: ((e: Event) => void) | null = null;
const listener = (e: Event) => { if (current) current(e); };
 
effect(() => { current = handler(); }); // tracks reactivity in handler expression
 
el.addEventListener(eventName, listener, options);
onCleanup(() => el.removeEventListener(eventName, listener, options));
```
 
The `addEventListener`/`removeEventListener` calls are **outside** the reactive
graph — they are imperative setup/teardown. The `effect` only tracks the handler
expression. For the common case where `handler` is a stable function (`handlerKind:
'stable'`), the effect runs once and `current` never changes; the effect is inert
thereafter but its existence is harmless.
 
**Note on event-handler writes.** When the listener fires, `current(e)` executes
outside any tracking context (it is called by the DOM, not during a reactive pull).
Any `signal.set()` calls inside the handler are normal writes that go through §4
and schedule a flush. There is no reactive tracking hazard here.
 
### 3.5 ChildBinding
 
A dynamic content hole for reactive values that may produce DOM-compatible
content. Targets an anchor `Comment` node; content is inserted before the anchor.
 
```typescript
type ChildBinding = BaseBinding & {
  kind: 'child';
  expr: ReactiveExpr<string | number | null | undefined>;
  // v0 scope: primitives only → rendered as a single Text node.
  // Deferred: expr() returning a DOM Node or TemplateIR instance.
};
```
 
v0 back-end mapping: one `effect` plus a single `Text` node managed next to the
anchor:
 
```
let textNode: Text = document.createTextNode('');
anchor.parentNode!.insertBefore(textNode, anchor);
onCleanup(() => textNode.remove());
 
effect(() => {
  const v = expr();
  textNode.data = v == null ? '' : String(v);
});
```
 
The distinction from `TextBinding`: a `TextBinding` targets a `Text` node whose
position in the DOM is fixed at parse time. A `ChildBinding` targets an anchor
and owns the `Text` node it inserts — the content's position is determined at
runtime and the content can in future be replaced by different node types without
changing the IR.
 
### 3.6 ConditionalBinding
 
A structural `{#if}` / `{:else}` form. Mounts/unmounts branch `TemplateIR`
instances in reaction to a boolean condition.
 
```typescript
type ConditionalBinding = BaseBinding & {
  kind:       'conditional';
  condition:  ReactiveExpr<boolean>;
  consequent: TemplateIR;       // "then" branch
  alternate:  TemplateIR | null; // "else" branch; null = nothing
};
```
 
Back-end mapping:
 
```
let branchDisposer: (() => void) | null = null;
 
effect(() => {
  // Dispose previous branch (removes its DOM and reactive edges)
  if (branchDisposer) { branchDisposer(); branchDisposer = null; }
 
  const template = condition() ? consequent : alternate;
  if (!template) return;
 
  branchDisposer = createRoot((dispose) => {
    // Instantiate the branch template — creates its own effects, owned by this root
    const fragment = instantiate(template, anchor);
    anchor.parentNode!.insertBefore(fragment, anchor);
    onCleanup(() => fragment.remove());  // DOM cleanup on this root's disposal
    return dispose;
  });
 
  // If THIS effect is disposed (parent unmount), clean up the live branch
  onCleanup(() => { if (branchDisposer) { branchDisposer(); branchDisposer = null; } });
});
```
 
The branch `createRoot` is independent of the parent effect's ownership — it is
explicitly managed. This matches the §6 contract: a root owner is an explicit
lifetime boundary. The parent effect's `onCleanup` bridges the two lifetimes
(if the parent is torn down, the branch root is disposed).
 
**Escalation check (§6 contract).** The `condition` expression is read inside an
`effect`, not a `derived`. The branches are instantiated inside a new `createRoot`
scope. No `derived` writes, no `sync` target violations. ✓
 
### 3.7 ListBinding (designed, deferred)
 
Keyed list reconciliation. Each item gets its own `createRoot` scope (matching
the §6 ownership model) so that item disposal severs only that item's edges and
DOM without touching siblings.
 
```typescript
// DESIGNED — NOT IN PoC SCOPE
// Deferred: key-based DOM reconciliation algorithm bloats the first pass.
// Intent recorded here so the back-end interface is designed alongside the rest.
type ListBinding = BaseBinding & {
  kind:         'list';
  items:        ReactiveExpr<readonly unknown[]>;
  key:          (item: unknown, index: number) => string | number;
  itemTemplate: TemplateIR;  // instantiated once per item; item value threaded in via scope
};
```
 
Back-end sketch: one top-level `effect` that observes `items()` and reconciles:
creates new item roots for new keys, disposes roots for removed keys, reorders DOM
nodes for moved keys. Each item root owns that item's `ChildBinding`/`TextBinding`/
etc. The reconciliation algorithm itself (LIS-based, Ivi-style) is a back-end
detail, not an IR concern.
 
### 3.8 SyncBinding (designed, deferred)
 
Two-way binding. Combines a signal→DOM direction (read, like `PropBinding`) with a
DOM→signal direction (write-back, using the `sync` external-source path from
§8.5–8.6).
 
```typescript
// DESIGNED — NOT IN PoC SCOPE
// Deferred: depends on deeper component/form API design.
type SyncBinding = BaseBinding & {
  kind:         'sync';
  // Signal→DOM direction (maps to PropBinding behavior):
  propName:     string;
  readExpr:     ReactiveExpr<unknown>;
  // DOM→signal direction (maps to sync() with external pubsub source):
  eventName:    string;                           // DOM event that triggers write-back
  writeTarget:  () => { set: (v: unknown) => void }; // reference to the target signal
  transform?:   (eventValue: unknown, current: unknown) => unknown; // map or reduce arity
};
```
 
Write-back back-end mapping:
 
```
// DOM→signal: sync with external pubsub source
const ps = pubsub();
el.addEventListener(eventName, ps.publish);
onCleanup(() => el.removeEventListener(eventName, ps.publish));
 
sync(ps, writeTarget(), transform ?? ((v) => (v as InputEvent).target?.value));
```
 
**Contract check.** `writeTarget()` is a statically known signal at template
parse time (inferred from `bind:value={formField}` — `formField` is an
enumerable `Signal`). The `sync` source is a `pubsub` (external), so the
`source` is an external producer — no reactive cycle is possible (§8.5.1). The
`sync` target classification (§8.5.3) accepts this as `ACCEPT`. ✓
 
**Compiler-stream seam (`writeTargetId` — agreed, build when SyncBinding is scoped).**
For the compiler back-end to connect the DOM→signal write-back edge into the
§8.5.2 write-graph cycle check, the `SyncBinding` must carry the `SignalId` of the
write target alongside the live `writeTarget` reference. The agreed resolution is an
optional field `writeTargetId?: SignalId`, populated only on the compiler path.
The `SignalId` MUST be produced by the same `signalSymbolId` derivation used in
compiler steps 1–2 and 4 — this is the identical cross-pass identity seam that
has applied at every compiler step. If the renderer's `writeTargetId` uses a
different derivation, the cycle checker cannot connect the renderer's write-back
edge to the rest of the write-graph. Build this field when `SyncBinding` is scoped;
note it here so the requirement is on record.
 
### ComponentBinding (v0.3)
 
A child component invocation. Mounts a child factory in its own `createRoot` scope,
passing props as live accessor thunks and slot content as `TemplateIR` instances.
 
```typescript
type PropsObject = { readonly [name: string]: ReactiveExpr }
type SlotProps   = PropsObject                           // reuse existing { [name]: ReactiveExpr }
type SlotContent = (props: SlotProps) => TemplateIR
type SlotFns     = { readonly [name: string]: SlotContent }
type ComponentRef = (props: PropsObject, slots: SlotFns) => TemplateIR
 
type ComponentBinding = BaseBinding & {
  kind: 'component'
  component: ComponentRef
  props: readonly PropEntry[]
  propNames: readonly string[]
  slots: readonly SlotEntry[]
}
 
type PropEntry = { name: string; expr: ReactiveExpr }
type SlotEntry = { name: string; content: SlotContent }
```
 
Target node: Comment anchor (same as child/conditional/list). The parent's `shape.html` holds only the anchor; the child's DOM comes from its factory.
 
**Props liveness contract.** Each `PropEntry.expr` is a live thunk. When the child calls `props.count()` inside a reactive tracking context, it registers a direct dependency edge on the parent's signal — no intermediate layer. A parent signal write triggers the child's effect re-run directly.
 
**Ownership contract.** The back-end calls `createRoot` once at mount time. The child factory is called once inside that root. If the parent region is disposed, `onCleanup(() => childDisposer())` bridges the two lifetimes and tears down the child root. This matches the §3.6 `ConditionalBinding` pattern exactly.
 
**Gate:** `ir.ts` MUST NOT be touched until this file (v0.3) is committed. See task A-0 in `docs/superpowers/plans/2026-06-20-component-api.md`.
 
---
 
## 4. Expression Types
 
Expressions are the back-end-parametric part of the IR. The IR defines two
logical expression kinds; implementations are concrete in each back-end.
 
```typescript
/**
 * ReactiveExpr<T>: an expression intended to be called inside an effect's
 * tracking context. Any signal reads performed during the call register
 * dependency edges automatically.
 *
 * Interpreter path: () => T  (a live closure capturing the component scope)
 * Compiler path: ASTExpressionNode (emitted as source code into the generated factory)
 *
 * Both forms must be observationally equivalent: the same signals are read,
 * the same value is returned.
 */
type ReactiveExpr<T = unknown> = () => T;  // live form
 
/**
 * HandlerExpr: an expression that returns the current event handler function.
 * May itself be reactive — the EventBinding's effect tracks it (§3.4).
 */
type HandlerExpr<E extends Event = Event> = () => (e: E) => void;
```
 
**Back-end-parametric design rationale.** The interpreter calls `ReactiveExpr`
directly inside `effect(() => { ... expr() ... })`. The compiler does not store
or call the live closure — it parses the source AST and emits the expression as
code in the generated factory function. Both back-ends must produce the same
reactive dependency edges and the same DOM mutations for the same signal state.
This is what the differential conformance suite (§8) verifies.
 
**No `derived` in bindings.** No binding kind uses `derived` to produce a DOM
mutation. `derived` is pure and may never write (§8, §11). All DOM-mutation
bindings use `effect`. This is not a limitation — `derived` is still used freely
*inside* `ReactiveExpr` bodies when the template author writes a derived
computation — but the binding plumbing that actually touches the DOM is always an
`effect` owned by the template root.
 
---
 
## 5. Primitive Mapping
 
Summary of how each binding kind maps onto the four nv reactive primitives plus
the imperative setup.
 
| Binding kind     | nv primitive used      | DOM setup        | Notes |
|-----------------|------------------------|------------------|-------|
| `text`          | `effect`               | text node update | 1 effect per binding |
| `attr`          | `effect`               | setAttribute/removeAttribute | 1 effect per binding |
| `prop`          | `effect`               | property assignment | 1 effect per binding |
| `event`         | `effect` (handler only) + imperative | addEventListener once | Listener is not a graph node; effect tracks handler expression reactivity |
| `child`         | `effect`               | text node replace | v0: primitive values only |
| `conditional`   | `effect` + `createRoot` | fragment mount/unmount | 1 effect; branch scopes are explicit roots |
| `list`          | `effect` + `createRoot` per item | keyed reconciliation | designed, deferred |
| `sync`          | `effect` (signal→DOM) + `sync` with external pubsub (DOM→signal) | 1 each | designed, deferred; pubsub per binding |
 
**No `sync` in non-SyncBinding bindings.** The `sync` primitive is intentionally
absent from text/attr/prop/child/conditional bindings. These are all
*signal-reads-into-DOM*, never reactive→signal writes, so `effect` is correct and
sufficient. `sync` is only appropriate for the DOM→signal write-back direction in
`SyncBinding`.
 
**No `derived` in any binding plumbing.** Template expressions can internally use
`derived` values — that is the author's concern, not the binding machinery's. The
binding machinery itself is always `effect` (with `createRoot` for lifetime
scoping).
 
---
 
## 6. Invariants
 
### 6.1 Front-end equivalence
 
**Invariant FE:** For any two templates that are semantically equivalent (same
binding structure, same expression semantics), the `.nv` file front-end and the
tagged-template front-end MUST produce `TemplateIR` instances that are
structurally identical and observationally equivalent.
 
Concretely:
- `shape.html` is identical (same static HTML, same `<!--nv-->` sentinel
  positions, same `bindingPaths`).
- `bindings` array is identical in length and binding kinds.
- Each `ReactiveExpr` in a binding from either front-end, evaluated with the same
  reactive state, produces the same value and reads the same signals.
- `meta` (source spans, front-end label) does NOT affect structural equality.
The delimiter difference (`{}` in `.nv`, `${}` in tagged template) is a front-end
lexing detail and MUST be erased before producing the IR.

**Outlet detection (v0.3.2/v0.3.3 note).** The two front-ends detect slot outlets via different
mechanisms but produce identical `SlotOutletBinding` nodes. The `.nv` front-end detects
a `slots.name` `PropertyAccessExpression` in the AST (or `slots.x ?? html\`...\`` for an
outlet with fallback). The tagged-template front-end detects a `slots('name', opts?)` sentinel
object (`{ __nvSlotOutlet: string, __nvFallback?: TemplateIR }`) by structural property check —
immune to minification. Both paths produce `{ kind: 'slot-outlet', pathIndex, name, fallback? }`.
 
**How to verify.** The differential conformance suite (§8) covers this
implicitly: both back-ends are tested against the same corpus, and the corpus
templates are designed to exercise both front-end paths.
 
### 6.2 Back-end equivalence
 
**Invariant BE:** The runtime interpreter and the compiler, when given the same
`TemplateIR` and the same reactive state, MUST produce:
 
1. Structurally identical initial DOM output (per the §8.3 structural comparator: node type, tag, attributes-as-a-set, text content, children recursively).
2. Identical reactive mutations: given the same signal write, both back-ends
   produce the same DOM changes.
3. Identical disposal: after the root owner is disposed, both back-ends leave no
   reactive edge leaks (the no-leak check from §12.6 of the contract conformance
   suite applies).
**Framing for correctness.** The compiler is conceptually the interpreter
partially evaluated over the static parts. The interpreter's `effect` closures are
the semantic ground truth; the compiler emits equivalent imperative code that
establishes the same effects with the same DOM targets. This framing is what keeps
the two back-ends semantically welded by construction: any deviation in the
compiler is a deviation from the interpreter's semantics, not from an independent
specification.
 
**Mechanical enforcement.** The differential conformance suite (§8).
 
### 6.3 No-leak after disposal
 
**Invariant DL:** After calling the root disposer returned from `createRoot()` on
a mounted template region:
 
1. All reactive edges from that template's effects to their signal sources are
   removed.
2. All DOM nodes owned by that region are removed from the parent.
3. No event listeners registered by `EventBinding` remain active.
This is the §6 contract's "disposal is total" guarantee (§1.6) applied to the
renderer layer. It is assertable in tests: after disposal, no signal write to a
formerly-observed source triggers a DOM mutation or a recompute counter increment
for that effect.
 
---
 
## 7. Owner/Disposal Mapping (§6 Contract)
 
The §6 contract specifies that the owner tree governs *lifetime* and is decoupled
from the dependency graph and from DOM lifecycle. The renderer maps onto this as
follows.
 
### 7.1 Each mounted region = one `createRoot` scope
 
When a `TemplateIR` is instantiated and mounted, the renderer calls:
 
```typescript
const disposer = createRoot((dispose) => {
  // 1. Clone the static shape
  const root = cloneShape(ir.shape);           // one cloneNode(true)
 
  // 2. Walk paths, locate binding targets
  const targets = ir.shape.bindingPaths.map(p => walkPath(root, p));
 
  // 3. Instantiate each binding — effects are created here, owned by this root
  for (let i = 0; i < ir.bindings.length; i++) {
    instantiateBinding(ir.bindings[i], targets[i]);
  }
 
  // 4. Mount the static DOM
  parent.appendChild(root);
  onCleanup(() => root.remove());  // removes DOM on disposal
 
  return dispose;
});
```
 
All `effect` calls inside `instantiateBinding` create nodes **owned by the current
root owner** (the `createRoot` scope). Nested `ConditionalBinding` branches get
their own `createRoot` scopes (§3.6) — child roots whose lifetime is managed by
the parent effect.
 
### 7.2 Disposal tears down both graph and DOM
 
Calling `disposer()`:
1. Runs `onCleanup(() => root.remove())` — the static DOM fragment is removed.
2. Disposes all owned children (the per-binding `effect` nodes) — severs all
   reactive source edges.
3. Recursively disposes nested `ConditionalBinding` or `ListBinding` roots via the
   `onCleanup` hooks registered in §3.6 / §3.7.
The dependency graph teardown is the runtime's job (§6). The DOM cleanup is the
renderer's job, via `onCleanup`. The two are orthogonal — the runtime does not
need to know about DOM nodes.
 
### 7.3 Lifecycle is not DOM-attachment-bound
 
Per §6: the owner tree must not be tied to `connectedCallback`/
`disconnectedCallback`, because those fire on DOM moves, not just teardown.
The renderer's disposal policy is: **call the disposer when the logical lifetime
of the mounted region ends** — which is a caller decision (parent component
unmount, route change, explicit destroy call), not a DOM event. The `createRoot`
scope expresses this cleanly: the caller holds the disposer and calls it when the
region should be torn down.
 
---
 
## 8. Differential Conformance Suite
 
This suite is the mechanical safety net that keeps the two back-ends from drifting.
It must be designed alongside the IR, not added later.
 
### 8.1 Purpose
 
For each template in the corpus: run it through both the interpreter back-end and
the compiler back-end, assert identical observable behavior. A test failure is a
back-end drift bug, caught before it ships.
 
### 8.2 Corpus (minimum for PoC)
 
Each corpus entry is a `TemplateIR` instance (or a factory that produces one)
paired with a test scenario.
 
| ID  | Template description | Binding kinds exercised | Reactive scenario |
|-----|---------------------|------------------------|-------------------|
| TC-01 | `<span>{count}</span>` | TextBinding | write count → assert textContent |
| TC-02 | `<div class="{cls}">{label}</div>` | TextBinding, AttrBinding | write cls, write label → assert attribute, textContent |
| TC-03 | `<input prop:value="{v}" />` | PropBinding | write v → assert el.value |
| TC-04 | `<button on:click={handler}>+</button>` | EventBinding | click → handler called; dispose → no handler |
| TC-05 | `{#if show}<p>visible</p>{/if}` | ConditionalBinding (no else) | write show true/false → assert DOM presence |
| TC-06 | `{#if cond}<A/>{:else}<B/>{/if}` | ConditionalBinding with alternate | toggle cond → assert branch swap, no leak |
| TC-07 | disposal | any | mount, write, dispose, write again → no DOM mutation, no leak |
| TC-08 | nested structure | TextBinding inside ConditionalBinding | show child, write inner signal → assert update; hide → assert removal |
| TC-09 | ChildBinding with non-primitive value (e.g. a DOM Node) | ChildBinding | v0 rejects identically in both back-ends: assert the error/rejection is the same message/type in interpreter and compiler |
 
### 8.3 Per-test structure
 
For each corpus entry `T`:
 
```
1. Instantiate T via interpreter back-end   → (domI, disposerI, signalsI)
2. Instantiate T via compiler back-end      → (domC, disposerC, signalsC)
 
3. Assert static equivalence:
   structurallyEqual(domI, domC)
   // Structural comparison: node type, tag name, attributes-as-a-set (order-
   // independent), text content, children recursively. NOT outerHTML string
   // equality — outerHTML produces false failures (attribute order, whitespace,
   // boolean-attribute serialization differ across implementations) and false
   // passes (structurally-different trees can serialize identically). A brittle
   // suite either gets ignored (false failures) or leaks drift through (false
   // passes); neither is acceptable for the component whose sole job is proving
   // equivalence.
 
4. For each reactive scenario R in T's scenarios:
   a. Apply the same signal writes to signalsI and signalsC
   b. Flush effects (scheduler.flush() or microtask drain)
   c. Assert structurallyEqual(domI, domC)
 
5. Assert disposal no-leak:
   disposerI(); disposerC();
   Apply the writes from scenario R again.
   Assert domI did not change (effect is dead).
   Assert domC did not change (effect is dead).
   Assert all effect nodes from T's instantiation have empty sources lists.
   (Uses the __test instrumentation surface from the runtime conformance suite.)
 
6. Assert DOM cleanup:
   Assert domI.parentNode === null (was removed from parent).
   Assert domC.parentNode === null.
```
 
### 8.4 The jsdom boundary
 
Both back-ends run against a `jsdom` (or `happy-dom`) DOM in the sandbox. This
is sufficient for:
- Structural DOM equivalence (via the structural comparator described in §8.3)
- Reactive edge presence/absence (via `__test` APIs)
- Event listener registration/removal (synthetic dispatch)
- No-leak assertion
It is **not** sufficient for:
- Real custom-element lifecycle (`connectedCallback` timing)
- Real browser layout or paint behavior
- Performance numbers
Real-DOM behavior is a Claude Code task, not a sandbox task. The compiler back-end
itself (IR → emitted code) is also a Claude Code task — the sandbox proves the IR
semantics are correct via the interpreter first.
 
### 8.5 Seam with the compiler stream
 
The compiler back-end (IR → emitted direct-DOM code) is a seam with the compiler
stream. It should not be built until:
 
1. This IR is architect-reviewed and approved.
2. The interpreter back-end passes the differential suite against a jsdom.
3. The compiler stream's codegen target is agreed upon.
The differential suite is the contract that tells the compiler stream what the
emitted code must do. Flag this seam; do not cross it prematurely.
 
---
 
## 9. Scope Discipline
 
### 9.1 PoC scope (build this first)
 
- `TemplateShape` (static HTML + binding paths)
- `TextBinding`, `AttrBinding`, `PropBinding`, `EventBinding`, `ChildBinding`
  (primitive values only), `ConditionalBinding`
- The tagged-template front-end (tagged `html` function → `TemplateIR`)
- The runtime interpreter back-end (IR → jsdom DOM + live bindings)
- The differential conformance suite (corpus TC-01 through TC-09)
### 9.2 Designed, deferred (do not build yet; design is here)
 
- `ListBinding` (§3.7) — keyed list reconciliation
- `SyncBinding` (§3.8) — two-way binding via `sync` + external pubsub
- `ChildBinding` values that return DOM nodes or `TemplateIR` (component holes)
- The `.nv` file front-end (parse `.nv` files to `TemplateIR`)
- The compiler back-end (IR → emitted code) — pending interpreter proof + seam agreement
### 9.3 Out of scope for IR v0 (not designed here)
 
- `ComponentBinding` — a template hole for child component invocations. Component
  composition requires a component API (props, slots, component identity), which
  is not yet specified. This is the next design gate after the IR is approved.
- SSR / hydration — renderer concern, not part of the IR contract; the IR does not
  know about serialization or server context.
- Shadow DOM / style scoping — out of contract scope (§0); the IR emits into Light
  DOM by default; Shadow DOM is an opt-in that wraps the mount point.
- `store` integration — the `store` proxy primitive (open design per §13) produces
  `signal`/`derived` edges that the IR expressions can read normally; no IR change
  needed.
---
 
## 10. Architect Review — Closed (2026-06-17)
 
Arch review approved the design in substance. Four fold-ins were required before
closing; all have been applied in this v0.2. The binding set, static/dynamic
split, NodePath model, disposal mapping, front-end equivalence invariant, and
"compiler = interpreter partially evaluated" framing are confirmed as written.
 
**Q1 — Binding-form completeness.** Confirmed: the six-binding PoC set is the
correct minimal set. Deferring `SyncBinding` does not block the PoC.
 
**Q2 — ChildBinding v0 scope.** Primitive-only confirmed for v0. Mitigation:
TC-09 added to the differential corpus — asserts that a node-valued `ChildBinding`
fails loudly and identically in both back-ends in v0. When `ChildBinding`-node
lands, TC-09 flips from "asserts identical rejection" to "asserts identical node
handling," and any divergence is caught at that point.
 
**Q3 — EventBinding handler reactivity.** `handlerKind: 'stable' | 'reactive'`
field added to `EventBinding`. v0 always emits `'reactive'` and always uses the
wrapper-effect. The skip-the-effect optimization for `'stable'` is a performance
hypothesis deferred to benchmark validation in Claude Code (§10 hard rule,
matching the equality-policy inference precedent). Field exists now to prevent an
IR shape change when the optimization is benchmarked.
 
**Q4 — SyncBinding / compiler-stream seam.** `writeTargetId?: SignalId` is the
agreed field (alongside `writeTarget`, populated only on the compiler path). Must
use the same `signalSymbolId` derivation as compiler steps 1–2/4. Recorded in
§3.8; build when `SyncBinding` is scoped.
 
**Q5 — No contract violations.** Confirmed: no binding form requires `derived`
writes or violates `sync` target rules. All PoC DOM-mutation bindings use `effect`.
`sync` is correctly reserved for `SyncBinding`'s DOM→signal direction.
 
---
 
## Appendix: Type Reference (consolidated)
 
```typescript
// ── Paths ──────────────────────────────────────────────────────────────────────
type NodePath = readonly number[];
 
// ── Spans ─────────────────────────────────────────────────────────────────────
type SourceSpan = { file: string; start: number; end: number };
 
// ── Expressions ───────────────────────────────────────────────────────────────
type ReactiveExpr<T = unknown>     = () => T;
type HandlerExpr<E extends Event = Event> = () => (e: E) => void;
 
// ── Shape ─────────────────────────────────────────────────────────────────────
type TemplateShape = {
  html:         string;
  bindingPaths: readonly NodePath[];
};
 
// ── IR root ───────────────────────────────────────────────────────────────────
type TemplateMeta = {
  source?:   SourceSpan;
  frontEnd?: 'nv-file' | 'tagged-template';
};
 
type TemplateIR = {
  id:       string;
  shape:    TemplateShape;
  bindings: readonly Binding[];
  meta?:    TemplateMeta;
};
 
// ── Bindings ──────────────────────────────────────────────────────────────────
type BaseBinding = {
  pathIndex: number;
  meta?:     { source?: SourceSpan };
};
 
type TextBinding = BaseBinding & {
  kind: 'text';
  expr: ReactiveExpr<string | number | boolean | null | undefined>;
};
 
type AttrBinding = BaseBinding & {
  kind: 'attr';
  name: string;
  expr: ReactiveExpr<string | number | boolean | null | undefined>;
};
 
type PropBinding = BaseBinding & {
  kind: 'prop';
  name: string;
  expr: ReactiveExpr<unknown>;
};
 
type EventBinding = BaseBinding & {
  kind:        'event';
  eventName:   string;
  handler:     HandlerExpr;
  handlerKind: 'stable' | 'reactive';  // v0 always emits 'reactive'
  options?:    AddEventListenerOptions;
};
 
type ChildBinding = BaseBinding & {
  kind: 'child';
  expr: ReactiveExpr<string | number | null | undefined>;
  // v0: primitive-only. DOM Node / TemplateIR values: designed, deferred.
};
 
type ConditionalBinding = BaseBinding & {
  kind:       'conditional';
  condition:  ReactiveExpr<boolean>;
  consequent: TemplateIR;
  alternate:  TemplateIR | null;
};
 
type ListBinding = BaseBinding & {  // DESIGNED, DEFERRED
  kind:         'list';
  items:        ReactiveExpr<readonly unknown[]>;
  key:          (item: unknown, index: number) => string | number;
  itemTemplate: TemplateIR;
};
 
type SyncBinding = BaseBinding & {  // DESIGNED, DEFERRED
  kind:           'sync';
  propName:       string;
  readExpr:       ReactiveExpr<unknown>;
  eventName:      string;
  writeTarget:    () => { set: (v: unknown) => void };
  writeTargetId?: SignalId;  // compiler path only; must use same signalSymbolId as steps 1–2/4
  transform?:     (eventValue: unknown, current: unknown) => unknown;
};
 
// ── ComponentBinding (v0.3) ──────────────────────────────────────────────────
type PropsObject  = { readonly [name: string]: ReactiveExpr }
type SlotProps    = PropsObject                           // reuse existing { [name]: ReactiveExpr }
type SlotContent  = (props: SlotProps) => TemplateIR
type SlotFns      = { readonly [name: string]: SlotContent }
type ComponentRef = (props: PropsObject, slots: SlotFns) => TemplateIR
 
type PropEntry = { name: string; expr: ReactiveExpr }
type SlotEntry = { name: string; content: SlotContent }
 
type ComponentBinding = BaseBinding & {
  kind: 'component'
  component: ComponentRef
  props: readonly PropEntry[]
  propNames: readonly string[]
  slots: readonly SlotEntry[]
};
 
// ── SlotOutletBinding (v0.3.1; v0.3.3 adds fallback; v0.4 adds props) ────────
type SlotOutletBinding = BaseBinding & {
  kind:      'slot-outlet';
  name:      string;
  props?:    readonly PropEntry[];   // child-exposed accessor thunks
  fallback?: TemplateIR;
};
 
type Binding =
  | TextBinding | AttrBinding | PropBinding | EventBinding
  | ChildBinding | ConditionalBinding | ListBinding | SyncBinding
  | ComponentBinding
  | SlotOutletBinding;
```