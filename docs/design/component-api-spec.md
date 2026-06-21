# Component API — Specification v1

> **Status:** Approved — arch review closed 2026-06-20.
> **Context anchor:** This file is the authoritative spec. Between sessions, read this file first.

---

## §0 Design Goals and Constraints

**D1 — Props are live read-only accessor thunks.**  
Each prop is delivered to the child as `() => value` — a zero-arg function that, when called inside a reactive tracking context, registers a dependency on the parent's signal. The child never holds a raw value; it always reads through the thunk. This is the only form that preserves fine-grained reactivity across component boundaries without a compiler transformation that special-cases props.

**D2 — No two-way binding in v1.**  
Props flow parent→child only. The child has no mechanism to write back to the parent through the prop channel. (Two-way binding, if added, is a separate `SyncBinding` concern already designed and deferred in the IR spec §3.8.)

**D3 — Props destructuring is an erasure concern, not a runtime concern.**  
When a child author writes `const { count } = props` in a `$script` block, this is syntactic sugar. The compiler (nv-parser) must erase the destructuring and replace reads of `count` with `props.count()` — so the compiled output reads through the live accessor. This erasure happens at parse/emit time; the IR and back-ends never see the destructuring — they see `PropEntry` objects with `expr: () => props.count()`.

**D4 — Factory signature change is additive.**  
Every component factory changes from `Name()` to `Name(props, slots)`. This is a breaking change in the emitter only; the IR change is additive (new `ComponentBinding` kind). Back-ends that do not yet handle `ComponentBinding` will fall through to the exhaustiveness-check error — correct behavior.

---

## §1 Authoring Surface

### §1.1 Declaring a component

In a `.nv` file, a component is declared with `$component`:

```
export const Counter = $component((props) => {
  $script(() => {
    const { count, label } = props
    const doubled = derived(() => count * 2)
  })
  $render(() => html`<span>{label}: {doubled}</span>`)
})
```

Props are received as a `props` parameter. In the `$script` block, props may be destructured (`const { count, label } = props`) — this is erased by the compiler to live accessor reads.

### §1.2 Using a component (nv-parser path)

A capitalized tag in `$render` is a component invocation:

```
$render(() => html`<Counter count={n} label="Hits"/>`)
```

- Reactive prop: `count={n}` → `expr: () => n()` (tracks the signal `n`)
- Static prop: `label="Hits"` → `expr: () => "Hits"` (constant thunk)

### §1.3 Using a component (tagged-template path)

On the tagged-template path, the factory is passed as an expression:

```typescript
html`<${Counter} count=${() => n()} label=${'Hits'}></${Counter}>`
```

The first expression after `<` is the factory reference. Subsequent expressions on the same element are props.

### §1.4 Default slot

Children of a component element become the default slot:

```
$render(() => html`<Card><p>hello</p></Card>`)
```

The slot content is a sub-`TemplateIR` captured at parse time and passed to the child factory as `slots.default`.

### §1.5 Named slots (v1 scope: default only)

v1 supports only the default slot. Named slots are designed-and-deferred.

---

## §2 Front-End Parsing

### §2.1 nv-parser detection

The nv-parser detects a component element by checking whether the tag name begins with an uppercase letter in the DFS walk over the jsdom-parsed sentinel HTML.

When a component element `<Counter .../>` is detected:
1. The element is replaced with a `<!--nv-comp-N-->` comment anchor in the shape HTML.
2. Attribute holes on the element are reclassified as `PropEntry` objects (not `AttrBinding`).
3. Static attribute values become constant-thunk `PropEntry` objects.
4. Child nodes of the element are recursively parsed as the default slot `TemplateIR`.
5. A `ComponentBinding` is pushed onto the bindings array.

### §2.2 html-tag detection

The tagged-template front-end detects a component by the factory-as-first-expression pattern: if `prevString` ends with `<` and the current expression is a function, it is a component factory.

### §2.3 Front-end equivalence invariant (§6.1 of IR spec)

Both front-ends MUST produce structurally identical `ComponentBinding` for equivalent templates:
- `propNames` identical (same order)
- `props` identical in length and `name` fields
- `slots` identical in structure
- `component` factory reference excluded from equivalence check (front-ends differ in how they resolve names)

---

## §3 Compiler Erasure

### §3.1 Props destructuring erasure (Form A — simple)

```
const { count } = props
```

Erased to: remove the declaration; replace all reads of `count` in scope with `props.count()`.

