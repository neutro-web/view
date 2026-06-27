# Reactivity

@neutro/view uses a fine-grained reactive system built around signals, derived values, and effects. This page covers every runtime primitive and the ownership model that ties them together.

For formal semantics see [Reactive Core Contract](../reactive-core-contract.md). For the `.nv` template layer (where signal reads are erased to calls at compile time) see [Authoring .nv](./authoring-nv.md). For full type signatures see [API Reference](./api-reference.md).

---

## Signals

A signal is a readable, writable reactive value. Reading it inside a reactive context (a derived or an effect) registers a dependency.

```typescript
import { signal } from '@neutro/view'

const count = signal(0)

count()        // read — returns 0
count.set(1)   // write — schedules any dependent effects
count()        // returns 1
```

### Custom equality

By default two values are compared with `Object.is`. Pass `equals` to override, or pass `false` to treat every write as a change regardless of value.

```typescript
const point = signal({ x: 0, y: 0 }, {
  equals: (a, b) => a.x === b.x && a.y === b.y,
})

// Setting the same coordinates will not trigger dependents.
point.set({ x: 0, y: 0 })
```

---

## Derived

A derived value memoizes a computation that depends on one or more signals (or other derived values). It is **lazy**: the computation does not run until the value is first read, and it does not recompute again until a dependency changes and the value is read again.

```typescript
import { signal, derived } from '@neutro/view'

const count  = signal(2)
const double = derived(() => count() * 2)

double()  // 4 — runs the computation now
double()  // 4 — returned from memo, no recomputation
count.set(3)
double()  // 6 — dependency changed, recomputes on next read
```

The reactive graph uses three-state coloring (CLEAN, CHECK, DIRTY). A dependency change marks downstream nodes CHECK; a node becomes DIRTY only when the path from a changed signal reaches it. Only DIRTY nodes recompute.

### Custom equality on derived

Derived also accepts `equals`, letting you suppress downstream propagation when the new computed value is semantically equivalent to the old one.

```typescript
const ids = signal([1, 2, 3])
const first = derived(() => ids()[0], {
  equals: (a, b) => a === b,
})
```

---

## Effect

An effect runs a side-effectful function and re-runs it whenever its reactive dependencies change. It returns a dispose function that tears down the effect and its cleanups.

```typescript
import { signal, effect } from '@neutro/view'

const name = signal('Ada')

const dispose = effect(() => {
  console.log('name is', name())
})
// logs: "name is Ada"

name.set('Grace')
// logs (on next microtask): "name is Grace"

dispose()
// the effect is dead; no further logging
```

Effects are **microtask-scheduled**: after a signal write, pending effects run in the next microtask. To run them immediately use `flushSync()` (see below).

**Components run once.** When a component function executes it sets up signals, derived values, and effects. There is no re-render cycle. The reactive bindings established during that single execution update the DOM directly.

---

## batch

`batch` defers all effect scheduling until the callback returns. Signals updated inside the batch are committed atomically: dependents see only the final state, and effects run once after the batch, not once per write.

```typescript
import { signal, effect, batch } from '@neutro/view'

const x = signal(0)
const y = signal(0)

effect(() => console.log(x(), y()))
// logs: 0 0

batch(() => {
  x.set(1)
  y.set(2)
  // no effects run yet
})
// logs once: 1 2
```

Batches may be nested. Effects are scheduled when the outermost batch returns.

---

## untrack

`untrack` reads signals inside a callback without registering them as dependencies of the enclosing reactive context.

```typescript
import { signal, derived, untrack } from '@neutro/view'

const a = signal(1)
const b = signal(10)

const result = derived(() => {
  const aVal = a()               // dependency tracked
  const bVal = untrack(() => b()) // dependency NOT tracked
  return aVal + bVal
})

result()  // 11
b.set(20)
result()  // still 11 — b is not a tracked dependency
a.set(2)
result()  // 22 — recomputes because a changed
```

`untrack` is useful when you need to read a signal for its current value without making the enclosing computation re-run when that signal changes.

---

## flushSync

`flushSync` runs all pending effects and sync nodes synchronously before returning. Use it in tests, or when you need a guarantee that the DOM reflects the latest signal state before continuing.

```typescript
import { signal, effect, flushSync } from '@neutro/view'

const n = signal(0)

effect(() => console.log(n()))

n.set(42)
// effect has not run yet (still in microtask queue)

flushSync()
// logs: 42
```

Sync nodes drain before effects within a single flush (contract §8.7).

---

## Ownership: createRoot and onCleanup

Every effect and derived created inside a reactive context is owned by that context and disposed when the owner is disposed. `createRoot` creates an explicit owner scope.

