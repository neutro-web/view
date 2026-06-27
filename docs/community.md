# Community

## The Neutro Ecosystem

| Package | Description | Status |
|---|---|---|
| [`@neutro/view`](https://github.com/neutro-web/view) | Fine-grained reactive view engine | v0.1.0 |
| [`@neutro/form`](https://github.com/neutro-web/form) | Zero-dependency reactive form engine | v0.2.0 |
| `@neutro/fluid` | Physics-grounded glass material system | Coming soon |

## Filing Issues

- **Found a bug?** [Open an issue](https://github.com/neutro-web/view/issues/new?labels=bug) with a minimal reproduction
- **Have a feature request?** [Open an issue](https://github.com/neutro-web/view/issues/new?labels=enhancement) with the use case and expected behaviour
- **Question or discussion?** [Start a discussion](https://github.com/neutro-web/view/discussions)

## Support the Project

If `@neutro/view` saves you time, consider buying me a coffee — it keeps the packages maintained and the documentation up to date.

<a href="https://buymeacoffee.com/koficodedat" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="40" />
</a>

---

## FAQ

### Core Concepts

**Why signals instead of a virtual DOM?**

Signals record which DOM nodes read which values at mount time. When a signal changes, only those specific nodes update — no diffing pass, no component re-render, no scheduler. The update cost is proportional to what changed, not to the size of the component tree.

**What's the difference between `.nv` files and the tagged template?**

`.nv` files use compiler erasure: you write bare signal reads (`count`) and assignment-form writes (`count = count + 1`), and the compiler rewrites them to accessor calls before execution. The tagged template has no compiler step — every reactive value must be an explicit thunk (`() => count()`) and every write must call `.set()`. Both compile to the same `TemplateIR` at runtime.

**Do I need a build step?**

Only for `.nv` files, which require esbuild + `nvPlugin`. The tagged-template path (`createHtmlTag` + `mount`) works in plain TypeScript with no build plugin — serve with Vite or any TypeScript-capable dev server.

**Can I use `@neutro/view` with React, Vue, or Svelte?**

The reactive core (`@neutro/view/core`) is framework-agnostic and has zero DOM dependency. You can use signals anywhere. Mounting nv components alongside other frameworks requires a shared DOM target — it works but there are no official adapters in v0.1.0.

### Reactivity

**Why does my effect not run immediately after a signal write?**

Effects are microtask-scheduled. They run after the current synchronous code finishes. Use `flushSync()` if you need the DOM to reflect new signal values before the next line.

**What happens when I write to multiple signals in a row?**

Each write schedules effects independently by default. Use `batch(() => { ... })` to defer all scheduling until the batch returns — dependents see only the final state and effects run once.

**Can I read a signal without creating a dependency?**

Yes — wrap the read in `untrack(() => signal())`. Reads inside `untrack` are not registered as dependencies of the enclosing computed or effect.

### TypeScript

**Is TypeScript supported?**

Yes. All exports from `@neutro/view/core` and `@neutro/view/renderer` are fully typed. The `.nv` compiler output requires `// @ts-nocheck` in importer files at v0.1.0 — this is planned for resolution in v0.5.0.

**Why do I need `// @ts-nocheck` when importing `.nv` files?**

The nv compiler emits JavaScript modules, not TypeScript declarations. Until the compiler generates `.d.ts` files (planned for v0.5.0), TypeScript cannot resolve the types of `.nv` exports, so you must suppress the checker in the importing file.

### Runtime

**Can I use `@neutro/view/core` in Node.js?**

Yes. The core has zero DOM dependency and runs in any JavaScript environment — Node.js, Web Workers, Deno, Bun. The renderer (`@neutro/view/renderer`) requires a DOM environment (browser or jsdom).

**How do I test components?**

Write reactive logic tests against `@neutro/view/core` in plain Node.js with vitest — no jsdom needed. For renderer tests that touch the DOM, use vitest + jsdom. Call `flushSync()` after signal writes to synchronously flush effects before asserting DOM state.

**What's planned for v0.5.0?**

Async primitives, context API, a module-level store, SSR support, TypeScript declarations for `.nv` outputs, and the path-scoped sidebar / Guides section on this docs site.
