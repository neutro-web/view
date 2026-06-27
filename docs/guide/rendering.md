# Rendering

This guide covers the template features that control what appears in the DOM: iterating lists with `<each>`, conditional rendering, event handling, reactive class bindings, and scoped styles with `$style`.

For the underlying signal primitives, see [Reactivity](./reactivity.md). For the `.nv` file format, see [Authoring .nv](./authoring-nv.md).

---

## Lists with `<each>`

Use `<each>` to render a list from a reactive array signal.

```html
<each .of="${items}" key="${(item) => item.id}">
  <li>${item.name}</li>
</each>
```

### Attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `.of` | yes | A reactive array signal. The list re-renders when the signal updates. |
| `key` | yes | A function `(item) => uniqueValue` that identifies each item across renders. |

The body of `<each>` is the item template. Two implicit bindings are available inside the body:

- `item` — the current element of the array
- `index` — the zero-based position (optional; only bind it when needed)

```html
<each .of="${tasks}" key="${(task) => task.id}">
  <li>${index + 1}. ${task.title}</li>
</each>
```

### Keyed reconciliation

When the array signal updates, the renderer compares old and new keys. Items whose keys still exist are moved rather than recreated, preserving any internal DOM state (focus, scroll position, input values). New keys are inserted with `insertBefore`; removed keys are detached from the DOM.

Items that move keep their existing DOM nodes — the renderer relocates them with `insertBefore` rather than destroying and rebuilding. Note: the current implementation calls `insertBefore` unconditionally on every reorder pass, which makes random-swap operations more expensive than sequential appends. This is a known deficit (3.95× vanilla on the swap-rows benchmark) tracked for v0.5.0.

### Table and select contexts

Raw `<each>` inside a `<tbody>` or `<select>` would produce invalid HTML because browsers reject unknown elements in those positions. The parser rewrites `<each>` to a `<template data-nv-each>` element before the browser parses the markup, satisfying the content model while the renderer handles iteration at runtime.

```html
<table>
  <tbody>
    <each .of="${rows}" key="${(row) => row.id}">
      <tr>
        <td>${row.name}</td>
        <td>${row.value}</td>
      </tr>
    </each>
  </tbody>
</table>

<select>
  <each .of="${options}" key="${(opt) => opt.value}">
    <option value="${opt.value}">${opt.label}</option>
  </each>
</select>
```

You do not need to do anything special — the rewrite happens automatically.

### Tagged-template: `each()` function

```ts
import { createHtmlTag, each } from '@neutro/view/renderer'

const html = createHtmlTag(document)

html`
  <ul>
    ${each(
      () => items(),
      (item) => item.id,
      ({ item }) => html`<li>${() => item.name}</li>`
    )}
  </ul>
`
```

**Key differences from `.nv` `<each>`:**
- `.nv` uses the `<each>` element; tagged template uses the `each()` function in a hole
- The items argument is a thunk: `() => items()` (reactive — re-evaluated when the signal changes)
- The factory receives `{ item, index }` via destructuring
- Reactive values inside the factory body must still be thunks: `${() => item.name}` (note: `item` here is a plain value from the factory arg, not a signal — use it directly or wrap if reactive)
- Works inside `<tbody>` and `<select>` natively (no `<template>` rewrite needed — `each()` produces an anchor-based list regardless)

**`<tbody>` example:**
```ts
html`
  <table>
    <tbody>
      ${each(
        () => rows(),
        (row) => row.id,
        ({ item: row }) => html`
          <tr>
            <td>${() => row.name}</td>
            <td>${() => row.value}</td>
          </tr>
        `
      )}
    </tbody>
  </table>
`
```

---

## Conditionals

Use a ternary expression with `html` tagged template literals to conditionally mount elements.

```html
${isLoggedIn ? html`<span>Welcome back</span>` : html`<a href="/login">Sign in</a>`}
```

Both branches must be `html` template literals. When the condition changes, the active branch is mounted and the inactive branch is unmounted from the DOM. Only one branch exists in the DOM at any time.

```javascript
const MyComponent = $component(() => {
  $script(() => {
    const showDetail = signal(false)
  })

  $render(() => html`
    <div>
      <button @click="${() => showDetail = !showDetail}">Toggle</button>
      ${showDetail
        ? html`<section class="detail">...</section>`
        : html`<p>No detail selected.</p>`}
    </div>
  `)
})
```

The condition is re-evaluated reactively — wrap derived conditions in `derived` if they depend on multiple signals.

### Tagged-template: conditional thunk

```ts
// .nv (condition is auto-erased, branches are html`...`):
${isLoggedIn ? html`<span>Welcome</span>` : html`<a>Sign in</a>`}

// Tagged template (whole conditional wrapped in a thunk):
${() => isLoggedIn() ? html`<span>Welcome</span>` : html`<a>Sign in</a>`}
```

