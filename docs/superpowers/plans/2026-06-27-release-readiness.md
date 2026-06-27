# v0.1.0 Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all gaps between current HEAD and a publishable v0.1.0: version bump, npm publish workflow, VitePress docs site with getting-started, and docs deploy workflow.

**Architecture:** Single-package (no monorepo). `package.json` gains version `0.1.0`, docs scripts, and a new `./renderer/plugin` subpath export. Two new workflows (`publish.yml`, `docs.yml`) land in `.github/workflows/`. A VitePress site lives in `docs/` with a getting-started guide derived from working browser-test fixtures. All gates verified before tagging.

**Tech Stack:** pnpm, TypeScript, VitePress ^1.3.0, GitHub Actions, esbuild (already in devDeps), jsdom (already in devDeps).

## Global Constraints

- `view` stays SINGLE-PACKAGE — do NOT convert to monorepo.
- Publish target: npm public (`publishConfig.access: public` already set).
- Node ≥ 20, pnpm 9.12.0.
- No `src/`/IR/behavior changes — infra + docs only (G-REL-6).
- No placeholder content — every doc command must actually run.
- Do not tag. Do not write decision-log entries.

---

## Findings (flag before continuing)

**F-1 — nvPlugin not exported:** `nvPlugin()` lives in `src/renderer/nv-esbuild-plugin.ts` but is NOT re-exported from `src/renderer/index.ts`. Users installing `@neutro/view` cannot import it. Fix: add a new subpath export `./renderer/plugin` → `dist/renderer/nv-esbuild-plugin.{js,d.ts}` in `package.json`, and document that import path in the getting-started guide.

**F-2 — jsdom is a devDependency:** `nvPlugin` imports `JSDOM` from `jsdom`, which is currently a devDependency. Users running the plugin in their build scripts will get a `Cannot find module 'jsdom'` error unless they install it themselves. Fix in Task 1: move `jsdom` to `dependencies` (and `@types/jsdom` stays devDependencies). Note this in the getting-started doc.

**F-3 — release-please.yml conflict:** The repo already has `.github/workflows/release-please.yml` — a release-PR bot wired to a `release` branch. Adding `publish.yml` creates a second release mechanism. Both can coexist but if release-please later creates its own tag, `publish.yml` would trigger and attempt a double-publish. **Flag to user before executing Task 2:** confirm whether to keep release-please or disable it for the manual-tag flow. No code change needed now — just document the decision required.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Version `0.1.0`, add `./renderer/plugin` export, add docs scripts, add `vitepress` devDep, move `jsdom` to deps, add `README.md` to `files` |
| `biome.json` | Modify | Add `"docs"` to `files.ignore` so `pnpm lint` doesn't lint VitePress config files |
| `.github/workflows/publish.yml` | Create | Tag-triggered npm publish with version-match guard |
| `.github/workflows/docs.yml` | Create | CI-gated VitePress build + GitHub Pages deploy |
| `docs/.vitepress/config.ts` | Create | VitePress site config |
| `docs/index.md` | Create | Landing page |
| `docs/guide/getting-started.md` | Create | Install + esbuild wiring + minimal Counter project |
| `docs/guide/overview.md` | Create | Stub (one paragraph + sidebar placeholder for doc-sweep) |

---

## Task 1: Version, exports, and publish-artifact fixes

**Files:**
- Modify: `package.json`
- Modify: `biome.json`

**Interfaces:**
- Produces: version `0.1.0`, `./renderer/plugin` subpath, `jsdom` in `dependencies`, `README.md` in `files`, docs scripts

- [ ] **Step 1: Bump version and fix files array**

In `package.json`, change `"version": "0.0.0"` → `"version": "0.1.0"` and `"files": ["dist"]` → `"files": ["dist", "README.md"]`.

- [ ] **Step 2: Add `./renderer/plugin` subpath export**

In the `"exports"` block of `package.json`, add after `"./renderer/runtime"`:

```json
"./renderer/plugin": {
  "types": "./dist/renderer/nv-esbuild-plugin.d.ts",
  "import": "./dist/renderer/nv-esbuild-plugin.js"
}
```

