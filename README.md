# @neutro/view

High-performance, framework-portable, fine-grained reactive view engine.

> **Status: v0.1.0 — authorable, compilable, benchmarked.** APIs may evolve as the
> surface area grows toward v0.5.0.

## What it is

- **Fine-grained signals** with three-state (Clean/Check/Dirty) graph-coloring:
  components run once, no virtual DOM, no re-render.
- **A small primitive set** — `signal`, `derived`, `effect`, `sync`, plus `pubsub`
  and `errorBoundary`.
- **`sync`** — one construct for "when X changes, write signal Y." Feedback loops in
  analyzable code become a *build-time error*, not a runtime cap.
- **A compiler** that specializes the runtime per node (equality, dependency sets,
  `sync`-target classification) — only ever skipping provable work.
- **DOM-free core.** The renderer consumes it; Web Components are a compile *target*,
  not the authoring model.
- **`.nv` single-file components** — authored in a concise declarative format,
  compiled by the esbuild plugin to efficient DOM-bound modules.

## `.nv` components

`.nv` is the headline authoring format. A Counter component:

```js
const Counter = $component(() => {
  $script(() => {
    const count = signal(0)
  })
  $render(() => html`
    <span>${count}</span>
    <button @click="${() => count = count + 1}">+</button>
  `)
})
```

Mount it in your entry point:

```typescript
// @ts-nocheck
import { Counter } from './Counter.nv'
Counter.mount(document.getElementById('app'), document)
```

> `// @ts-nocheck` is required because `.nv` files have no TypeScript declarations yet.

## Performance

js-framework-benchmark, Chrome 149 / M2 Max: wins select (0.34×) and update-10th
(0.68×) vs vanilla; at-peer on bulk create (~1.7×); swap rows deficit (3.95×) tracked
for v0.5.0. See [CP-2c in the decision log](docs/decision-log.md).

## Packages / entry points

`@neutro/view` ships as one package with subpath exports:

| Import | What it is |
| --- | --- |
| `@neutro/view/core` | The reactive runtime (DOM-free). `signal`, `derived`, `effect`, `sync`, `pubsub`, `errorBoundary`, ownership + scheduling. |
| `@neutro/view/compiler` | Compile-time analysis: `sync`-target classification, write-graph cycle checker, and §10 specialization hooks. |
| `@neutro/view/renderer` | Template IR → live DOM. `mount`, html-tag helpers, and the full IR type surface. |
| `@neutro/view/renderer/runtime` | Slim runtime entry for emitted app bundles — only `mount`, no parser or TS compiler. |
| `@neutro/view/renderer/plugin` | esbuild plugin (`nvPlugin`) for compiling `.nv` files. |

`/renderer/runtime` exists so that emitted bundles import only what they need — the
TypeScript compiler stays out of user apps entirely.

## Core JS API

```ts
import { signal, derived, effect } from '@neutro/view/core'

const count = signal(0)
const label = derived(() => `Count: ${count()}`)
effect(() => console.log(label()))

count.set(1) // → logs "Count: 1"
```

## Design authority

The design is specified, not improvised:

- [`docs/reactive-core-contract.md`](docs/reactive-core-contract.md) — the runtime
  contract (semantics, invariants, conformance checklist). **Source of truth for
  reactive-core semantics.**
- [`docs/decision-log.md`](docs/decision-log.md) — every decision and its rationale.
- [`docs/template-ir.md`](docs/template-ir.md) — the renderer's Template IR contract.

## Development

```bash
pnpm install        # also installs git hooks via lefthook
pnpm typecheck      # tsc --strict, DOM lib in scope  (gate 1)
pnpm test           # vitest                           (gate 2)
pnpm lint           # biome
pnpm build          # emit dist/
```

The two gates are **separate on purpose**: the test runner strips types, so a green
suite does not imply a clean compile. Both run on `pre-push` and in CI.

## Provenance

Reactivity semantics are derived from the published graph-coloring approach
(Reactively) and the data-structure discipline proven in alien-signals — an
independent specification and implementation, not a port.

## License

[MIT](LICENSE)