```typescript
import { signal, effect, createRoot } from '@neutro/view'

const visible = signal(true)

const dispose = createRoot((dispose) => {
  effect(() => {
    if (visible()) {
      console.log('visible')
    }
  })
  return dispose
})

dispose()
// the effect above is torn down and will never run again
```

### onCleanup

`onCleanup` registers a cleanup function on the current reactive owner (an effect or a `createRoot`). The cleanup runs before the next execution of the owner, or when the owner is disposed.

```typescript
import { signal, effect, onCleanup } from '@neutro/view'

const id = signal('abc')

effect(() => {
  const current = id()
  const timer = setInterval(() => console.log(current), 1000)

  onCleanup(() => clearInterval(timer))
  // When id changes, the old interval is cleared before
  // the effect re-runs and creates a new one.
})
```

`onCleanup` must be called synchronously during the execution of an effect or `createRoot` callback. It has no effect when called outside a reactive owner.

---

## sync

`sync` binds a source to a target signal, running a compute function to transform the incoming value. It returns a dispose function. Two source forms are supported.

### Reactive source

When the source is a function, `sync` tracks it as a reactive computation. The target signal is updated whenever the source value changes.

```typescript
import { signal, sync } from '@neutro/view'

const celsius = signal(0)
const fahrenheit = signal(32)

const dispose = sync(
  () => celsius(),
  fahrenheit,
  (c) => c * 9 / 5 + 32,
)

celsius.set(100)
// fahrenheit() will be 212 after the next flush
```

The two-argument compute form receives both the incoming value and the current target value, which lets you do incremental updates.

```typescript
sync(
  () => newItems(),
  list,
  (incoming, current) => [...current, ...incoming],
)
```

### External source

When the source implements `ExternalSource` (a `subscribe(cb)` method that returns an unsubscribe function), `sync` subscribes to it and pushes updates into the target signal. This is the standard pattern for bridging DOM events, WebSockets, or any push-based source into the reactive graph.

```typescript
import { signal, sync } from '@neutro/view'

const inputEl = document.querySelector('input')!
const value = signal(inputEl.value)

const dispose = sync(
  {
    subscribe(cb) {
      const handler = (e: Event) =>
        cb((e.target as HTMLInputElement).value)
      inputEl.addEventListener('input', handler)
      return () => inputEl.removeEventListener('input', handler)
    },
  },
  value,
  (v: string) => v,
)
```

`sync` nodes run before effects in the same flush, so target signals updated by `sync` are already at their new values when effects execute.

### Feedback loops

Writing back to a signal that is in the source path of the same `sync` creates a feedback loop. The write-graph cycle checker detects this at build time and reports it as an error.

---

## pubsub

`pubsub` returns a `PubSub` channel that implements `ExternalSource`. It is usable directly as the `source` argument to `sync`.

```typescript
import { signal, pubsub, sync } from '@neutro/view'

const channel = pubsub<string>()
const latest  = signal('')

const dispose = sync(channel, latest, (v) => v)

channel.subscribe((msg) => console.log('received', msg))
```

---

## errorBoundary

`errorBoundary` wraps a reactive subtree so that errors thrown during computation are caught by a handler rather than propagating up.

```typescript
import { signal, derived, errorBoundary } from '@neutro/view'

errorBoundary(
  (err) => console.error('reactive error:', err),
  () => {
    const data = derived(() => riskyComputation())
    effect(() => console.log(data()))
  },
)
```

The handler receives the thrown value. Errors thrown in effects and derived computations that occur inside the boundary are routed to the handler; errors outside the boundary propagate normally.

---

## Dependency tracking rules

- Reading a signal or derived inside a `derived` or `effect` callback registers it as a dependency of that computation.
- Reads inside `untrack` are not tracked.
- Reads outside any reactive context (at module top level, in a plain function call) are not tracked and have no reactive effect.
- In `.nv` files, bare identifiers that refer to signals are erased to calls (`count` becomes `count()`) by the compiler. This is a compile-time transform; the runtime behavior is identical to calling the accessor manually. See [Authoring .nv](./authoring-nv.md).

---

## Quick reference

| Primitive | Purpose |
|---|---|
| `signal(v)` | Readable/writable reactive value |
| `derived(fn)` | Lazy memoized computation |
| `effect(fn)` | Scheduled side effect with automatic cleanup |
| `batch(fn)` | Defer effect scheduling across multiple writes |
| `untrack(fn)` | Read signals without tracking |
| `flushSync()` | Run pending effects synchronously |
| `createRoot(fn)` | Explicit ownership scope |
| `onCleanup(fn)` | Register cleanup on current owner |
| `sync(src, target, fn)` | Bind reactive or external source to a signal |
| `pubsub()` | Push-based channel, usable as an external source |
| `errorBoundary(handler, fn)` | Catch errors in a reactive subtree |