- [ ] **Step 3: Move jsdom to dependencies**

In `package.json`, move `"jsdom": "^28.0.0"` from `devDependencies` to a new `"dependencies"` block:

```json
"dependencies": {
  "jsdom": "^28.0.0"
}
```

Leave `"@types/jsdom": "^28.0.3"` in `devDependencies`.

- [ ] **Step 4: Add VitePress devDep and docs scripts**

Add to `devDependencies`:
```json
"vitepress": "^1.3.0"
```

Add to `scripts`:
```json
"docs:dev": "vitepress dev docs",
"docs:build": "vitepress build docs",
"docs:preview": "vitepress preview docs"
```

- [ ] **Step 5: Install and build to verify exports resolve**

```bash
pnpm install
pnpm build
```

Expected: `dist/renderer/nv-esbuild-plugin.js` and `dist/renderer/nv-esbuild-plugin.d.ts` both exist (they are produced by `tsc -p tsconfig.build.json` since the file is under `src/`).

```bash
ls dist/renderer/nv-esbuild-plugin.js dist/renderer/nv-esbuild-plugin.d.ts
```

Expected: both files present with no error.

- [ ] **Step 6: Dry-run publish — capture file list (G-REL-1)**

```bash
pnpm publish --dry-run
```

Do NOT pipe through grep — pnpm's dry-run output format differs from npm's `npm notice` lines. Capture the full output and inspect it. Confirm the tarball contains:
- `dist/core/index.js`, `dist/core/index.d.ts`
- `dist/compiler/index.js`, `dist/compiler/index.d.ts`
- `dist/renderer/index.js`, `dist/renderer/index.d.ts`
- `dist/renderer/runtime.js`, `dist/renderer/runtime.d.ts`
- `dist/renderer/nv-esbuild-plugin.js`, `dist/renderer/nv-esbuild-plugin.d.ts`
- `README.md`
- No `src/`, `test/`, or `*.spec.*` files.

Paste the exact file list into the return notes.

- [ ] **Step 7: Add `docs` to biome ignore**

In `biome.json`, add `"docs"` to the `files.ignore` array alongside the existing entries. The existing array looks like:
```json
"ignore": [
  "dist",
  "node_modules",
  "coverage",
  "*.md",
  ".claude",
  "test/browser/test-results",
  "test/browser/playwright-report"
]
```
Add `"docs"` so biome skips `docs/.vitepress/config.ts` and VitePress-generated files. Without this, `pnpm lint` in CI will lint the VitePress config and fail if biome's formatter disagrees with its style.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml biome.json
git commit -m "chore: bump version to 0.1.0, add renderer/plugin export, move jsdom to deps, ignore docs in biome"
```

---

## Task 2: Publish workflow

**Files:**
- Create: `.github/workflows/publish.yml`

**Interfaces:**
- Consumes: `package.json` version `0.1.0` from Task 1
- Produces: npm publish on `v*` tag push, with version-match guard

- [ ] **Step 1: Create `.github/workflows/publish.yml`**

```yaml
name: Publish

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  publish:
    name: Publish to npm
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Version guard
        if: startsWith(github.ref, 'refs/tags/')
        run: |
          PKG_VERSION=$(node -p "require('./package.json').version")
          TAG_VERSION="${GITHUB_REF#refs/tags/v}"
          if [ "$PKG_VERSION" != "$TAG_VERSION" ]; then
            echo "ERROR: package.json version ($PKG_VERSION) does not match tag ($TAG_VERSION)"
            exit 1
          fi
          echo "Version match: $PKG_VERSION"

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build

      - name: Publish
        run: pnpm publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Verify version guard logic (G-REL-2)**

Reason through it:

**Tag push (`v0.1.0`):** `GITHUB_REF=refs/tags/v0.1.0`. Guard step runs (`if: startsWith(github.ref, 'refs/tags/')`). `TAG_VERSION=0.1.0`, `PKG_VERSION=0.1.0` — match, passes. Publish runs.

**Tag mismatch (`v0.2.0` with package at `0.1.0`):** Guard runs. `TAG_VERSION=0.2.0 ≠ 0.1.0` — exits 1. Job fails before publish. Correct.

