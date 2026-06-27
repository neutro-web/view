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
