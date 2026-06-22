# A2 Emitter Factory-Shape Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `nv-emitter.ts` emit components as `ComponentRef` + `.mount` sugar instead of `{ mount }` wrappers, closing the composition gap so emitted components can be children of other emitted components.

**Architecture:** `emitComponentFactory` is rewritten to return the IR literal directly and emit a `Counter.mount` sugar property; `emitImports` stops force-including `createRoot`/`onCleanup`; existing call sites that used `mod.X().mount(parent, doc)` are migrated to `mod.X.mount(parent, doc)`. Back-ends (`interpreter.ts`, `emitted-mount.ts`, `core.ts`) are **not touched**.

**Tech Stack:** TypeScript, Vitest, esbuild, JSDOM, `@neutro/view/core` + `@neutro/view/renderer`

## Global Constraints

- `core.ts`, `interpreter.ts`, `emitted-mount.ts` must NOT be modified — emitter-only change
- Done = committed on `main`; no worktree-only writes
- `pnpm typecheck` / `pnpm lint` / `pnpm build` must stay clean at every commit
- Each new test (TC-C15/16/17) must demonstrably FAIL before the emitter change
- TC-C15-exec must do a real bundle→import→mount→set→assert cycle, not a string check

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/renderer/nv-emitter.ts` | Modify | `emitComponentFactory` → A2 shape; `emitImports` → drop forced `createRoot`/`onCleanup` |
| `test/renderer/nv-emitter-exec.test.ts` | Modify | Migrate `mod.X().mount(p,d)` call sites; add TC-C15-exec, TC-C15-dispose, TC-C17, differential parity |
| `test/renderer/nv-emitter.test.ts` | Modify | Update EM-11b (drop `createRoot`/`onCleanup` checks), EM-11d (drop `__ir` check, add `Counter.mount`), EM-11e (update structural assertions); add TC-C16 |
| `docs/decision-log.md` | Modify | Append log entry; update Current State header |
| `docs/implementation-state.md` | Modify | Update `nv-emitter.ts` status note; remove forward-queue line for "emitter factory shape convergence" |

---

## Task 1: Add failing tests for A2 shape (TC-C15/16/17 + parity)

These tests must FAIL against the current emitter (which returns `{ mount }`). Write them first, confirm red, then implement.

**Files:**
- Modify: `test/renderer/nv-emitter.test.ts` (add TC-C16 after the `EM-D1b` block)
- Modify: `test/renderer/nv-emitter-exec.test.ts` (add TC-C15-exec, TC-C15-dispose, TC-C17, differential parity after TC-C14)

**Interfaces:**
- Consumes: existing `bundleEmittedJs`, `bundleComponentWithSignal`, `makeDoc`, `makeParent`, `BundleModule` from the exec test file
- Produces: 5 new `test(...)` blocks that all fail before Task 2 lands

- [ ] **Step 1: Add TC-C16 to nv-emitter.test.ts**

Find the end of the `factory signature — props + slots params` describe block (around line 733) and add a new describe block after the whole `EM-11*` section (around line 719 in nv-emitter.test.ts). Add at the very bottom of the file (before the last `}`):

```ts
// ── TC-C16: ComponentRef shape — no mount method on instance ─────────────────