**`workflow_dispatch`:** `GITHUB_REF=refs/heads/main`. Guard step is SKIPPED (`if: startsWith(github.ref, 'refs/tags/')` is false). Publish runs using whatever version is in `package.json`. This is intentional — manual dispatch is an escape hatch; the operator is responsible for ensuring the version is correct.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: add npm publish workflow with version-match guard"
```

---

## Task 3: VitePress scaffold

**Files:**
- Create: `docs/.vitepress/config.ts`
- Create: `docs/index.md`
- Create: `docs/guide/overview.md`

**Interfaces:**
- Consumes: vitepress devDep from Task 1
- Produces: `pnpm docs:dev` serves locally, `pnpm docs:build` produces `docs/.vitepress/dist/`

- [ ] **Step 1: Create `docs/.vitepress/config.ts`**

```typescript
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '@neutro/view',
  description: 'High-performance, framework-portable, fine-grained reactive view engine.',
  base: '/view/',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Overview', link: '/guide/overview' },
      { text: 'GitHub', link: 'https://github.com/neutro-web/view' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Overview', link: '/guide/overview' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/neutro-web/view' },
    ],
  },
})
```

- [ ] **Step 2: Create `docs/index.md`**

```markdown
---
layout: home

hero:
  name: "@neutro/view"
  text: Fine-grained reactive view engine
  tagline: No virtual DOM. Signal-native. Framework-portable.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/neutro-web/view

features:
  - title: Signal-native reactivity
    details: Powered by alien-signals — only the exact DOM nodes that depend on a changed signal update.
  - title: Compiled .nv templates
    details: The .nv format compiles to zero-overhead Template IR. No runtime diffing, no reconciler.
  - title: Framework-portable
    details: No framework lock-in. The engine is a single npm package usable from any build toolchain.
---
```

- [ ] **Step 3: Create `docs/guide/overview.md`**

```markdown
# Overview

`@neutro/view` is a fine-grained reactive view engine. It provides three cohesive exports:

- **`@neutro/view/core`** — reactive primitives and scheduling utilities (see API reference for full list)
- **`@neutro/view/compiler`** — Template IR types and compiler utilities
- **`@neutro/view/renderer`** — `mount`, DOM helpers, and IR types
- **`@neutro/view/renderer/plugin`** — esbuild plugin (`nvPlugin`) for `.nv` files

> Full API reference and architecture guide coming in the documentation sweep (v0.1.0 content pass).
```

- [ ] **Step 4: Verify docs build (G-REL-3)**

```bash
pnpm docs:build
```

Expected: `docs/.vitepress/dist/index.html` exists, no broken-link errors in output.

```bash
ls docs/.vitepress/dist/index.html
```

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: scaffold VitePress site with landing page and overview stub"
```

---

## Task 4: Getting-started guide

**Files:**
- Create: `docs/guide/getting-started.md`

**Interfaces:**
- Consumes: `nvPlugin` export from `@neutro/view/renderer/plugin` (Task 1), counter.nv pattern from `test/browser/fixtures/`
- Produces: a getting-started doc where every command and import path is verified against real source

**Verified facts (do not guess):**
- `nvPlugin` is exported from `src/renderer/nv-esbuild-plugin.ts` as `export function nvPlugin(): Plugin`
- Import in user code: `import { nvPlugin } from '@neutro/view/renderer/plugin'`
- `jsdom` is a runtime dep of the plugin (moved to `dependencies` in Task 1) but users must also install `esbuild` themselves
- Counter pattern from `test/browser/fixtures/counter.nv`:
  ```
  const Counter = $component(() => {
    $script(() => {
      const count = signal(0)
    })
    $render(() => html`<span id="count">${count}</span><button id="btn" @click="${() => count = count + 1}">+</button>`)
  })
  ```
- Mount convention verified from `src/renderer/nv-emitter.ts` line 319: emitter emits `Name.mount = (parent, doc, props = {}, slots = {}) => mount(Name(props, slots), parent, doc)` — so `Counter.mount(parent, document)` is the correct call.
- Any `.ts` file that directly imports from a `.nv` file MUST have `// @ts-nocheck` as its first line — `.nv` files have no TypeScript declarations. See `test/browser/fixtures/counter-entry.ts` for the canonical pattern.
- `tsx` must be in the user's devDeps to run `build.ts` — it is not installed transitively.