The difference: in the tagged template the entire ternary must be wrapped in a thunk because there is no erasure. The branches are the same `html` tagged template literals.

---

## Events

Attach DOM event listeners with the `@eventName` attribute syntax.

```html
<button @click="${() => count.set(count() + 1)}">Increment</button>
```

Any standard DOM event name works: `@click`, `@input`, `@submit`, `@keydown`, and so on.

```html
<input
  type="text"
  value="${name()}"
  @input="${(e) => name.set(e.target.value)}"
/>

<form @submit="${(e) => { e.preventDefault(); submit() }}">
  ...
</form>
```

Event handlers receive the native DOM event as their argument. The handler runs outside the reactive tracking context, so reading a signal inside a handler does not create a subscription — call the signal accessor explicitly.

---

## Reactive class bindings

Pass an object literal to the `class` attribute to bind class names to reactive boolean signals.

```html
<div class="${{ active: isActive, primary: isPrimary, disabled: isDisabled }}">
  Content
</div>
```

Each key is a class name. Each value is a boolean signal or derived value. When a value changes, only the corresponding class token is added or removed — the renderer does not replace the entire `className` string.

```javascript
const MyComponent = $component(() => {
  $script(() => {
    const selected = signal(false)
    const urgent = derived(() => priority === 'high')
  })

  $render(() => html`
    <li class="${{ selected: selected, urgent: urgent }}">
      ${label}
    </li>
  `)
})
```

Static classes can be combined with reactive bindings by including a fixed `true` value:

```html
<div class="${{ card: true, highlighted: isHighlighted }}">
```

### Tagged-template: `classes()` and `cx()`

```ts
import { createHtmlTag, classes, cx } from '@neutro/view/renderer'

// classes() — REACTIVE. Values must be thunks (() => boolean):
html`<tr class="${classes({ danger: () => selected() === item.id })}">...</tr>`

// cx() — STATIC. Values are plain truthy (not thunks). Evaluated once:
html`<div class="${cx('col-md-4', isActive && 'active')}">...</div>`
```

**The critical distinction (G-TT-3 gate):**
- `classes()` is the tagged-template analog of `.nv`'s `class="${{ danger: isActive }}"` — but values must be `() => boolean` thunks, not plain booleans
- `cx()` is a pure string builder — no reactivity, used for static class composition
- Using `cx()` where you need `classes()` means class toggles will not update when signals change

Mapping from .nv to tagged template:
```
.nv:              class="${{ active: isActive, urgent: priority === 'high' }}"
Tagged template:  class="${classes({ active: () => isActive(), urgent: () => priority() === 'high' })}"
```

---

## Scoped styles with `$style`

`$style` attaches component-scoped CSS. Styles are applied only to elements rendered by that component instance.

```javascript
const Card = $component(() => {
  $render(() => html`
    <div class="${{ card: true }}">
      <h2 class="${{ title: true }}">${heading()}</h2>
      <p>${body()}</p>
    </div>
  `)

  $style(() => ({
    card: {
      background: 'white',
      borderRadius: '0.5rem',
      padding: '1.5rem',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    },
    title: {
      fontSize: '1.25rem',
      marginBottom: '0.5rem',
    },
  }))
})
```

### Key forms

`$style` supports two key forms:

**Class name key** — a bare identifier like `card` or `title`. The renderer rewrites the class name to `card_<hash>` (a stable content hash) and applies the same rewrite wherever that class appears in the component's template. This ensures styles do not leak to other components that happen to use the same class name.

**Selector key** — any string containing a CSS selector character (`.`, `#`, `[`, `:`, `>`, `+`, `~`, or a space). The renderer injects a `[data-nv-s-<hash>]` attribute on matching elements and scopes the rule to that attribute selector.

**Bare HTML tag** — a tag name like `button` or `p` with no other selector characters is treated as an element selector and scoped the same way as a selector key.

```javascript
$style(() => ({
  // class key — rewrites .card to .card_abc123
  card: {
    padding: '1rem',
  },
  // element selector — scoped to button[data-nv-s-abc123]
  button: {
    cursor: 'pointer',
  },
  // descendant selector
  'card > p': {
    color: '#555',
  },
}))
```

Styles defined in `$style` are injected into a `<style>` element at mount time and removed when the component unmounts.

The tagged template does not have a `$style` equivalent — scoped styles are a `.nv`-specific feature.

---

## Mounting a component

To attach a component to the document:

```typescript
import { Counter } from './Counter.nv'

Counter.mount(document.getElementById('app'), document)
```

---

## Related

- [Authoring .nv](./authoring-nv.md) — file format, `$component`, `$script`
- [Reactivity](./reactivity.md) — `signal`, `derived`, `effect`
- [API Reference](./api-reference.md) — full signatures for all built-ins
- [Template IR](../template-ir.md) — the intermediate representation the parser produces