### §3.2 Alias erasure (Form A — aliased)

```
const { count: c } = props
```

Erased to: remove the declaration; replace all reads of `c` in scope with `props.count()`.

### §3.3 Rest erasure (Form B)

```
const { count, ...rest } = props
```

Erased to: remove the declaration; replace `count` reads with `props.count()`; replace `rest.foo` member-access reads with `props.foo()`.

### §3.4 Write diagnostic (Form C)

```
count = 5   // where count was destructured from props
```

Emits error diagnostic: `"Cannot assign to prop 'count': props are read-only."` The erasure walk detects assignments to prop-derived names and emits this diagnostic instead of rewriting.

### §3.5 Nested destructure diagnostic (D1)

```
const { user: { name } } = props
```

Emits error diagnostic: `"Nested prop destructuring is not supported in v1; destructure one level (const { user } = props; user().name)."` The binding element is not erased.

---

## §4 IR Changes

### §4.1 New types

```typescript
type PropsObject = { readonly [name: string]: ReactiveExpr }
type SlotFns     = { readonly [name: string]: TemplateIR }
type ComponentRef = (props: PropsObject, slots: SlotFns) => TemplateIR

type ComponentBinding = BaseBinding & {
  kind: 'component'
  component: ComponentRef
  props: readonly PropEntry[]
  propNames: readonly string[]
  slots: readonly SlotEntry[]
}

type PropEntry = { name: string; expr: ReactiveExpr }
type SlotEntry = { name: string; content: TemplateIR }
```

### §4.2 Binding union extension

`ComponentBinding` is added to the `Binding` union as the ninth member.

### §4.3 Gate

`ir.ts` MUST NOT be touched until `docs/template-ir.md` is bumped to v0.3 and committed (arch gate A-0).

### §4.4 IR discipline

`ComponentBinding` is DOM-free and core-free (per `ir.ts` header discipline). All types are structural and local to `ir.ts`.

### §4.5 Target node

`ComponentBinding` targets a `Comment` anchor (same as `child`, `conditional`, `list`). The parent's `shape.html` holds only the anchor; the child's DOM is inserted before the anchor by the back-end.

---

## §5 Back-End Mount

### §5.1 Interpreter (`wireComponent`)

```typescript
function wireComponent(binding: ComponentBinding, anchorNode: Node, doc: Document): void {
  const parent = anchorNode.parentNode!

  // Build PropsObject: name → accessor thunk
  const propsObj: Record<string, ReactiveExpr> = {}
  for (const p of binding.props) propsObj[p.name] = p.expr

  // Build SlotFns: name → TemplateIR
  const slotsObj: Record<string, TemplateIR> = {}
  for (const s of binding.slots) slotsObj[s.name] = s.content

  // Mount child factory in its own createRoot scope
  const childDisposer = createRoot((dispose) => {
    const childIR = binding.component(propsObj, slotsObj)
    const { roots } = mountFragment(childIR, parent, doc, anchorNode)
    onCleanup(() => { for (const n of roots) n.parentNode?.removeChild(n) })
    return dispose
  })

  onCleanup(() => childDisposer())
}
```