- [ ] **Step 1: Create `docs/guide/getting-started.md`**

Create the file at `docs/guide/getting-started.md`. Write each section exactly as shown below. The file is a standard Markdown file — the sections below are its verbatim content, not plan prose.

**Section: title**
```
# Getting Started
```

**Section: Install**
```
## Install
```
Followed by a bash code block containing:
```
pnpm add @neutro/view
pnpm add -D esbuild typescript tsx
```
Followed by this paragraph:
```
`jsdom` is a runtime dependency of `@neutro/view` — it is used by the esbuild plugin internally to parse `.nv` templates at build time. You do not need to install it separately.
```

**Section: Project structure**
```
## Project structure
```
Followed by a plain (no language tag) code block:
```
my-app/
├── src/
│   ├── Counter.nv
│   └── main.ts
├── index.html
└── build.ts
```

**Section: Counter.nv**
```
## Counter.nv
```
Followed by a plain code block containing (verbatim from `test/browser/fixtures/counter.nv`):
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

**Section: main.ts**
```
## main.ts

> **Note:** Any `.ts` file that imports directly from a `.nv` file must have `// @ts-nocheck` as its first line. `.nv` modules have no TypeScript declarations — they are processed exclusively by esbuild + nvPlugin at build time.
```
Followed by a typescript code block:
```
// @ts-nocheck
import { Counter } from './Counter.nv'

Counter.mount(document.getElementById('app'), document)
```

**Section: index.html**
```
## index.html
```
Followed by an html code block:
```
<!DOCTYPE html>
<html>
  <body>
    <div id="app"></div>
    <script type="module" src="./dist/main.js"></script>
  </body>
</html>
```

**Section: build.ts**
```
## build.ts
```
Followed by a typescript code block:
```
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
Followed by the text "Run the build:" and a bash code block:
```
npx tsx build.ts
```

**Section: Serve and open**
```
## Serve and open

::: warning ES modules require a server
Opening `index.html` directly from the filesystem (`file://`) will fail — browsers block ES module imports from `file://` origins. You must serve the directory over HTTP.
:::
```
Followed by a bash code block:
```
npx serve .
```
Followed by:
```
Open `http://localhost:3000`. You should see a counter with a `+` button; clicking it increments the number.
```

- [ ] **Step 2: Verify doc builds with no broken links**

```bash
pnpm docs:build 2>&1 | tail -20
```

Expected: exits 0, no `dead link` warnings for `/guide/getting-started`.

- [ ] **Step 3: Commit**

```bash
git add docs/guide/getting-started.md
git commit -m "docs: add getting-started guide with esbuild wiring and Counter example"
```

---

## Task 5: Docs deploy workflow

**Files:**
- Create: `.github/workflows/docs.yml`

**Interfaces:**
- Consumes: `pnpm docs:build` from Task 3
- Produces: GitHub Pages deploy after CI passes on `main`

- [ ] **Step 1: Create `.github/workflows/docs.yml`**

```yaml
name: Docs

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    name: Deploy docs to GitHub Pages
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}

    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}

      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build docs
        run: pnpm docs:build

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/docs.yml
git commit -m "ci: add docs deploy workflow (GitHub Pages, triggered after CI on main)"
```

---

## Task 6: G-REL-4 — verify getting-started actually runs in a browser

The spec requires the minimal project to build and mount in a real browser — not just that the docs describe how. This task is the proof.

**Files:**
- Create (temp, outside repo): `/tmp/nv-gs-test/` — scratch project, not committed

**Interfaces:**
- Consumes: `@neutro/view` as published (via `pnpm publish --dry-run` tarball) OR via the local dist using `file:` link
- Produces: G-REL-4 evidence — browser shows counter with `+` button that increments

- [ ] **Step 1: Create a scratch project linked to local dist**

```bash
mkdir /tmp/nv-gs-test && cd /tmp/nv-gs-test
pnpm init -y
pnpm add esbuild typescript tsx
pnpm add ../../path/to/view   # adjust to actual repo path — installs from local dist via file: link
```

Or, to use the exact pack artifact:
```bash
cd /path/to/view
pnpm pack
# produces neutro-view-0.1.0.tgz
cd /tmp/nv-gs-test
pnpm add /path/to/view/neutro-view-0.1.0.tgz
```

- [ ] **Step 2: Create the minimal project files**

Create `src/Counter.nv` (verbatim from `test/browser/fixtures/counter.nv`):
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

Create `src/main.ts`:
```typescript
// @ts-nocheck
import { Counter } from './Counter.nv'

