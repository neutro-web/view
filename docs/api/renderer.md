# Renderer

Turns a Template IR into live DOM with fine-grained bindings.

```ts
import { mount, createHtmlTag, slots, slot, each, cx, classes } from '@neutro/view/renderer'
```

---

## The thunk rule

> Every reactive expression in a tagged-template hole must be a thunk: `${() => signal()}` not `${signal()}`. The runtime throws on violation:
> `[nv/html] Expression at hole N is not a function. Wrap reactive values in thunks: ${() => signal()} not ${signal()}.`
> Sentinel values (`each()`, `classes()`, `slot()`, `slots()`) are not thunks and are passed directly.

In `.nv` files the compiler handles this automatically via bare-read erasure. See [Authoring .nv](/guides/authoring-nv).

---

## `mount`

```ts
function mount(ir: TemplateIR, parent: Element, doc: Document): () => void
```

Instantiates a `TemplateIR` into `parent` using `doc` for DOM operations. Returns a disposal function that removes the mounted nodes and disposes all reactive effects.

Effects do not run synchronously during `mount`; call `flushSync()` after mounting if you need the initial DOM to be fully updated before the next line.

```ts
const html = createHtmlTag(document)
const ir = html`<p>${() => message()}</p>`

const dispose = mount(ir, document.body, document)
flushSync()

// later:
dispose()
```

`mount` is exported from both `@neutro/view/renderer` and `@neutro/view/renderer/runtime`.

---

## `createHtmlTag`

```ts
function createHtmlTag(document: Document): (
  strings: TemplateStringsArray,
  ...exprs: unknown[]
) => TemplateIR
```

Returns an `html` tagged template function bound to `document`. Use the returned function to parse template literals into `TemplateIR` objects that can be passed to `mount`.

All expression holes must be thunks (`() => value`) or one of the sentinel helpers (`slots`, `slot`, `each`, `classes`). Passing a raw non-function value throws at template construction time.

```ts
const html = createHtmlTag(document)
const ir = html`<span class="${() => cls()}">${() => count()}</span>`
```

---

## `slots`

```ts
function slots(
  name: string,
  opts?: { fallback?: TemplateIR; [propName: string]: (() => unknown) | TemplateIR | undefined },
): SlotSentinel
```

Slot outlet — declares where parent-provided content renders inside the child component. Write `${slots('name')}` at the position where content should appear. Mirrors `.nv`'s `{slots.name}` bare read.

An optional `fallback` TemplateIR renders when the slot is absent. Additional function-valued keys in `opts` become scoped slot props.

```ts
${slots('header')}
${slots('body', { fallback: defaultIR })}
```

---

## `slot`

```ts
function slot(name: string, factory: (props: unknown) => TemplateIR): SlotFillSentinel
```

Slot fill — the parent provides content for a named slot. The factory receives the child-exposed slot props and returns the slot content IR. Mirrors `.nv`'s `<slot name="row" let={item, index}>...</slot>`.

```ts
${slot('row', ({ item }) => html`<tr><td>${() => item().name}</td></tr>`)}
```

---

## `each`

```ts
function each(
  items: () => readonly unknown[],
  key: (item: unknown, i: number) => string | number,
  factory: (props: unknown) => TemplateIR,
): EachSentinel
```

Keyed list sentinel. Pass directly in a content hole — do not wrap in a thunk. The factory receives `{ item, index }` where both are signal thunks — call `item()` to read the current value, `index()` for the position.

```ts
${each(
  () => todos(),
  (item) => (item as Todo).id,
  ({ item }) => html`<li>${() => (item() as Todo).text}</li>`,
)}
```

---

## `cx`

```ts
function cx(...args: Array<
  string | Record<string, unknown> | CxArg[] | null | undefined | false | 0
>): string
```

Pure class-string builder. Concatenates truthy tokens, space-joined. Intended for one-off class construction outside of reactive bindings; for reactive class toggling inside templates, use `classes`.

- String args: included if non-empty.
- Object args: each key is included if the corresponding value is truthy.
- Array args: recursively processed.
- Falsy args (`null`, `undefined`, `false`, `0`, `''`): skipped.

```ts
cx('btn', { primary: true, disabled: false }) // 'btn primary'
cx('a', ['b', { c: true }])                   // 'a b c'
cx({ active: true }, null, false)              // 'active'
```

---

## `classes`

```ts
function classes(
  ...args: Array<
    | string
    | Record<string, () => unknown>
    | Array<string | Record<string, () => unknown>>
    | null
    | undefined
    | false
  >
): ClassesSentinel
```

Builds a `ClassesSentinel` for use in a `class="${...}"` hole. Unlike `cx`, the object values must be reactive thunks (`() => boolean`) — the renderer subscribes to them individually so only changed classes update the DOM.