Key properties:
- The child factory is called **once** at mount time (not reactively). The child's own effects are what track signal changes. Props are passed as accessor thunks so the child's effects, when they call `props.count()`, register their own dependency edges directly on the parent's signal.
- The child root is an independent `createRoot` scope. Disposing the parent region triggers `onCleanup(() => childDisposer())`, which propagates disposal to the child.
- No `runWithOwner` needed for static component placement. (Components inside `ListBinding` items inherit the item root by virtue of mounting within `wireList`'s per-item `createRoot`.)

### §5.2 Compiler back-end (`emitSetup` component case)

The compiler back-end mirrors `wireComponent` semantics exactly, capturing `binding.component`, `binding.props`, and `binding.slots` in the wire closure. Slot IRs are processed via `emitSetup(slot.content, emptyVerdicts)` at emit time (same as conditional branches).

Owner-tree shape MUST match the interpreter. TC-C10 (1000-flip no-leak) verifies this.

---

## §6 Invariants

### §6.1 Front-end structural equivalence

Both front-ends MUST produce `ComponentBinding` with identical `propNames`, `props` (names + expr semantics), and `slots` structure for equivalent template inputs. The `component` factory reference is excluded (resolves differently per front-end).

### §6.2 Liveness

Each `PropEntry.expr` is a live thunk. When the child calls `props.count()` inside a reactive tracking context (e.g., inside an `effect` or `derived`), it reads the parent's signal and registers the child's effect as a dependency. A parent signal write triggers the child's effect re-run directly — no intermediate layer.

### §6.3 Props are read-only

The child MUST NOT write to props. The compiler emits a diagnostic for any detected write. The runtime imposes no enforcement beyond the type system (props are thunks, not signals with `.set`).

### §6.4 No-leak

After the parent region is disposed, all child roots must also be disposed. TC-C10 verifies this with a 1000-flip conditional/component combo.

### §6.5 No new exports beyond `mount`

`ComponentBinding`, `PropEntry`, `SlotEntry`, `ComponentRef`, `PropsObject`, `SlotFns` are exported from `ir.ts` for type-checking purposes. No new runtime-surface exports are added to the published `index.ts`.

---

## §7 Emitter

### §7.1 Factory signature change

Every component factory is emitted as:

```typescript
export function Counter(props, slots) {
  // ...
}
```

This is a breaking change for zero-prop components (previously `Counter()`). All factories must use the new signature in v1.

### §7.2 ComponentBinding literal

The emitter emits a `ComponentBinding` literal in the IR factory:

```typescript
{
  kind: 'component',
  pathIndex: 0,
  component: Counter,       // resolved factory reference
  props: [
    { name: 'count', expr: () => (n()) },
  ],
  propNames: ['count'],
  slots: [],
}
```

### §7.3 Cross-file component imports

When a `.nv` file imports from another `.nv` file (`import { Counter } from './counter.nv'`), the esbuild plugin rewrites the specifier to `.js`:

```typescript
emittedSrc.replace(/(from\s+['"])([^'"]+)\.nv(['"])/g, '$1$2.js$3')
```

---

## §8 Differential Test Corpus (TC-C01..C14)

| ID     | Description | Binding/scenario |
|--------|-------------|-----------------|
| TC-C01 | `<Counter count={n}/>` — reactive prop | ComponentBinding; write n → child updates |
| TC-C02 | `<Label label="hi"/>` — static prop | constant thunk; text stays |
| TC-C03 | `<Counter count={a} label={b}/>` — multi-prop | write a → only count effect re-runs |
| TC-C04 | `const { count } = props` — liveness | erased to `props.count()` |
| TC-C05 | `const { count: c } = props` — alias erasure | c reads map to `props.count()` |
| TC-C06 | `const { count, ...rest } = props` — rest member | `rest.label` → `props.label()` |
| TC-C07 | `count = 5` — write diagnostic | Form C diagnostic emitted |
| TC-C08 | Default slot | slot content mounts in child slot position |
| TC-C09 | Component inside conditional | mount/unmount both parent and child |
| TC-C10 | 1000-flip no-leak | component inside conditional, 1000 toggles, no leak |
| TC-C11 | Nested destructure diagnostic | D1 diagnostic for `const { user: { name } } = props` |
| TC-C12 | Component inside list item | per-item child mounts/disposes with item |
| TC-C13 | Static component allocation | single `createRoot` call at mount; no re-invocation of factory |
| TC-C14 | Cross-file import | parent imports child from separate `.nv`; bundled correctly |

Tests run on both front-ends (nv-parser, html-tag) × both back-ends (interpreter, emitted-mount) where applicable.

---

## §9 Session Sequencing

Tasks proceed in the order: A-0 (arch gate) → A-1 (IR) → A-2 (shared analyzer) → B-0 (html-tag parity) → B-1 (both FE detection) → C-1 (interpreter) → C-2 (emitted-mount) → D-1 (emitter) → D-2 (cross-file) → E (full TC-C01..C14).

Each task commits with green tests before the next begins.

---

## §10 Guardrails

- `core.ts` is NEVER touched (standing constraint — reactive-core v0.4.2 unchanged)
- IR stays DOM-free/core-free — all new structural types defined locally in `ir.ts`
- `template-ir.md` v0.3 must be arch-approved BEFORE `ir.ts` is edited
- Both front-ends must produce structurally identical `ComponentBinding` (§6.1)
- `emptyVerdicts` passed to slot/branch `emitSetup` calls (same as conditional branches)
- Owner-tree shape must match interpreter (no-leak gate; TC-C10 1000-flip test)
- Run `pnpm test` and `pnpm typecheck` after every task that touches source
- No new published-surface exports beyond `mount`
- Commit after each task with green tests