Counter.mount(document.getElementById('app'), document)
```

Create `index.html`:
```html
<!DOCTYPE html>
<html>
  <body>
    <div id="app"></div>
    <script type="module" src="./dist/main.js"></script>
  </body>
</html>
```

Create `build.ts`:
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

- [ ] **Step 3: Run the build**

```bash
npx tsx build.ts
```

Expected: exits 0. `dist/main.js` exists. No errors about missing modules.

If it fails with `Cannot find module 'jsdom'`: jsdom was not installed transitively — check that the local package.json has `"dependencies": { "jsdom": "^28.0.0" }` from Task 1 Step 3.

If it fails with `Cannot find module '@neutro/view/renderer/plugin'`: the `./renderer/plugin` subpath export was not added — re-check Task 1 Step 2.

- [ ] **Step 4: Serve and open in browser (G-REL-4)**

```bash
npx serve .
```

Open `http://localhost:3000` in a real browser (not headless). Verify:
1. The page loads without console errors.
2. A `<span>` containing `0` is visible.
3. Clicking the `+` button increments the counter — the DOM updates reactively.

Record this as G-REL-4 evidence in the return notes. If any step fails, it is a HARD STOP — do not proceed to Task 7 until resolved.

- [ ] **Step 5: Clean up scratch project**

```bash
rm -rf /tmp/nv-gs-test
```

---

**Files:**
- Modify: `package.json` (homepage field)

**Interfaces:**
- Produces: G-REL-5 verified, homepage points to Pages URL

- [ ] **Step 1: Update homepage in package.json**

Change:
```json
"homepage": "https://github.com/neutro-web/view"
```
To:
```json
"homepage": "https://neutro-web.github.io/view/"
```

- [ ] **Step 2: Run full CI locally (G-REL-5)**

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

Expected: all pass with exit 0.

- [ ] **Step 3: Final dry-run (confirm G-REL-1 still clean after all changes)**

```bash
pnpm publish --dry-run
```

Inspect the full output (do not grep — pnpm's dry-run format differs from npm's). Confirm `dist/renderer/nv-esbuild-plugin.js` + `.d.ts` appear in the tarball alongside the original four entry pairs and `README.md`.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: set homepage to GitHub Pages URL"
```

---

## Return checklist

After all tasks complete, report back:

1. **G-REL-1 dry-run file list** — paste exact file list from `pnpm publish --dry-run` output showing every file in the tarball
2. **G-REL-2 version guard** — confirm the logic reasoning in Task 2 Step 2
3. **G-REL-3 docs build** — confirm `pnpm docs:build` exits 0
4. **G-REL-4 getting-started runs** — confirm the scratch Counter project built, served, and mounted in a real browser; counter incremented on click
5. **G-REL-5 CI** — confirm `pnpm test` + `pnpm typecheck` + `pnpm lint` all pass locally
6. **F-1 / F-2 findings** — note that `nvPlugin` is now on `./renderer/plugin` subpath and `jsdom` is in `dependencies`

**Manual steps for the user (cannot be done in-repo):**
- Add `NPM_TOKEN` secret to GitHub repo settings → Settings → Secrets → `NPM_TOKEN`. The tag CANNOT succeed without this.
- Enable GitHub Pages: repo Settings → Pages → Source = "GitHub Actions"
- Confirm `homepage` URL resolves after the first docs deploy

**Do NOT tag.** Once the user completes the manual checklist, the tag is: `git tag v0.1.0 && git push --tags`
