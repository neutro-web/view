# Getting Started

## Install

```bash
pnpm add @neutro/view
pnpm add -D esbuild typescript tsx
```

`jsdom` is a runtime dependency of `@neutro/view` — it is used by the esbuild plugin internally to parse `.nv` templates at build time. You do not need to install it separately.

## Project structure

```
my-app/
├── src/
│   ├── Counter.nv
│   └── main.ts
├── index.html
└── build.ts
```

## Counter.nv

```
const Counter = $component(() => {
  $script(() => {
    const count = signal(0)
  })
  $render(() => html`
    <span id="count">${count}</span>
    <button @click="${() => count = count + 1}">+</button>
  `)
})
```

## main.ts

> **Note:** Any `.ts` file that imports directly from a `.nv` file must have `// @ts-nocheck` as its first line. `.nv` modules have no TypeScript declarations — they are processed exclusively by esbuild + nvPlugin at build time.

```typescript
// @ts-nocheck
import { Counter } from './Counter.nv'

Counter.mount(document.getElementById('app'), document)
```

## index.html

```html
<!DOCTYPE html>
<html>
  <body>
    <div id="app"></div>
    <script type="module" src="./dist/main.js"></script>
  </body>
</html>
```

## build.ts

```typescript
import * as esbuild from 'esbuild'
import { nvPlugin } from '@neutro/view/renderer/plugin'

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  plugins: [nvPlugin()],
})
```

> **Note on the runtime entry:** Emitted bundles import `mount` from `@neutro/view/renderer/runtime`, not from the main renderer barrel. The runtime entry is slim — it excludes the parser and TypeScript compiler that the build-time barrel co-exports. You do not need to import from this entry directly; the esbuild plugin handles the retarget automatically.

Run the build:

```bash
npx tsx build.ts
```

## Serve and open

::: warning ES modules require a server
Opening `index.html` directly from the filesystem (`file://`) will fail — browsers block ES module imports from `file://` origins. You must serve the directory over HTTP.
:::

```bash
npx serve .
```

Open `http://localhost:3000`. You should see a counter with a `+` button; clicking it increments the number.

## Tagged-template path (no build step)

Plain TypeScript with no compiler plugin — import `createHtmlTag` and `mount` directly and run through any bundler or dev server that handles TypeScript. `.nv` is preferred for ergonomics; use this path when a build plugin is not an option.

### The explicit-thunk rule

::: warning Thunks are required — no erasure happens at runtime
In `.nv` files the compiler rewrites bare signal reads and assignments automatically. In the tagged template there is no such erasure. **Every reactive value in a template hole must be a thunk.** The runtime throws if you forget:

```
[nv/html] Expression at hole N is not a function. Wrap reactive values in thunks: ${() => signal()} not ${signal()}.
```
:::

Side-by-side comparison:

```ts
// .nv (compiler erases bare reads):
${count}                               // → count()  (auto-erased)
@click="${() => count = count + 1}"    // → count.set(count() + 1)  (auto-erased)

// tagged template (explicit — no erasure):
${() => count()}                       // thunk required
@click="${() => count.set(count() + 1)}"  // explicit .set()
```

### Example

```ts
import { createHtmlTag, mount } from '@neutro/view/renderer'
import { signal } from '@neutro/view/core'

const html = createHtmlTag(document)   // bind the tag to a document once

const count = signal(0)

const view = html`
  <div>
    <p>${() => count()}</p>
    <button @click="${() => count.set(count() + 1)}">increment</button>
  </div>
`

mount(view, document.getElementById('app')!, document)
```

`mount` takes three arguments: `(ir, parent, doc)` — the third argument is the document instance.

### API signatures

```ts
// from @neutro/view/renderer
export function createHtmlTag(document: Document): (strings: TemplateStringsArray, ...exprs: unknown[]) => TemplateIR
export function mount(ir: TemplateIR, parent: Element, doc: Document): () => void
// signals from @neutro/view/core
```

### How to run

No `build.ts` or esbuild plugin required. Serve the entry file with any TypeScript-capable dev server. For example, with [Vite](https://vitejs.dev/):

```bash
pnpm add -D vite
npx vite
```

Point `index.html` at your entry file as a `type="module"` script. Vite handles TypeScript and ES modules out of the box — no config needed for a basic app.

Because `createHtmlTag` needs a live `document`, the code runs in a browser (or jsdom for tests) — not in Node directly.

See also:
- [Rendering guide](./rendering.md) — `each()`, conditionals, `classes()`, `slots()`
- [API Reference](./api-reference.md) — full tagged-template signatures

## Next steps

- [Overview](./overview.md) — the design model
- [Authoring .nv](./authoring-nv.md) — full .nv syntax reference
- [API Reference](./api-reference.md) — all exported functions
