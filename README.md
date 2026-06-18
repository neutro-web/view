# @neutro/view

High-performance, framework-portable, fine-grained reactive view engine.

> **Status: pre-alpha.** The reactive core is correctness-complete and verified; the
> compiler and renderer are implemented through the proof-of-concept gate. APIs and
> names are provisional. Not ready for production use.

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

## Packages / entry points

`@neutro/view` ships as one package with subpath exports:

| Import | What it is |
| --- | --- |
| `@neutro/view/core` | The reactive runtime (DOM-free). `signal`, `derived`, `effect`, `sync`, `pubsub`, `errorBoundary`, ownership + scheduling. |
| `@neutro/view/compiler` | Compile-time analysis: `sync`-target classification, the write-graph cycle checker, and the §10 specialization hooks. |
| `@neutro/view/renderer` | Template IR → live DOM with fine-grained bindings. |

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
