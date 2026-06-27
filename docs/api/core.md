# Core

The fine-grained reactive runtime. DOM-free and framework-agnostic.

```ts
import { signal, derived, effect, sync, pubsub, errorBoundary,
         batch, untrack, createRoot, onCleanup, flushSync } from '@neutro/view/core'
```

---

## Primitives

### `signal`

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

### `derived`

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

### `effect`

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

### `sync`

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

### `pubsub`

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

### `errorBoundary`

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

## Scheduling utilities

### `batch`

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

### `untrack`

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

## Ownership and lifecycle

### `createRoot`

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

### `onCleanup`

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

### `flushSync`

```ts
function flushSync(): void
```

Forces a synchronous flush of all pending effects and syncs. Intended for tests and tight integration scenarios. No-op if a flush is already running.

```ts
signal_a.set(42)
flushSync() // effects see the new value immediately
```

---

## Types

### `SignalAccessor<T>`

```ts
interface SignalAccessor<T> {
  (): T
  set(v: T): void
}
```

The value returned by `signal`. Call it to read; call `.set` to write.

---

### `DerivedAccessor<T>`

```ts
interface DerivedAccessor<T> {
  (): T
}
```

The value returned by `derived`. Read-only — call it to get the current computed value.

---

### `PubSub<T>`

```ts
interface PubSub<T = unknown> extends ExternalSource {
  subscribe(cb: (v: T) => void): () => void
  publish(v: T): void
  clear(): void
}
```

A typed publish/subscribe bus. Extends `ExternalSource`, so it can be used directly as the `source` argument of `sync`.

---

### `ExternalSource`

```ts
interface ExternalSource {
  subscribe(cb: (v: unknown) => void): () => void
}
```

The minimum interface that any external event source must implement to be used with `sync`. Any object with a `subscribe` method that returns an unsubscribe function satisfies this interface.
