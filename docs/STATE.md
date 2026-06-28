# State of nv — v0.1.0

## What nv is

nv is a fine-grained reactive view engine. Components run once; signals track which DOM nodes depend on which values; when a signal changes, only those exact nodes update. Components are authored in `.nv` files, compiled via an esbuild plugin, and benchmarked against the js-framework-benchmark suite.

## What you can do today

**`.nv` components (compiled):**
- Author `.nv` components with the four primitives: `signal`, `derived`, `effect`, `sync`
- Use `<each>` for keyed lists, including in tables and selects via `<template>` rewrite
- Use ternary conditionals: `${cond ? html`...` : html`...`}`
- Bind events with `@click="${() => count = count + 1}"` (assignment-form, erased to `.set()`)
- Use reactive classlist: <code v-pre>class="${{ active: isActive }}"</code>
- Use `$style` for scoped styles (key-form and selector-form)
- Use `sync` for bidirectional or external-source signal binding
- Compile via the esbuild plugin (`nvPlugin` from `@neutro/view/renderer/plugin`)
- Mount in a real browser: `Component.mount(element, document)`
- Run in the js-framework-benchmark suite as `keyed/nv/`

**Tagged template (`html`, no-build):**
- Author components in plain `.ts`/`.js` — no esbuild plugin, no `.nv` files
- Use `createHtmlTag(document)` to get the `html` tagged template tag
- Reactive holes require explicit thunks: `${() => signal()}` (no compiler erasure)
- Use `each()` for keyed lists, `classes()` for reactive class toggling, `cx()` for static class strings
- Use `slots()` / `slot()` for component composition
- Mount with `mount(ir, parent, document)` from `@neutro/view/renderer`
- Same runtime, same performance characteristics as the `.nv` path

## Performance position

Numbers from Chrome 149 on M2 Max, harness commit 4fbccf55 (see [Decision Log — CP-2d](https://github.com/neutro-web/view/blob/main/docs/decision-log.md) for full detail):

| Benchmark | vs vanilla |
|---|---|
| select row | 0.50× (nv wins) |
| update every 10th row | 0.69× (nv wins) |
| bulk create | ~1.7× (at-peer with Solid/Svelte band) |
| memory | ~2.4× |
| swap rows | **0.66× (nv wins)** — LIS-Ivi landed v0.5.0-pre |

**Swap rows**: LIS-Ivi move-minimization (`2fb8476`) reduced swap from 3.74× to 0.66× vanilla — nv now beats vanilla and the fine-grained peers (Solid 1.03×, Svelte 0.99×) on swap. The P-1 deficit is closed.

## What is not here yet (v0.5.0 scope)

- Async primitives
- Store / context
- SSR
- Full control-flow (`<when>` is not implemented)
- Performance, memory, security, and toolchain work per the decision log roadmap

## Links

- [API Reference](/api/)
- [Decision Log — CP-2c](https://github.com/neutro-web/view/blob/main/docs/decision-log.md)
- [Getting Started](/getting-started)
- [Architecture](/guides/architecture)
