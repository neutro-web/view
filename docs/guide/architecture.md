# Architecture

`@neutro/view` is split into three packages with a strict dependency direction: the compiler and renderer both depend on the core, but the core depends on neither.

```
  .nv files
      |
  [compiler / nvPlugin]   (build time only)
      |
  TemplateIR (JS module)
      |
  [renderer/runtime]      (browser runtime)
      |
  [core]                  (reactive runtime, no DOM)
```

---

## The three layers

### `@neutro/view/core` — reactive runtime

The reactive core is the foundation. It exports:

- `signal`, `derived`, `effect`, `sync`
- `batch`, `untrack`, `flushSync`
- `pubsub`, `errorBoundary`
- `createRoot`, `onCleanup`

The core has **zero DOM dependency**. It imports nothing from the browser environment and can run in Node.js, Web Workers, server-side rendering contexts, or any standard JS environment.

Internally the graph uses an intrusive doubly-linked list edge structure — no Array, Set, or Map in the hot path — so adding and removing edges is O(1). Nodes are colored with three states during propagation: `CLEAN (0)`, `CHECK (1)`, and `DIRTY (2)`. A derived node marked `CHECK` re-evaluates only if at least one upstream source is found to be dirty when the node is actually read, keeping unnecessary re-computation to a minimum.

### `@neutro/view/compiler` — build-time analysis

The compiler is never imported in the browser. It runs at build time (via the esbuild `nvPlugin` or standalone) and contains:

- **sync-target classifier** — determines which signals are write targets for `sync` effects
- **write-graph cycle checker** — statically detects feedback loops before they reach runtime
- **`check-program.ts`** — TypeScript program-level analysis for cross-file inference
- **`read-write-erasure-analyzer.ts`** — identifies reads that can be elided from the emitted bundle
- **`branch-variant-analyzer.ts`** — analyzes conditional branches for specialization opportunities
- **`equality-hook-emitter.ts`** — emits the §10 specialization hook payloads (see below)

### `@neutro/view/renderer` — Template IR interpreter

The renderer consumes the reactive core and materializes a Template IR tree into live DOM. The interpreter walks the IR, creates DOM nodes, and wires fine-grained reactive bindings. Each binding is a single `effect` or `sync` that updates exactly one DOM attribute or text node — there is no virtual DOM diffing pass.

The renderer barrel re-exports the TypeScript parser (`nv-parser.ts`), which transitively imports the TypeScript compiler. **Do not import `@neutro/view/renderer` in emitted bundles.** Use the runtime-only entry instead (see below).

---

## The `.nv` → browser pipeline

1. Author writes `.nv` component files.
2. The esbuild `nvPlugin` picks up `.nv` imports and calls `parseNvFileForEmit` from `nv-parser.ts`.
3. The plugin emits a JS module that constructs a `TemplateIR` object and exports a component factory function.
4. The emitted module imports `mount` from `@neutro/view/renderer/runtime` — the slim entry, not the fat barrel.
5. At runtime in the browser, the application calls `ComponentName.mount(parent, document)` — a two-argument sugar method emitted by the plugin. Internally it calls the three-argument `mount(ir, parent, doc)` from `@neutro/view/renderer/runtime`.
6. The interpreter walks the IR, creates real DOM nodes, and registers reactive effects for each binding.
7. When a signal changes, only the DOM nodes whose bindings depend on that signal are updated.

---

## §10 specialization hooks

The reactive core exposes a small set of stub fields on node objects — `_eqHook`, `_depHook`, and related slots — that are inert (no-op) at runtime unless populated. At build time the compiler analyzes each `derived` node and, where it can prove that a custom equality check is safe and beneficial, the `equality-hook-emitter.ts` writes the hook payload into the emitted JS. When the node next propagates, it calls the hook instead of the default reference-equality check.

This is the mechanism by which the compiler specializes the runtime on a per-node basis. The core itself has no knowledge of what the hooks do; it simply calls them if present. The formal contract for these hooks is documented in the Reactive Core Contract (see the source repo).

---

## The `renderer/runtime` entry

| Entry point | Contents | Use in |
|---|---|---|
| `@neutro/view/renderer` | Interpreter + parser + IR types + re-exports | Tooling, tests, build plugins |
| `@neutro/view/renderer/runtime` | `mount` only | Emitted component bundles |

Keeping the parser out of the runtime entry prevents the TypeScript compiler from being included in user-facing bundles.

---

## DOM-free core — practical consequences

Because the reactive core has no DOM coupling:

- Unit tests for signals, derived values, and effects run without jsdom or a browser harness.
- The same reactive primitives can be used in Node.js scripts and Web Workers without shimming browser globals.
- SSR support (future) can run the reactive graph on the server without special configuration.
- The renderer is a consumer of the core, not an extension of it — the boundary is explicit and testable.

---

## Further reading

- [Decision Log](https://github.com/neutro-web/view/blob/main/docs/decision-log.md) — rationale for key architectural choices
- [Reactive Core Contract](https://github.com/neutro-web/view/blob/main/docs/reactive-core-contract.md) — formal propagation semantics (source)
- [Template IR](https://github.com/neutro-web/view/blob/main/docs/template-ir.md) — IR node types and serialization format (source)
- [API Reference](./api-reference.md) — all public exports with signatures