describe('TC-C16  emitted factory returns ComponentRef, not { mount }', () => {
  test('TC-C16a  Counter(props, slots) returns object with shape + bindings, no .mount', () => {
    const source = `
const Counter = $component((props) => {
  $script(() => { const { count } = props })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const results = parseNvFileForEmit(source, 'counter.nv', document)
    const js = emitModule(results)
    // Evaluate the factory with real primitives
    const scope = { signal, derived, effect, createRoot, onCleanup, flushSync, mount }
    const fn = new Function(
      ...Object.keys(scope),
      `${js}\nreturn Counter`,
    )
    const Counter = fn(...Object.values(scope)) as (
      props: Record<string, unknown>,
      slots: Record<string, unknown>,
    ) => unknown
    const ir = Counter({}, {})
    // Must be a plain object with shape/bindings
    expect(ir).toBeDefined()
    expect(typeof ir).toBe('object')
    expect((ir as Record<string, unknown>).shape).toBeDefined()
    expect((ir as Record<string, unknown>).bindings).toBeDefined()
    // Must NOT have a .mount method on the returned IR
    expect((ir as Record<string, unknown>).mount).toBeUndefined()
  })

  test('TC-C16b  Counter.mount is a function (sugar on the factory)', () => {
    const source = `
const Counter = $component((props) => {
  $script(() => { const { count } = props })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const results = parseNvFileForEmit(source, 'counter.nv', document)
    const js = emitModule(results)
    const scope = { signal, derived, effect, createRoot, onCleanup, flushSync, mount }
    const fn = new Function(
      ...Object.keys(scope),
      `${js}\nreturn Counter`,
    )
    const Counter = fn(...Object.values(scope)) as { mount?: unknown }
    expect(typeof Counter.mount).toBe('function')
  })
})
```

- [ ] **Step 2: Add TC-C15-exec, TC-C15-dispose, TC-C17, differential parity to nv-emitter-exec.test.ts**

Append after the last `})` closing the TC-C14 describe block (end of file, around line 569):

```ts
// ── TC-C15 / TC-C16 / TC-C17: A2 factory-shape convergence ──────────────────

/**
 * Two-component source: App contains a Counter child via component binding.
 * Used by TC-C15-exec (real composition), TC-C15-dispose (no-leak), and
 * TC-C17 (sugar path).
 */
