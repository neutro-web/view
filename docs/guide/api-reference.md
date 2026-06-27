# API Reference

This page documents every public export of `@neutro/view`. Every signature here was read directly from source — see [Source files verified](#source-files-verified) at the bottom.

Related reading: [Reactivity guide](./reactivity.md) · [Authoring .nv](./authoring-nv.md)

---

## `@neutro/view/core`

The fine-grained reactive runtime. DOM-free and framework-agnostic.

Import path:

```ts
import { signal, derived, effect, sync, pubsub, errorBoundary,
         batch, untrack, createRoot, onCleanup, flushSync } from '@neutro/view/core'
```

---

### Primitives

#### `signal`

```ts
function signal<T>(
  initial: T,
  opts?: { equals?: ((a: T, b: T) => boolean) | false },
): SignalAccessor<T>
```

Creates a reactive value. Call the returned accessor to read; call `.set(v)` to write.

Pass `equals: false` to always notify observers regardless of value equality. Pass a custom comparator to override the default `Object.is` check.

```ts
const count = signal(0)
count()        // read → 0
count.set(1)   // write
```

---

#### `derived`

```ts
function derived<T>(
  compute: () => T,
  opts?: { equals?: ((a: T, b: T) => boolean) | false },
): DerivedAccessor<T>
```

Creates a lazily-evaluated, cached computation. Re-runs only when its reactive dependencies change. Throws synchronously if `compute` throws (error is cached and re-thrown on subsequent reads until dependencies change).

```ts
const doubled = derived(() => count() * 2)
doubled() // 2
```

---

#### `effect`

```ts
function effect(compute: () => void): () => void
```

Runs `compute` once on the next microtask (microtask-scheduled), then re-runs whenever its reactive dependencies change. Returns a disposal function that stops the effect and severs its dependency edges.

```ts
const stop = effect(() => {
  document.title = `Count: ${count()}`
})
// later:
stop()
```

---

#### `sync`

```ts
function sync<S = unknown, T = unknown>(
  source: (() => S) | ExternalSource,
  target: SignalAccessor<T> | (() => SignalAccessor<T>),
  compute: ((incoming: S) => T) | ((incoming: S, current: T) => T),
): () => void
```

Keeps a signal up to date with a source. `source` may be a reactive thunk (tracked like an effect) or an `ExternalSource` (event emitter / observable). When `compute` accepts two arguments, the second is the current signal value (accumulator / reduce form). Returns a disposal function.

```ts
// Reactive source
sync(
  () => rawInput(),
  trimmed,
  (v) => v.trim(),
)

// External source (e.g. pubsub)
const bus = pubsub<number>()
sync(bus, count, (v) => v)
```

---

#### `pubsub`

```ts
function pubsub<T = unknown>(): PubSub<T>
```

Creates a lightweight publish/subscribe bus. Implements `ExternalSource` so it can be passed directly to `sync`.

```ts
const bus = pubsub<string>()
const unsub = bus.subscribe((v) => console.log(v))
bus.publish('hello')
bus.clear()   // remove all subscribers
unsub()       // remove one subscriber
```

---

#### `errorBoundary`

```ts
function errorBoundary(handler: (e: unknown) => void, fn: () => void): void
```

Establishes an error boundary scope. Reactive errors thrown inside `fn` (or inside effects/derived created within `fn`) are caught and forwarded to `handler` instead of propagating up the owner tree.

```ts
errorBoundary(
  (err) => console.error('caught', err),
  () => {
    effect(() => { /* may throw */ })
  },
)
```

---

### Scheduling utilities

#### `batch`

```ts
function batch(fn: () => void): void
```

Defers all effect and sync flushes until `fn` returns, then runs a single synchronous flush. Batches can be nested; the flush happens when the outermost batch exits.

```ts
batch(() => {
  a.set(1)
  b.set(2)
  // effects see both changes at once
})
```

---

#### `untrack`

```ts
function untrack<T>(fn: () => T): T
```

Reads reactive values inside `fn` without registering them as dependencies of the current observer.

```ts
effect(() => {
  const a = tracked()
  const b = untrack(() => alsoNeeded()) // b changes won't re-trigger this effect
})
```

---

### Ownership and lifecycle

#### `createRoot`

```ts
function createRoot<T>(fn: (dispose: () => void) => T): T
```

Creates an isolated ownership scope. Effects and derived values created inside `fn` are owned by the root and disposed when `dispose()` is called. Use this to create reactive trees that survive beyond the reactive context that created them (e.g. per-list-item trees).

```ts
const dispose = createRoot((d) => {
  effect(() => { /* ... */ })
  return d
})
// later:
dispose()
```

---

#### `onCleanup`

```ts
function onCleanup(fn: () => void): void
```

Registers a cleanup function on the current owner scope. Runs when the scope is disposed or the current effect re-runs. Must be called inside a reactive scope (`createRoot`, `effect`, `sync`); throws otherwise.

```ts
effect(() => {
  const sub = someEvent.subscribe(handler)
  onCleanup(() => sub.unsubscribe())
})
```

---

#### `flushSync`

```ts
function flushSync(): void
```

Forces a synchronous flush of all pending effects and syncs. Intended for tests and tight integration scenarios. No-op if a flush is already running.

```ts
signal_a.set(42)
flushSync() // effects see the new value immediately
```

---

### Types

#### `SignalAccessor<T>`

```ts
interface SignalAccessor<T> {
  (): T
  set(v: T): void
}
```

The value returned by `signal`. Call it to read; call `.set` to write.

---

#### `DerivedAccessor<T>`

```ts
interface DerivedAccessor<T> {
  (): T
}
```

The value returned by `derived`. Read-only — call it to get the current computed value.

---

#### `PubSub<T>`

```ts
interface PubSub<T = unknown> extends ExternalSource {
  subscribe(cb: (v: T) => void): () => void
  publish(v: T): void
  clear(): void
}
```

A typed publish/subscribe bus. Extends `ExternalSource`, so it can be used directly as the `source` argument of `sync`.

---

#### `ExternalSource`

```ts
interface ExternalSource {
  subscribe(cb: (v: unknown) => void): () => void
}
```

The minimum interface that any external event source must implement to be used with `sync`. Any object with a `subscribe` method that returns an unsubscribe function satisfies this interface.

---

## `@neutro/view/renderer`

Turns a Template IR into live DOM with fine-grained bindings.

Import path:

```ts
import { mount, createHtmlTag, slots, slot, each, cx, classes } from '@neutro/view/renderer'
```

---

### `mount`

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

---

### `createHtmlTag`

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

### `slots`

```ts
function slots(
  name: string,
  opts?: { fallback?: TemplateIR; [propName: string]: (() => unknown) | TemplateIR | undefined },
): SlotSentinel
```

Creates a slot outlet sentinel for the tagged-template side. Write `${slots('name')}` at the position in a component hole where the child component should render its named slot. Mirrors `.nv`'s `{slots.name}` bare read.

An optional `fallback` TemplateIR renders when the slot is absent. Additional function-valued keys in `opts` become scoped slot props.

```ts
const ir = html`<MyCard>${slots('header')} ${slots('body', { fallback: defaultIR })}</MyCard>`
```

---

### `slot`

```ts
function slot(name: string, factory: SlotContent): SlotFillSentinel
```

Creates a scoped-slot fill sentinel for the parent side. Write `${slot('row', ({ item, index }) => html`...`)}` inside a component hole. The factory receives the child-exposed slot props and returns the slot content IR. Mirrors `.nv`'s `<slot name="row" let={item, index}>...</slot>`.

```ts
const ir = html`
  <DataTable>
    ${slot('row', ({ item }) => html`<tr><td>${() => item().name}</td></tr>`)}
  </DataTable>
`
```

---

### `each`

```ts
function each(
  items: () => readonly unknown[],
  key: (item: unknown, i: number) => string | number,
  factory: SlotContent,
): EachSentinel
```

Creates a keyed list sentinel for the tagged-template side. Write `${each(() => list(), keyFn, ({ item, index }) => html`...`)}` in a content position. The renderer uses `key` to reconcile items across updates.

```ts
const ir = html`
  <ul>
    ${each(
      () => todos(),
      (item) => (item as Todo).id,
      ({ item }) => html`<li>${() => (item() as Todo).text}</li>`,
    )}
  </ul>
`
```

---

### `cx`

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

### `classes`

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

### IR types

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

### Compiler-facing exports

These are exported from `@neutro/view/renderer` for tooling authors building on top of the nv compiler pipeline. Application code does not import them directly.

| Export | Description |
|---|---|
| `parseNvFile` | Parse a `.nv` source file into a `NvComponentResult` (AST + diagnostics). |
| `parseNvFileForEmit` | Parse a `.nv` file and produce an `NvEmitPayload` ready for code generation. |
| `preprocessMutationWrites` | Rewrite mutation-style assignment expressions to `.set()` calls before TS compilation. |

Associated types: `NvComponentResult`, `NvDiagnostic`, `NvEmitPayload`, `NvStyleInfo`, `ThunkSource`.

---

### Sentinel types

Opaque types returned by the tagged-template helpers. You rarely need to reference these directly, but they appear in type signatures.

| Type | Returned by |
|---|---|
| `SlotSentinel` | `slots()` |
| `SlotFillSentinel` | `slot()` |
| `EachSentinel` | `each()` |
| `ClassesSentinel` | `classes()` |

---

### `structurallyEqual`

```ts
// from @neutro/view/renderer
import { structurallyEqual } from '@neutro/view/renderer'
```

DOM-tree diff utility used internally by the renderer test suite. Compares two `Node` trees and returns `{ equal: boolean, diffPath: string }`. This is **not** a signal equality predicate — it cannot be passed to `signal(v, { equals: ... })` and is not intended for application use.

---

## `@neutro/view/renderer` — tagged-template surface

The functions below are exported from `@neutro/view/renderer` and form the hand-authored tagged-template API. They work alongside the `.nv` compiler pipeline but can be used directly in TypeScript without any compiler plugin.

Import path:

```ts
import { createHtmlTag, mount, each, slots, slot, classes, cx } from '@neutro/view/renderer'
```

---

### The thunk rule

> Every reactive expression in a hole must be a thunk: `${() => signal()}` not `${signal()}`. The runtime throws on violation:
> `[nv/html] Expression at hole N is not a function. Wrap reactive values in thunks: ${() => signal()} not ${signal()}.`
> Sentinel values (`each()`, `classes()`, `slot()`, `slots()`) are not thunks and are passed directly.

---

### `createHtmlTag` (tagged-template)

```ts
function createHtmlTag(document: Document): (strings: TemplateStringsArray, ...exprs: unknown[]) => TemplateIR
```

Bind the `html` tag to a document. The returned tagged template function parses the literal into a `TemplateIR` that can be passed to `mount`.

```ts
const html = createHtmlTag(document)
const ir = html`<p>${() => count()}</p>`
```

---

### `mount` (tagged-template)

```ts
function mount(ir: TemplateIR, parent: Element, doc: Document): () => void
```

Mount a `TemplateIR` into the DOM. Returns a dispose function that removes all mounted nodes and tears down reactive effects.

`mount` is exported from both `@neutro/view/renderer` and `@neutro/view/renderer/runtime`.

```ts
const dispose = mount(ir, document.body, document)
// later:
dispose()
```

---

### `each`

```ts
function each(
  items: () => readonly unknown[],
  key: (item: unknown, i: number) => string | number,
  factory: (props: unknown) => TemplateIR,
): EachSentinel
```

Keyed list sentinel. Pass directly in a content hole — do not wrap in a thunk. The `factory` receives `{ item, index }` — destructure as needed:

```ts
${each(
  () => todos(),
  (item) => (item as Todo).id,
  ({ item }) => html`<li>${() => (item() as Todo).text}</li>`,
)}
```

---

### `slots`

```ts
function slots(name: string, opts?: {
  fallback?: TemplateIR,
  [propName: string]: (() => unknown) | TemplateIR | undefined
}): SlotSentinel
```

Slot outlet — the child component declares where parent-provided content renders. `fallback` renders when the slot is absent. Non-`fallback` function-valued keys in `opts` become scoped slot props.

```ts
${slots('header')}
${slots('body', { fallback: defaultIR })}
```

---

### `slot`

```ts
function slot(name: string, factory: (props: unknown) => TemplateIR): SlotFillSentinel
```

Slot fill — the parent provides content for a named slot. The `factory` receives the child-exposed slot props.

```ts
${slot('row', ({ item }) => html`<tr><td>${() => item().name}</td></tr>`)}
```

---

### `classes`

```ts
function classes(
  ...args: Array<
    | string
    | Record<string, () => unknown>
    | Array<string | Record<string, () => unknown>>
    | null | undefined | false
  >
): ClassesSentinel
```

Reactive class sentinel for use in a `class="${...}"` hole. Values in the object map must be `() => unknown` thunks — they are called reactively when the class list updates.

- String args: split on whitespace, each token becomes a static entry.
- Object args: each key becomes a toggle entry; the value must be `() => boolean`.
- Array args: recursively processed.
- Falsy args: skipped.

```ts
html`<button class="${classes('btn', { active: () => isActive() })}">`
```

---

### `cx`

```ts
function cx(...args: Array<string | Record<string, unknown> | CxArg[] | null | undefined | false | 0>): string
```

A pure string builder — values are plain truthy, evaluated once, not reactive. Use `classes()` for reactive class toggling.

```ts
cx('btn', { primary: true, disabled: false }) // 'btn primary'
```

---

### Sentinel types (tagged-template)

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

## `@neutro/view/renderer/runtime`

```ts
import { mount } from '@neutro/view/renderer/runtime'
```

A slim entry point that exports only `mount` — no parser, no TypeScript compiler. This is what emitted `.nv` bundles import at runtime; pulling it in does not transitively include the TS compiler or nv parser.

The `mount` signature is identical to the one in `@neutro/view/renderer`:

```ts
function mount(ir: TemplateIR, parent: Element, doc: Document): () => void
```

End users do not import from this path directly. It is wired up automatically by the build plugin for emitted bundles.

---

## `@neutro/view/renderer/plugin`

```ts
import { nvPlugin } from '@neutro/view/renderer/plugin'
```

### `nvPlugin`

```ts
function nvPlugin(): Plugin
```

Returns an esbuild plugin that transforms `.nv` single-file components into JavaScript modules. Wire it into your esbuild config:

```ts
import { build } from 'esbuild'
import { nvPlugin } from '@neutro/view/renderer/plugin'

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  plugins: [nvPlugin()],
})
```

The plugin resolves `.nv` imports, compiles each component through the nv parser and emitter, and rewrites the import to the generated JavaScript. Emitted bundles import `mount` from `@neutro/view/renderer/runtime` (not the fat renderer barrel).

---

## Source files verified

The following source files were read to produce this reference. No signature was guessed or inferred from memory.

- `/Users/kofi/_/view/src/core/core.ts` (lines 978–end)
- `/Users/kofi/_/view/src/core/index.ts`
- `/Users/kofi/_/view/src/renderer/index.ts`
- `/Users/kofi/_/view/src/renderer/runtime.ts`
- `/Users/kofi/_/view/src/renderer/interpreter.ts` (mount signature at line 802)
- `/Users/kofi/_/view/src/renderer/html-tag.ts`
- `/Users/kofi/_/view/src/renderer/nv-esbuild-plugin.ts` (nvPlugin signature at line 42)
- `/Users/kofi/_/view/package.json` (exports map)
