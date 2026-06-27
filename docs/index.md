---
layout: home

hero:
  name: '@neutro/view'
  tagline: Fine-grained reactive view engine for the web.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /guide/api-reference

features:
  - title: Signal-native reactivity
    details: Powered by alien-signals — only the exact DOM nodes that depend on a changed signal update. Zero wasted renders.

  - title: Two authoring surfaces
    details: Write components in compiled .nv files with ergonomic assignment-erasure, or use the html tagged template directly — no build step, no plugin required.

  - title: No virtual DOM
    details: A keyed reconciler moves real DOM nodes directly. No diffing, no patching, no runtime overhead per update.

  - title: Fine-grained updates
    details: Each reactive binding is a single effect that updates exactly one DOM attribute or text node. Updates are surgically targeted, never component-wide.

  - title: Keyed reconciler
    details: List reorders move existing DOM nodes with insertBefore rather than destroying and rebuilding them — preserving focus, scroll position, and input values across updates.

  - title: Framework-portable
    details: No framework lock-in. The engine ships as a single npm package usable from any build toolchain or served as a plain ES module with no bundler.
---

## Why @neutro/view?

Most view libraries pay a per-update tax: reconcile a virtual DOM, diff component trees, patch the real DOM. `@neutro/view` skips all of that. Signals track exactly which DOM nodes depend on which values — when a signal changes, only those nodes update. No diffing pass, no component re-render, no scheduler.

```ts
import { createHtmlTag, mount } from '@neutro/view/renderer'
import { signal } from '@neutro/view/core'

const html = createHtmlTag(document)
const count = signal(0)

const view = html`
  <div>
    <p>${() => count()}</p>
    <button @click="${() => count.set(count() + 1)}">+</button>
  </div>
`

mount(view, document.getElementById('app')!, document)
```

[Get Started](/guide/getting-started) | [API Reference](/guide/api-reference) | [Architecture](/guide/architecture)

---

## Neutro Ecosystem

`@neutro/view` is part of the Neutro collection — focused, zero-dependency primitives for the web.

- **`@neutro/view`** — the library you're reading about now
- **`@neutro/form`** — zero-dependency reactive form engine for every framework
- **`@neutro/fluid`** *(coming soon)* — a physics-grounded glass material system for the web

---

## Support the Project

If this library saves you time, consider [buying me a coffee](https://buymeacoffee.com/koficodedat). It keeps the packages maintained and the documentation up to date.

Found a bug or have a feature request? [Open an issue on GitHub](https://github.com/neutro-web/view/issues).