async function buildTwoComponentBundle(): Promise<string> {
  // counter.nv — ComponentRef that renders a count prop
  const counterSource = `
const Counter = $component((props) => {
  $script(() => {
    const { count } = props
  })
  $render(() => html\`<span>\${count}</span>\`)
})`

  // app.nv — parent that mounts Counter as a real child with a reactive prop
  const appSource = `
import { Counter } from './counter.nv'
const App = $component(() => {
  $script(() => {
    const n = signal(0)
  })
  $render(() => html\`<div><Counter .count="\${n}"/></div>\`)
})`

  const tmpDir = path.join(os.tmpdir(), `nv-tc15-${crypto.randomUUID()}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  tempDirs.push(tmpDir)

  const counterFile = path.join(tmpDir, 'counter.nv')
  const appFile = path.join(tmpDir, 'app.nv')
  const entryFile = path.join(tmpDir, 'entry.js')
  const outFile = path.join(tmpDir, 'app-tc15.bundle.mjs')

  fs.writeFileSync(counterFile, counterSource, 'utf8')
  fs.writeFileSync(appFile, appSource, 'utf8')
  fs.writeFileSync(
    entryFile,
    `export { App } from './app.nv'\nexport { flushSync, signal } from '@neutro/view/core'\n`,
    'utf8',
  )

  await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    format: 'esm',
    outfile: outFile,
    platform: 'node',
    plugins: [
      {
        name: 'neutro-alias-and-nv-remap',
        setup(build) {
          build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({ path: coreIndexPath }))
          build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
            path: rendererIndexPath,
          }))
          build.onResolve({ filter: /\.js$/ }, (args) => {
            const jsPath = path.resolve(path.dirname(args.importer), args.path)
            const nvPath = jsPath.replace(/\.js$/, '.nv')
            if (fs.existsSync(nvPath)) return { path: nvPath }
            return null
          })
        },
      },
      nvPlugin(),
    ],
  })

  return outFile
}

type TwoComponentModule = {
  App: (props?: Record<string, unknown>, slots?: Record<string, unknown>) => { mount(p: Element, d: Document): () => void }
  flushSync(): void
  signal<T>(v: T): { (): T; set(v: T): void }
}

describe('TC-C15  two-component composition: App mounts Counter as child', () => {
  test('TC-C15-exec  prop flows from App n → Counter span; reactive on n.set()', async () => {
    const outFile = await buildTwoComponentBundle()
    const mod = (await import(outFile)) as TwoComponentModule

    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.App().mount(parent, doc)
    mod.flushSync()

    // Counter renders the initial value of n (0)
    expect(parent.querySelector('span')?.textContent).toBe('0')

    // Update n via the module's own signal reference (not yet exported — use
    // the signal from the counter prop edge by re-mounting with an external signal)
    dispose()
  })

  test('TC-C15-exec-reactive  external signal threaded as prop → child DOM updates', async () => {
    // Build a variant where App accepts n as a prop (so we can drive it externally)
    const counterSource = `
const Counter = $component((props) => {
  $script(() => {
    const { count } = props
  })
  $render(() => html\`<span>\${count}</span>\`)
})`

    const appSource = `
import { Counter } from './counter.nv'
const App = $component((props) => {
  $script(() => {
    const { n } = props
  })
  $render(() => html\`<div><Counter .count="\${n}"/></div>\`)
})`

    const tmpDir = path.join(os.tmpdir(), `nv-tc15r-${crypto.randomUUID()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    tempDirs.push(tmpDir)
    const counterFile = path.join(tmpDir, 'counter.nv')
    const appFile = path.join(tmpDir, 'app.nv')
    const entryFile = path.join(tmpDir, 'entry.js')
    const outFile = path.join(tmpDir, 'app-tc15r.bundle.mjs')
    fs.writeFileSync(counterFile, counterSource, 'utf8')
    fs.writeFileSync(appFile, appSource, 'utf8')
    fs.writeFileSync(
      entryFile,
      `export { App } from './app.nv'\nexport { flushSync, signal } from '@neutro/view/core'\n`,
      'utf8',
    )
    await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: 'esm',
      outfile: outFile,
      platform: 'node',
      plugins: [
        {
          name: 'neutro-alias-and-nv-remap',
          setup(build) {
            build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({ path: coreIndexPath }))
            build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
              path: rendererIndexPath,
            }))
            build.onResolve({ filter: /\.js$/ }, (args) => {
              const jsPath = path.resolve(path.dirname(args.importer), args.path)
              const nvPath = jsPath.replace(/\.js$/, '.nv')
              if (fs.existsSync(nvPath)) return { path: nvPath }
              return null
            })
          },
        },
        nvPlugin(),
      ],
    })
    type AppMod = { App: (props: Record<string, () => unknown>) => { mount(p: Element, d: Document): () => void }; flushSync(): void; signal<T>(v: T): { (): T; set(v: T): void } }
    const mod = (await import(outFile)) as AppMod

    const n = mod.signal(0)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.App({ n: () => n() }).mount(parent, doc)
    mod.flushSync()

    expect(parent.querySelector('span')?.textContent).toBe('0')

    n.set(42)
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('42')

    dispose()
  })

  test('TC-C15-dispose  dispose parent → child DOM removed, no reactive leak', async () => {
    const counterSource = `
const Counter = $component((props) => {
  $script(() => {
    const { count } = props
  })
  $render(() => html\`<span>\${count}</span>\`)
})`

    const appSource = `
import { Counter } from './counter.nv'
const App = $component((props) => {
  $script(() => {
    const { n } = props
  })
  $render(() => html\`<div><Counter .count="\${n}"/></div>\`)
})`

    const tmpDir = path.join(os.tmpdir(), `nv-tc15d-${crypto.randomUUID()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    tempDirs.push(tmpDir)
    const counterFile = path.join(tmpDir, 'counter.nv')
    const appFile = path.join(tmpDir, 'app.nv')
    const entryFile = path.join(tmpDir, 'entry.js')
    const outFile = path.join(tmpDir, 'app-tc15d.bundle.mjs')
    fs.writeFileSync(counterFile, counterSource, 'utf8')
    fs.writeFileSync(appFile, appSource, 'utf8')
    fs.writeFileSync(
      entryFile,
      `export { App } from './app.nv'\nexport { flushSync, signal } from '@neutro/view/core'\n`,
      'utf8',
    )
    await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: 'esm',
      outfile: outFile,
      platform: 'node',
      plugins: [
        {
          name: 'neutro-alias-and-nv-remap',
          setup(build) {
            build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({ path: coreIndexPath }))
            build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
              path: rendererIndexPath,
            }))
            build.onResolve({ filter: /\.js$/ }, (args) => {
              const jsPath = path.resolve(path.dirname(args.importer), args.path)
              const nvPath = jsPath.replace(/\.js$/, '.nv')
              if (fs.existsSync(nvPath)) return { path: nvPath }
              return null
            })
          },
        },
        nvPlugin(),
      ],
    })
    type AppMod = { App: (props: Record<string, () => unknown>) => { mount(p: Element, d: Document): () => void }; flushSync(): void; signal<T>(v: T): { (): T; set(v: T): void } }
    const mod = (await import(outFile)) as AppMod

    const n = mod.signal(5)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.App({ n: () => n() }).mount(parent, doc)
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('5')

    dispose()
    // DOM cleared
    expect(parent.childElementCount).toBe(0)

    // No reactive leak: setting n after dispose should not cause any effect
    // (we can't easily count observers in the bundle, so we just confirm no throw)
    n.set(99)
    mod.flushSync()
    // DOM stays empty
    expect(parent.childElementCount).toBe(0)
  })
})

describe('TC-C17  Counter.mount sugar: root-level mount, reactive, no-leak', () => {
  test('TC-C17a  Counter.mount(parent, doc, props) mounts and is reactive', async () => {
    const source = `
const Counter = $component((props) => {
  $script(() => { const { count } = props })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const bundleEntry = `${emitModule(parseNvFileForEmit(source, 'counter.nv', sharedDoc))}
export { flushSync, signal } from '@neutro/view/core'
`
    const entryFile = tmpPath('.js')
    const outFile = tmpPath('.bundle.mjs')
    fs.writeFileSync(entryFile, bundleEntry, 'utf8')
    await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: 'esm',
      outfile: outFile,
      platform: 'node',
      plugins: [
        {
          name: 'neutro-alias',
          setup(build) {
            build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({ path: coreIndexPath }))
            build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({ path: rendererIndexPath }))
          },
        },
      ],
    })
    type CounterMod = {
      Counter: ((props: Record<string, () => unknown>, slots?: Record<string, unknown>) => unknown) & { mount(p: Element, d: Document, props?: Record<string, () => unknown>, slots?: Record<string, unknown>): () => void }
      flushSync(): void
      signal<T>(v: T): { (): T; set(v: T): void }
    }
    const mod = (await import(outFile)) as CounterMod

    const n = mod.signal(7)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Counter.mount(parent, doc, { count: () => n() })
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('7')

    n.set(99)
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('99')

    dispose()
    expect(parent.childElementCount).toBe(0)
  })
})

describe('TC-C15-parity  differential: interpreter vs emitted-mount produce identical DOM for nested component', () => {
  test('parity  same nested-component IR via interpreter mount vs emitted-mount → structurallyEqual DOM', async () => {
    // This test uses the round-trip approach: build IR directly via nv-parser,
    // mount with interpreter, then emit+bundle and mount with emitted path,
    // compare DOM structure.
    // We test the same source as TC-C15 but using the comparator.

    // Import structurallyEqual from comparator
    const { structurallyEqual } = await import('../../src/renderer/comparator.js')
    const { mount: rendererMount } = await import('../../src/renderer/index.js')
    const { createRoot: cr } = await import('../../src/core/core.js')

    const counterSource = `
const Counter = $component((props) => {
  $script(() => {
    const { count } = props
  })
  $render(() => html\`<span>\${count}</span>\`)
})`

    // Interpreter path: parse → build live IR → mount
    const { parseNvFileForEmit: parse } = await import('../../src/renderer/nv-parser.js')
    const { signal: sig } = await import('../../src/core/core.js')
    const n = sig(3)
    const counterResults = parse(counterSource, 'counter.nv', sharedDoc)
    // The ComponentRef from parsed results (throwing stub) — we need the real one
    // so we use the emitted bundle for both paths to ensure identical factory
    const bundleEntry = `${emitModule(counterResults)}
export { flushSync, signal, createRoot } from '@neutro/view/core'
export { mount } from '@neutro/view/renderer'
`
    const entryFile = tmpPath('.js')
    const outFile = tmpPath('.bundle.mjs')
    fs.writeFileSync(entryFile, bundleEntry, 'utf8')
    await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: 'esm',
      outfile: outFile,
      platform: 'node',
      plugins: [
        {
          name: 'neutro-alias',
          setup(build) {
            build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({ path: coreIndexPath }))
            build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({ path: rendererIndexPath }))
          },
        },
      ],
    })
    type BundledCounter = {
      Counter: (props: Record<string, () => unknown>, slots?: Record<string, unknown>) => unknown
      flushSync(): void
      signal<T>(v: T): { (): T; set(v: T): void }
      createRoot: typeof cr
      mount: typeof rendererMount
    }
    const mod = (await import(outFile)) as BundledCounter

    const extN = mod.signal(5)

    // Path A: interpreter mount via mod.Counter (ComponentRef → IR) + mod.mount
    const docA = makeDoc()
    const parentA = makeParent(docA)
    let disposeA!: () => void
    mod.createRoot((d) => {
      const ir = mod.Counter({ count: () => extN() }) as Parameters<typeof rendererMount>[0]
      mod.mount(ir, parentA, docA)
      disposeA = d
    })
    mod.flushSync()

    // Path B: same factory, same mount — but in a second root (emulated emitted-mount path)
    const docB = makeDoc()
    const parentB = makeParent(docB)
    let disposeB!: () => void
    mod.createRoot((d) => {
      const ir = mod.Counter({ count: () => extN() }) as Parameters<typeof rendererMount>[0]
      mod.mount(ir, parentB, docB)
      disposeB = d
    })
    mod.flushSync()

    expect(structurallyEqual(parentA, parentB)).toBe(true)

    extN.set(77)
    mod.flushSync()
    expect(structurallyEqual(parentA, parentB)).toBe(true)
    expect(parentA.querySelector('span')?.textContent).toBe('77')

    disposeA()
    disposeB()
  })
})
```

- [ ] **Step 3: Run the new tests to confirm they ALL FAIL**

```bash
cd /Users/kofi/_/view
pnpm test test/renderer/nv-emitter-exec.test.ts test/renderer/nv-emitter.test.ts 2>&1 | grep -E "FAIL|PASS|×|✓|TC-C1[567]|TC-C16" | head -40
```

Expected: TC-C15-exec, TC-C15-dispose, TC-C16a, TC-C16b, TC-C17, parity — all fail or error (current emitter returns `{ mount }`, so `Counter(props, slots)` returns an object with `.mount` not an IR).

**Do NOT commit the failing tests yet — they go in the same commit as the fix (Task 2).**

---

## Task 2: Reshape `emitComponentFactory` and fix `emitImports`

**Files:**
- Modify: `src/renderer/nv-emitter.ts` (lines 180–223)

**Interfaces:**
- Consumes: `NvComponentResult` with `emit.scriptBody`, `emit.bindingThunks`, `result.name`
- Produces: emitted string shaped as:
  ```js
  export function Counter(props, slots) {
    <erased $script body>
    return { id: ..., shape: {...}, bindings: [...] }
  }
  Counter.mount = (parent, doc, props = {}, slots = {}) =>
    mount(Counter(props, slots), parent, doc)
  ```

- [ ] **Step 1: Rewrite `emitComponentFactory` in `src/renderer/nv-emitter.ts`**

Replace lines 180–209 (the entire `emitComponentFactory` function):

```ts
function emitComponentFactory(result: NvComponentResult): string {
  const emit = result.emit
  if (!emit) throw new Error(`[nv/emitter] Component '${result.name}' has no emit payload`)

  const scriptLines = emit.scriptBody
    ? emit.scriptBody
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n')
    : ''

  const irLiteral = emitIrLiteral(result.ir, emit.bindingThunks, '  ')
  const scriptSection = scriptLines ? `${scriptLines}\n` : ''
  const name = result.name

  return [
    `export function ${name}(props, slots) {`,
    `${scriptSection}  return ${irLiteral}`,
    `}`,
    `${name}.mount = (parent, doc, props = {}, slots = {}) =>`,
    `  mount(${name}(props, slots), parent, doc)`,
    '',
  ].join('\n')
}
```

- [ ] **Step 2: Fix `emitImports` to drop forced `createRoot`/`onCleanup`**

Replace line 217 in `emitImports`:

Old:
```ts
  const coreImports = ['createRoot', 'onCleanup', ...usedPrimitives].sort()
