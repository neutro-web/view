# Plugin & Runtime

Build-time and slim-runtime entry points.

---

## `@neutro/view/renderer/plugin`

```ts
import { nvPlugin } from '@neutro/view/renderer/plugin'
```

### `nvPlugin`

```ts
function nvPlugin(): Plugin
```

Returns an esbuild plugin that transforms `.nv` single-file components into JavaScript modules. Wire it into your esbuild config:

```ts
import { build } from 'esbuild'
import { nvPlugin } from '@neutro/view/renderer/plugin'

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  plugins: [nvPlugin()],
})
```

The plugin resolves `.nv` imports, compiles each component through the nv parser and emitter, and rewrites the import to the generated JavaScript. Emitted bundles import `mount` from `@neutro/view/renderer/runtime` (not the fat renderer barrel).

---

## `@neutro/view/renderer/runtime`

```ts
import { mount } from '@neutro/view/renderer/runtime'
```

A slim entry point that exports only `mount` — no parser, no TypeScript compiler. This is what emitted `.nv` bundles import at runtime; pulling it in does not transitively include the TS compiler or nv parser.

The `mount` signature is identical to the one in `@neutro/view/renderer`:

```ts
function mount(ir: TemplateIR, parent: Element, doc: Document): () => void
```

End users do not import from this path directly. It is wired up automatically by the build plugin for emitted bundles.

---

## Entry point comparison

| Entry point | Contents | Use in |
|---|---|---|
| `@neutro/view/renderer` | Interpreter + parser + IR types + re-exports | Tooling, tests, tagged-template apps |
| `@neutro/view/renderer/runtime` | `mount` only | Emitted .nv component bundles |
| `@neutro/view/renderer/plugin` | `nvPlugin` esbuild plugin | Build configuration |

---

## Source files verified {#source-files-verified}

The following source files were read to produce this reference. No signature was guessed or inferred from memory.

| File | Notes |
|---|---|
| `src/core/core.ts` | lines 978–end |
| `src/core/index.ts` | |
| `src/renderer/index.ts` | |
| `src/renderer/runtime.ts` | |
| `src/renderer/interpreter.ts` | mount signature |
| `src/renderer/html-tag.ts` | |
| `src/renderer/nv-esbuild-plugin.ts` | nvPlugin signature |
| `package.json` | exports map |
