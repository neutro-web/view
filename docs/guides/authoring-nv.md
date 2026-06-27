# Authoring .nv Files

A `.nv` file defines a single component using a structured syntax that the `@neutro/view` compiler transforms into efficient reactive code. This guide covers the file format, erasure rules, template syntax, and known limitations.

## File Structure

Every `.nv` file contains one top-level `$component` call that wraps a `$script` block, a `$render` block, and an optional `$style` block.

```js
const MyComponent = $component(() => {
  $script(() => {
    // reactive logic: signals, derived values, effects
  })

  $render(() => html`
    <!-- template markup -->
  `)
})
```

The three blocks serve distinct roles:

- `$script` — declare and wire up reactive state
- `$render` — return the component's HTML template
- `$style` — scoped CSS rules (optional)

## The $script Block

The `$script` block holds all reactive logic. You declare signals, derived values, and effects here. The compiler rewrites this block before execution using a set of erasure rules that let you write natural-looking code instead of explicit `.get()` / `.set()` calls.

### Erasure Rule 1 — Bare-Read Erasure

Any read of a signal or derived variable is automatically rewritten to a function call.

```js
$script(() => {
  const count = signal(0)
  const doubled = derived(() => count * 2)  // count → count()

  effect(() => {
    console.log(count, doubled)              // count → count(), doubled → doubled()
  })
})
```