- String args: split on whitespace, each token becomes a static entry.
- Object args: each key becomes a toggle entry; the value must be `() => boolean`.
- Array args: recursively processed.
- Falsy args: skipped.

```ts
const ir = html`<button class="${classes('btn', { active: () => isActive() })}">`
```

---

## IR types

These types define the shape of a compiled template. They are consumed by the interpreter and emitter; most application code does not need to reference them directly.

| Type | Description |
|---|---|
| `TemplateIR` | Top-level compiled template object: `id`, `shape`, `bindings`, optional `meta`. |
| `TemplateShape` | Static HTML string + array of node paths used to locate binding targets. |
| `TemplateMeta` | Optional diagnostic metadata (source span, front-end kind). |
| `NodePath` | `number[]` — child-index path from the template root to a binding target node. |
| `SourceSpan` | Start/end character positions in the original source file. |
| `Binding` | Union of all binding kinds (discriminated on `kind`). |
| `BaseBinding` | Common fields shared by all bindings: `kind`, `pathIndex`. |
| `TextBinding` | Reactive text content: `kind: 'text'`, `expr`. |
| `AttrBinding` | Reactive HTML attribute: `kind: 'attr'`, `name`, `expr`. |
| `PropBinding` | DOM property assignment: `kind: 'prop'`, `name`, `expr`. |
| `EventBinding` | Event listener: `kind: 'event'`, `eventName`, `handler`, `handlerKind`. |
| `ChildBinding` | Static child template insertion: `kind: 'child'`. |
| `ConditionalBinding` | `if`/`else` branch: `kind: 'conditional'`, `condition`, `consequent`, `alternate`. |
| `ListBinding` | Keyed list reconciler: `kind: 'list'`, `items`, `key`, `itemTemplate`. |
| `SyncBinding` | Two-way form binding: `kind: 'sync'`, `propName`, `readExpr`, `eventName`, `writeTarget`. |
| `ClassListBinding` | Structured class toggling: `kind: 'classlist'`, `entries`. |
| `ClassListEntry` | One entry in a `ClassListBinding`: `kind: 'static' \| 'toggle'`. |
| `ReactiveExpr` | A thunk: `() => T`. The standard expression type in bindings. |
| `HandlerExpr` | Event handler: `() => (e: Event) => void` or similar. |

See the [Template IR source](https://github.com/neutro-web/view/blob/main/docs/template-ir.md) for full shape documentation.

---

## Sentinel types

Opaque types returned by the tagged-template helpers. You rarely need to reference these directly, but they appear in type signatures.

| Type | Returned by |
|---|---|
| `SlotSentinel` | `slots()` |
| `SlotFillSentinel` | `slot()` |
| `EachSentinel` | `each()` |
| `ClassesSentinel` | `classes()` |

Inline shapes:

```ts
interface EachSentinel {
  readonly __nvEach: true
  readonly items: () => readonly unknown[]
  readonly key: (item: unknown, i: number) => string | number
  readonly factory: (props: unknown) => TemplateIR
}

interface ClassesSentinel {
  readonly __nvClasses: true
  readonly entries: ReadonlyArray<
    { kind: 'static'; token: string } | { kind: 'toggle'; key: string; expr: () => unknown }
  >
}

interface SlotSentinel {
  readonly __nvSlotOutlet: string
  readonly __nvFallback?: TemplateIR
  readonly __nvProps?: readonly PropEntry[]
}

interface SlotFillSentinel {
  readonly __nvSlotFill: string
  readonly factory: (props: unknown) => TemplateIR
}
```

---

## Compiler-facing exports

These are exported from `@neutro/view/renderer` for tooling authors building on top of the nv compiler pipeline. Application code does not import them directly.

| Export | Description |
|---|---|
| `parseNvFile` | Parse a `.nv` source file into a `NvComponentResult` (AST + diagnostics). |
| `parseNvFileForEmit` | Parse a `.nv` file and produce an `NvEmitPayload` ready for code generation. |
| `preprocessMutationWrites` | Rewrite mutation-style assignment expressions to `.set()` calls before TS compilation. |

Associated types: `NvComponentResult`, `NvDiagnostic`, `NvEmitPayload`, `NvStyleInfo`, `ThunkSource`.

---

## `structurallyEqual`

```ts
// from @neutro/view/renderer
import { structurallyEqual } from '@neutro/view/renderer'
```

DOM-tree diff utility used internally by the renderer test suite. Compares two `Node` trees and returns `{ equal: boolean, diffPath: string }`. This is **not** a signal equality predicate — it cannot be passed to `signal(v, { equals: ... })` and is not intended for application use.