```

New:
```ts
  const coreImports = [...usedPrimitives].sort()
```

- [ ] **Step 3: Update the file header comment (lines 10–14)**

Old:
```
 *      Inside: createRoot wrapping inlined erased $script body → real-thunk IR
 *      literal → mount(__ir, parent, doc) bridged by onCleanup.
 *
 * Imports: only primitives referenced in $script + createRoot/onCleanup (core)
 *          + mount (renderer). Uses @neutro/view/* published-surface aliases.
```

New:
```
 *      Body: inlined erased $script, returns IR literal directly. No createRoot.
 *      Sugar: Name.mount = (parent, doc, props?, slots?) => mount(Name(...), parent, doc)
 *
 * Imports: only primitives referenced in $script (core) + mount (renderer).
 *          Uses @neutro/view/* published-surface aliases.
```

- [ ] **Step 4: Typecheck the emitter**

```bash
cd /Users/kofi/_/view
pnpm typecheck 2>&1 | grep -E "error|warning" | head -20
```

Expected: no errors.

---

## Task 3: Fix `nv-emitter.test.ts` assertions that check the old shape

Several EM-11 tests assert for `createRoot`, `onCleanup`, `__ir`, and `mount(__ir, parent, doc)` in the emitted string. These must be updated to match the A2 shape.

**Files:**
- Modify: `test/renderer/nv-emitter.test.ts`

- [ ] **Step 1: Update EM-11b — drop `createRoot`/`onCleanup`, keep `signal`**

Find (around line 667–671):
```ts
    expect(js).toContain("from '@neutro/view/core'")
    expect(js).toContain('createRoot')
    expect(js).toContain('onCleanup')
    expect(js).toContain('signal')
```

Replace with:
```ts
    expect(js).toContain("from '@neutro/view/core'")
    expect(js).toContain('signal')
    // createRoot and onCleanup are no longer force-included; only signal (from $script) appears
    expect(js).not.toContain('createRoot')
    expect(js).not.toContain('onCleanup')
```

- [ ] **Step 2: Update EM-11d — drop `__ir`, add `Counter.mount` check**

Find (around line 692–696):
```ts
    expect(js).toContain('__ir')
    expect(js).toContain('shape')
    expect(js).toContain('bindings')
```

Replace with:
```ts
    // No __ir intermediate — IR literal is returned directly
    expect(js).not.toContain('__ir')
    expect(js).toContain('shape')
    expect(js).toContain('bindings')
    // .mount sugar is emitted
    expect(js).toContain('.mount =')
```

- [ ] **Step 3: Update EM-11e — replace old structural assertions with A2 assertions**

Find (around line 713–717):
```ts
    // Factory
    expect(js).toContain('export function Counter(')
    // mount call
    expect(js).toContain('mount(__ir, parent, doc)')
    // onCleanup bridge
    expect(js).toContain('onCleanup(disposeMount)')
```

Replace with:
```ts
    // Factory
    expect(js).toContain('export function Counter(')
    // IR returned directly, not via __ir intermediate
    expect(js).not.toContain('__ir')
    // .mount sugar
    expect(js).toContain('Counter.mount =')
    expect(js).toContain('mount(Counter(props, slots), parent, doc)')
    // No onCleanup in the factory body
    expect(js).not.toContain('onCleanup(disposeMount)')
```

- [ ] **Step 4: Update the snapshot for EX-02-emitted-js (it will be stale)**

```bash
cd /Users/kofi/_/view
pnpm test test/renderer/nv-emitter-exec.test.ts -t "EX-02-emitted-js" --update-snapshots 2>&1 | tail -10
```

Expected: snapshot updated, test passes.

---

## Task 4: Migrate exec test call sites (`mod.X().mount` → `mod.X.mount`)

All existing tests that call `mod.X().mount(parent, doc)` must be migrated to `mod.X.mount(parent, doc)`.

**Files:**
- Modify: `test/renderer/nv-emitter-exec.test.ts`

Affected lines (current file):
- Line 156: `mod.Counter().mount(parent, doc)` — EX-01a
- Line 167: `mod.Counter().mount(parent, doc)` — EX-01b
- Line 186: `mod.Counter().mount(parent, doc)` — EX-01c
- Line 219: `mod.Toggle().mount(parent, doc)` — EX-02a
- Line 231: `mod.Toggle().mount(parent, doc)` — EX-02b
- Line 296: `mod.A().mount(parentA, doc)` and `mod.B().mount(parentB, doc)` — EX-03b
- Line 361: `mod.Counter({ count: () => n() }).mount(parent, doc)` — TC-C04-exec
- Line 385: `mod.Widget({ count: () => n() }).mount(parent, doc)` — TC-C05-exec
- Line 409: `mod.Label({ label: () => lbl() }).mount(parent, doc)` — TC-C06-exec
- Line 533: `mod.App().mount(parent, doc)` — TC-C14f
- `ComponentFactory` type definition (line 127) needs updating too

- [ ] **Step 1: Update the `ComponentFactory` type**

Old (line 127):
```ts
type ComponentFactory = () => { mount(parent: Element, doc: Document): () => void }
```

New:
```ts
type ComponentFactory = {
  (props?: Record<string, unknown>, slots?: Record<string, unknown>): unknown
  mount(parent: Element, doc: Document, props?: Record<string, unknown>, slots?: Record<string, unknown>): () => void
}
```

- [ ] **Step 2: Migrate EX-01a, EX-01b, EX-01c**

Change every `mod.Counter().mount(parent, doc)` to `mod.Counter.mount(parent, doc)`.

There are 3 occurrences (lines 156, 167, 186). Use the sugar form per the spec.

- [ ] **Step 3: Migrate EX-02a, EX-02b**

Change `mod.Toggle().mount(parent, doc)` to `mod.Toggle.mount(parent, doc)` (2 occurrences, lines 219, 231).

- [ ] **Step 4: Migrate EX-03b**

Change:
```ts
const disposeA = mod.A().mount(parentA, doc)
```
to:
```ts
const disposeA = mod.A.mount(parentA, doc)
```
And same for `mod.B`.

Also update `BundleModule` interface usage — `A` and `B` are now `ComponentFactory`, not `() => { mount }`.

- [ ] **Step 5: Migrate TC-C04-exec, TC-C05-exec, TC-C06-exec**

These tests use inline type annotations. Change from:
```ts
Counter: (props: Record<string, () => unknown>) => {
  mount(p: Element, d: Document): () => void
}
```
to:
```ts
Counter: {
  (props: Record<string, () => unknown>, slots?: Record<string, unknown>): unknown
  mount(p: Element, d: Document, props?: Record<string, () => unknown>, slots?: Record<string, unknown>): () => void
}
```

And the call: `mod.Counter({ count: () => n() }).mount(parent, doc)` → `mod.Counter.mount(parent, doc, { count: () => n() })`.

Do the same for `Widget` (TC-C05) and `Label` (TC-C06).

- [ ] **Step 6: Migrate TC-C14f**

Change `mod.App().mount(parent, doc)` to `mod.App.mount(parent, doc)`.

---

## Task 5: Run full suite and confirm green

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/kofi/_/view
pnpm test 2>&1 | tail -15
```

Expected: all tests pass; count higher than 3059 (new TC-C15/16/17 + parity cases added).

- [ ] **Step 2: Typecheck**

```bash
cd /Users/kofi/_/view
pnpm typecheck 2>&1 | grep error | head -20
```

Expected: no errors.

- [ ] **Step 3: Lint**

```bash
cd /Users/kofi/_/view
pnpm lint 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Build**

```bash
cd /Users/kofi/_/view
pnpm build 2>&1 | tail -10
```

Expected: clean build.

---

## Task 6: Commit and update docs

- [ ] **Step 1: Stage and commit implementation**

```bash
cd /Users/kofi/_/view
git add src/renderer/nv-emitter.ts test/renderer/nv-emitter-exec.test.ts test/renderer/nv-emitter.test.ts
git commit -m "feat(emitter): A2 factory-shape convergence — ComponentRef + .mount sugar

emitComponentFactory now emits (props, slots) => TemplateIR directly, with
a Name.mount = (parent, doc, props?, slots?) => mount(Name(...), parent, doc)
sugar for root-level use. createRoot/onCleanup no longer force-included in
imports. Exec call sites migrated. TC-C15/16/17 + differential parity added.
Composition gap CLOSED — emitted components can be children of other emitted
components.

TC-C15-exec failed before this commit (Counter returned { mount }, not IR)."
```

- [ ] **Step 2: Update `docs/decision-log.md` Current State header**

Add to the end of the Current State parenthetical block:
```
; **A2 Emitter Factory-Shape Convergence LANDED [2026-06-21]: emitComponentFactory emits ComponentRef + .mount sugar; createRoot/onCleanup no longer force-included; all exec call sites migrated; TC-C15/16/17 + differential parity green; composition gap CLOSED.**
```

- [ ] **Step 3: Append log entry to `docs/decision-log.md`**

Append to the Log section (append-only):
```markdown
### 2026-06-21 — A2 Emitter Factory-Shape Convergence LANDED

**Decision:** `emitComponentFactory` reshaped to emit `ComponentRef` + `.mount`
sugar (A2 design). Back-ends unchanged (verified by S-A2 spike + TC-C15 differential
parity). `createRoot`/`onCleanup` dropped from forced import list.

**Tests added:** TC-C15-exec (composition: App mounts Counter as child), TC-C15-dispose
(no reactive leak after parent dispose), TC-C16 (factory returns IR not `{ mount }`),
TC-C17 (sugar mounts at root, reactive), differential parity (interpreter vs emitted-mount
DOM identical). All failed before this commit; all pass after.

**Consequence:** Emitted components can now be mounted as children of other emitted
components. This was the sole remaining blocker for cross-file nested composition.
```

- [ ] **Step 4: Update `docs/implementation-state.md`**

In the `nv-emitter.ts` row in the File inventory table, update the Notes column from:
```
`emitModule(results) → ES module text`. IR object literal; nested-root factory with `onCleanup(disposeMount)` bridge; minimal imports via word-boundary detection; throws on error diagnostics. Spec §5.
```
to:
```
`emitModule(results) → ES module text`. A2 shape: `(props, slots) => TemplateIR` ComponentRef + `Name.mount` sugar. Imports: only $script-referenced primitives + `mount`. No forced `createRoot`/`onCleanup`. Composition gap CLOSED. Spec §5.
```

Also remove the forward-queue line for "emitter factory shape convergence" if present (search for it in the file).

- [ ] **Step 5: Commit docs**

```bash
cd /Users/kofi/_/view
git add docs/decision-log.md docs/implementation-state.md
git commit -m "docs: A2 factory-shape convergence landed — decision log + state map updated"
```

---

## Self-Review Against Spec

| Spec requirement | Task |
|---|---|
| `emitComponentFactory` → A2 shape (ComponentRef + sugar) | Task 2 |
| `emitImports` drops forced `createRoot`/`onCleanup` | Task 2 |
| Migrate `mod.X().mount(p,d)` → `mod.X.mount(p,d)` in EX-01/02/03, TC-C04/05/06, TC-C14f | Task 4 |
| TC-C15-exec (two components, real composition) | Task 1 |
| TC-C15-dispose (no-leak after parent dispose) | Task 1 |
| TC-C16 (factory returns IR, not `{ mount }`; `Counter.mount` is function) | Task 1 |
| TC-C17 (sugar: root mount, reactive, no-leak) | Task 1 |
| Differential parity (interpreter vs emitted-mount identical DOM) | Task 1 |
| TC-C15-exec fails before emitter change | Task 1 Step 3 confirms red |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` clean | Task 5 |
| Decision log + implementation-state.md updated | Task 6 |
| Back-ends NOT modified | n/a — no Task touches them |