Bare-read erasure applies everywhere inside `$script` with no function-scope boundary — it crosses into nested arrow functions and callbacks. The mechanism that limits erasure is [Shadowing](#erasure-rule-3--shadowing): if a nested function declares a local variable with the same name as a signal, only reads and writes to that name inside that function are suppressed.

### Erasure Rule 2 — Assignment Erasure

Assigning to a signal variable is rewritten to a `.set()` call.

```js
$script(() => {
  const count = signal(0)

  // simple assignment
  count = 10          // → count.set(10)

  // compound assignment
  count += 1          // → count.set(count() + 1)
  count -= 1          // → count.set(count() - 1)
  count *= 2          // → count.set(count() * 2)
})
```

Assigning to a derived value is a **diagnostic error** — derived values are read-only.

```js
const doubled = derived(() => count * 2)
doubled = 5   // ERROR: cannot assign to a derived value
```

### Erasure Rule 3 — Shadowing

If a nested function declares a local variable with the same name as a signal, the compiler stops erasing reads and writes to that name inside that nested function.

```js
$script(() => {
  const count = signal(0)

  function example() {
    const count = 99     // shadows the outer signal
    console.log(count)   // NOT erased — refers to the local 99
    count = 50           // NOT erased — plain assignment to local variable
  }
})
```

This means shadowing a signal name in a nested scope gives you an ordinary variable inside that scope.

### Erasure Rule 4 — Shorthand Property Limitation

Object literal shorthand properties are **not** bare-read erased. You must write the explicit form.

```js
$script(() => {
  const count = signal(0)

  // WRONG — shorthand is not erased
  const obj = { count }          // count stays as-is, not count()

  // CORRECT — use explicit key: value
  const obj = { count: count() }
})
```

### Erasure Rule 5 — Loop Variable Limitation

Variables declared as `for...of` loop variables are not tracked for shadowing. Reads inside the loop body may be erased even if the loop variable name matches a signal.

```js
$script(() => {
  const items = signal([1, 2, 3])

  for (const item of items) {
    // 'item' is a loop variable — not tracked as a shadow
    // avoid naming loop variables the same as signals
  }
})
```

### Tagged-template: explicit reads and writes

In the tagged template there is no erasure. You write thunks and `.set()` calls explicitly.

```ts
import { createHtmlTag } from '@neutro/view/renderer'
import { signal, derived } from '@neutro/view/core'

const html = createHtmlTag(document)

const count = signal(0)
const doubled = derived(() => count() * 2)

// Reads — must be thunks in holes:
html`<p>${() => count()}</p>`         // ✓ thunk
html`<p>${count()}</p>`               // ✗ throws: value not a function

// Writes — explicit .set() always:
count.set(count() + 1)               // explicit
```

Side-by-side contrast table:

| Construct | .nv (erased) | Tagged template (explicit) |
|-----------|-------------|---------------------------|
| Read signal | `${count}` | `${() => count()}` |
| Write signal | `count = v` | `count.set(v)` |
| Compound write | `count += 1` | `count.set(count() + 1)` |
| Event handler | `@click="${() => count = count + 1}"` | `@click="${() => count.set(count() + 1)}"` |

The runtime enforces the thunk rule — passing a non-thunk, non-sentinel value throws:
```
[nv/html] Expression at hole N is not a function. Wrap reactive values in thunks: ${() => signal()} not ${signal()}.
```

## The $render Block

The `$render` block returns an `html` tagged template literal that defines the component's markup. The compiler recognises several special syntaxes inside the template.

### Text Bindings

Interpolating a signal or derived value in text position creates a reactive text node that updates whenever the value changes.

```js
$render(() => html`
  <p>Count: ${count}</p>
`)
```

`count` is bare-read erased to `count()` and bound as a reactive `TextBinding`.

### Event Handlers

Attach event listeners using `@eventname` attributes. Assignment-form expressions inside handlers are rewritten to `.set()` calls.

```js
$render(() => html`
  <button @click="${() => count = count + 1}">Increment</button>
`)
```

The compiler rewrites `count = count + 1` inside the handler to `count.set(count() + 1)`.

### Tagged-template: event handlers

In the tagged template, event handlers use the same `@click="${...}"` syntax, but the handler body is plain JavaScript with explicit `.set()` calls — there is no assignment-form erasure.

```ts
html`<button @click="${() => count.set(count() + 1)}">Increment</button>`
```

The handler arrow function is passed directly to the runtime as-is. Any reads inside must call the signal as a function; any writes must call `.set()` explicitly.

### Conditional Rendering

Use a ternary expression with `html` branches for conditional rendering. Both branches must be `html` tagged template literals.

```js
$render(() => html`
  ${isLoggedIn
    ? html`<span>Welcome back</span>`
    : html`<a href="/login">Sign in</a>`
  }
`)
```

### List Rendering with `<each>`

Use the `<each>` element to render a keyed list. The `.of` attribute takes the iterable signal; `key` takes a function that returns a stable key for each item.

```js
const TodoList = $component(() => {
  $script(() => {
    const items = signal([
      { id: 1, name: 'Buy milk' },
      { id: 2, name: 'Walk the dog' },
    ])
  })

  $render(() => html`
    <ul>
      <each .of="${items}" key="${(item) => item.id}">
        <li>${item.name}</li>
      </each>
    </ul>
  `)
})
```

The body of `<each>` is the item template. `item` refers to the current element of the list.

#### `<each>` Inside `<tbody>` and `<select>`

When `<each>` appears as a direct child of `<tbody>` or `<select>`, the compiler rewrites it to a `<template data-nv-each>` element so the browser parses the surrounding table or select structure correctly.

```js
$render(() => html`
  <table>
    <tbody>
      <each .of="${rows}" key="${(row) => row.id}">
        <tr><td>${row.label}</td></tr>
      </each>
    </tbody>
  </table>
`)
```

No special action is needed — the rewrite is automatic.

### Reactive Attributes and Props

Bind a reactive expression to any attribute or property using the standard interpolation syntax.

```js
$render(() => html`
  <input type="text" value="${inputValue}" placeholder="${placeholder}" />
`)
```

### Classlist Binding

Pass an object to `class` where the keys are class names and the values are reactive booleans. A class is applied when its value is truthy.

```js
$render(() => html`
  <div class="${{ active: isActive, disabled: isDisabled }}">
    content
  </div>
`)
```

## The $style Block

Add a `$style` block inside `$component` to write scoped CSS. Styles defined here apply only to this component's rendered output.

```js
const MyComponent = $component(() => {
  $script(() => { /* ... */ })
  $render(() => html`<!-- ... -->`)

  $style(() => ({
    // key-form: class name scoped with a hash suffix
    card: {
      background: 'white',
      borderRadius: '8px',
      padding: '16px',
    },

    // selector-form: attribute selector injected for scoping
    'button': {
      cursor: 'pointer',
    },
  }))
})
```

There are two forms:

- **Key-form** (`card: { ... }`) — the class name is rewritten to `card_<hash>` where `<hash>` is unique per component. Use this for class-based styling.
- **Selector-form** (`button { ... }`) — a `[data-nv-s-<hash>]` attribute selector is prepended, scoping the rule to this component's DOM.

## TypeScript Usage

When importing a `.nv` file directly in a `.ts` file, add `// @ts-nocheck` at the top of that file. The compiler output is not yet typed in a way that satisfies the TypeScript checker.

```ts
// @ts-nocheck
import { MyComponent } from './MyComponent.nv'
```

## Known Limitations at v0.1.0

The following limitations apply to the current release. They are tracked for resolution in future versions.

| Limitation | Workaround |
|---|---|
| Shorthand property names `{ count }` not erased | Use `{ count: count() }` |
| Compound assignments beyond `op=` forms not detected | Use explicit `.set()` for complex mutations |
| `for...of` loop variables not tracked for shadowing | Avoid naming loop variables after signals |
| No `<when>` directive for conditional blocks | Use ternary with `html` branches |
| No async primitive | Wrap async work in effects manually |
| No cross-component store | Pass signals as props or use module-level signals |
| `// @ts-nocheck` required in `.ts` importers | Planned for v0.5.0 |

## Related Guides

- [Reactivity](/guides/reactivity) — signal, derived, and effect semantics
- [Rendering](/guides/rendering) — each, conditionals, classlist, and $style in depth
- [API Reference](/api/) — mount and exported functions
- [Getting Started](/getting-started) — project setup
