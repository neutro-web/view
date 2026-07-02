/**
 * nv Build Pipeline — Executable-Module Gate
 * Stream: (3) Renderer/templating
 * Spec: docs/design/build-pipeline-modeA-spec.md §9
 *
 * Tests:
 *   EX-01  Counter  (text + event + mutation-write)
 *   EX-02  Conditional (conditional literal in emitThunkSource/emitIrLiteral)
 *   EX-03  Multi-component file (A and B both exported, both mount correctly)
 *
 * Strategy:
 *   1. parseNvFileForEmit → emitModule → emitted JS string
 *   2. Write emitted JS to a temp file in os.tmpdir()
 *   3. Bundle with esbuild, aliasing @neutro/view/core → src/core/index.ts
 *      and @neutro/view/renderer → src/renderer/index.ts
 *   4. dynamic import() the bundle
 *   5. Call component().mount(parent, doc), flushSync(), assert DOM
 *   6. Clean up temp files
 *
 * This proves the *emitted module string*, when actually executed as ESM,
 * produces correct DOM — complementing nv-emitter.test.ts which verifies
 * erased thunk sources via new Function().
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as esbuild from 'esbuild'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, test } from 'vitest'
import { emitModule } from '../../src/renderer/nv-emitter.js'
import { nvPlugin, rewriteNvSpecifiers } from '../../src/renderer/nv-esbuild-plugin.js'
import { parseNvFileForEmit } from '../../src/renderer/nv-parser.js'

// ── Absolute paths for esbuild alias resolution ───────────────────────────────

const repoRoot = path.resolve(import.meta.dirname, '../..')
const coreIndexPath = path.join(repoRoot, 'src/core/index.ts')
const rendererIndexPath = path.join(repoRoot, 'src/renderer/index.ts')
const rendererRuntimePath = path.join(repoRoot, 'src/renderer/runtime.ts')

// ── Test environment ──────────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const sharedDoc = dom.window.document as unknown as Document

function makeDoc() {
  const d = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  return d.window.document as unknown as Document
}

function makeParent(doc: Document): Element {
  return doc.createElement('div')
}

// ── Temp file tracking (cleaned up in afterEach) ──────────────────────────────

const tempFiles: string[] = []
const tempDirs: string[] = []

function tmpPath(suffix: string): string {
  const name = `nv-exec-${crypto.randomUUID()}${suffix}`
  const p = path.join(os.tmpdir(), name)
  tempFiles.push(p)
  return p
}

afterEach(() => {
  for (const f of tempFiles.splice(0)) {
    try {
      fs.unlinkSync(f)
    } catch {
      // ignore — already cleaned or never created
    }
  }
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

// ── esbuild bundle helper ─────────────────────────────────────────────────────

/**
 * Write emitted JS to a temp file, bundle it with esbuild resolving
 * @neutro/view/* aliases to src/. The entry also re-exports flushSync from
 * @neutro/view/core so the test uses the same scheduler instance as the bundle.
 * Returns the path of the output bundle.
 */
async function bundleEmittedJs(emittedJs: string): Promise<string> {
  const entryFile = tmpPath('.js')
  const outFile = tmpPath('.bundle.mjs')

  // Append re-export of flushSync so callers share one scheduler instance.
  const withFlushSync = `${emittedJs}\nexport { flushSync } from '@neutro/view/core'\n`

  fs.writeFileSync(entryFile, withFlushSync, 'utf8')

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
          build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({
            path: coreIndexPath,
          }))
          build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
            path: rendererIndexPath,
          }))
          build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
            path: rendererRuntimePath,
          }))
        },
      },
    ],
  })

  return outFile
}

// ── Bundle module type ────────────────────────────────────────────────────────

type ComponentFactory = {
  (props?: Record<string, unknown>, slots?: Record<string, unknown>): unknown
  mount(
    parent: Element,
    doc: Document,
    props?: Record<string, unknown>,
    slots?: Record<string, unknown>,
  ): () => void
}

interface BundleModule {
  flushSync(): void
  [name: string]: unknown
}

// ── EX-01: Counter ────────────────────────────────────────────────────────────

describe('EX-01  Counter: emitted module executes — text + event + mutation-write', () => {
  const source = `
const Counter = $component(() => {
  $script(() => {
    const count = signal(0)
  })
  $render(() => html\`<span>\${count}</span><button @click="\${() => count = count + 1}">+</button>\`)
})`

  async function buildCounter() {
    const results = parseNvFileForEmit(source, 'counter.nv', sharedDoc)
    const js = emitModule(results)
    const bundlePath = await bundleEmittedJs(js)
    return (await import(bundlePath)) as BundleModule & { Counter: ComponentFactory }
  }

  test('EX-01a  init: span text is "0"', async () => {
    const mod = await buildCounter()
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Counter.mount(parent, doc)
    mod.flushSync()

    expect(parent.querySelector('span')?.textContent).toBe('0')
    dispose()
  })

  test('EX-01b  click → "1", click → "2"', async () => {
    const mod = await buildCounter()
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Counter.mount(parent, doc)
    mod.flushSync()

    const btn = parent.querySelector('button')!
    btn.dispatchEvent(new dom.window.Event('click'))
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('1')

    btn.dispatchEvent(new dom.window.Event('click'))
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('2')

    dispose()
  })

  test('EX-01c  dispose → all mounted root elements removed from parent', async () => {
    // The Counter template has two root elements (span + button). Both back-ends
    // now track all roots; dispose must remove every root (no leaks).
    const mod = await buildCounter()
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Counter.mount(parent, doc)
    mod.flushSync()

    expect(parent.querySelector('span')).not.toBeNull()
    dispose()
    expect(parent.childElementCount).toBe(0)
  })
})

// ── EX-02: Conditional ───────────────────────────────────────────────────────

describe('EX-02  Conditional: emitted module exercises conditional literal', () => {
  const source = `
const Toggle = $component(() => {
  $script(() => {
    const show = signal(true)
  })
  $render(() => html\`<div>\${show ? html\`<span>yes</span>\` : html\`<span>no</span>\`}</div><button @click="\${() => show = !show}">flip</button>\`)
})`

  async function buildToggle() {
    const results = parseNvFileForEmit(source, 'toggle.nv', sharedDoc)
    const js = emitModule(results)
    const bundlePath = await bundleEmittedJs(js)
    return (await import(bundlePath)) as BundleModule & { Toggle: ComponentFactory }
  }

  test('EX-02a  init: div contains span with "yes"', async () => {
    const mod = await buildToggle()
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Toggle.mount(parent, doc)
    mod.flushSync()

    const div = parent.querySelector('div')
    expect(div).not.toBeNull()
    expect(div!.querySelector('span')?.textContent).toBe('yes')
    dispose()
  })

  test('EX-02b  click → "no", click → "yes"', async () => {
    const mod = await buildToggle()
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Toggle.mount(parent, doc)
    mod.flushSync()

    const btn = parent.querySelector('button')!
    btn.dispatchEvent(new dom.window.Event('click'))
    mod.flushSync()
    expect(parent.querySelector('div')!.querySelector('span')?.textContent).toBe('no')

    btn.dispatchEvent(new dom.window.Event('click'))
    mod.flushSync()
    expect(parent.querySelector('div')!.querySelector('span')?.textContent).toBe('yes')
    dispose()
  })

  test('EX-02-emitted-js  conditional fixture emitted JS snapshot', () => {
    const results = parseNvFileForEmit(source, 'toggle.nv', sharedDoc)
    const js = emitModule(results)
    // Structural checks on the emitted JS
    expect(js).toContain('conditional')
    expect(js).toContain('show()')
    expect(js).toContain('export function Toggle(')
    // The emitted JS is captured in the test snapshot for the report.
    // Uncomment to view during debug:
    // console.log('EX-02 emitted JS:\n', js)
    expect(js).toMatchSnapshot()
  })
})

// ── EX-03: Multi-component file ───────────────────────────────────────────────

describe('EX-03  Multi-component: A and B both exported and mount correctly', () => {
  const source = `
const A = $component(() => {
  $script(() => {
    const x = signal('hello')
  })
  $render(() => html\`<p>\${x}</p>\`)
})

const B = $component(() => {
  $script(() => {
    const y = signal('world')
  })
  $render(() => html\`<p>\${y}</p>\`)
})`

  async function buildMulti() {
    const results = parseNvFileForEmit(source, 'multi.nv', sharedDoc)
    const js = emitModule(results)
    const bundlePath = await bundleEmittedJs(js)
    return (await import(bundlePath)) as BundleModule & { A: ComponentFactory; B: ComponentFactory }
  }

  test('EX-03a  both A and B are exported from the bundle', async () => {
    const mod = await buildMulti()
    expect(typeof mod.A).toBe('function')
    expect(typeof mod.B).toBe('function')
  })

  test('EX-03b  mount A → text is "hello", mount B → text is "world"', async () => {
    const mod = await buildMulti()
    const doc = makeDoc()

    const parentA = makeParent(doc)
    const disposeA = mod.A.mount(parentA, doc)
    mod.flushSync()
    expect(parentA.querySelector('p')?.textContent).toBe('hello')

    const parentB = makeParent(doc)
    const disposeB = mod.B.mount(parentB, doc)
    mod.flushSync()
    expect(parentB.querySelector('p')?.textContent).toBe('world')

    disposeA()
    disposeB()
  })
})

// ── TC-C04-exec / TC-C05-exec / TC-C06-exec: Props-erasure liveness ──────────

async function bundleComponentWithSignal(source: string, name: string): Promise<string> {
  const js = emitModule(parseNvFileForEmit(source, `${name.toLowerCase()}.nv`, sharedDoc))
  const withExports = `${js}\nexport { flushSync, signal } from '@neutro/view/core'\n`
  const entryFile = tmpPath('.js')
  const outFile = tmpPath('.bundle.mjs')
  fs.writeFileSync(entryFile, withExports, 'utf8')
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
          build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
            path: rendererIndexPath,
          }))
          build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
            path: rendererRuntimePath,
          }))
        },
      },
    ],
  })
  return outFile
}

type SignalBundleModule = {
  flushSync(): void
  signal<T>(v: T): { (): T; set(v: T): void }
  [name: string]: unknown
}

describe('TC-C04-exec / TC-C05-exec / TC-C06-exec  props-erasure liveness', () => {
  test('TC-C04-exec  simple destructure: { count } = props → DOM reactive to external signal', async () => {
    const source = `
const Counter = $component((props) => {
  $script(() => { const { count } = props })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const bundlePath = await bundleComponentWithSignal(source, 'Counter')
    const mod = (await import(bundlePath)) as SignalBundleModule & {
      Counter: {
        (props: Record<string, () => unknown>, slots?: Record<string, unknown>): unknown
        mount(
          p: Element,
          d: Document,
          props?: Record<string, () => unknown>,
          slots?: Record<string, unknown>,
        ): () => void
      }
    }
    const n = mod.signal(0)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Counter.mount(parent, doc, { count: () => n() })
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('0')
    n.set(7)
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('7')
    dispose()
  })

  test('TC-C05-exec  alias destructure: { count: c } = props → DOM reactive to external signal', async () => {
    const source = `
const Widget = $component((props) => {
  $script(() => { const { count: c } = props })
  $render(() => html\`<span>\${c}</span>\`)
})`
    const bundlePath = await bundleComponentWithSignal(source, 'Widget')
    const mod = (await import(bundlePath)) as SignalBundleModule & {
      Widget: {
        (props: Record<string, () => unknown>, slots?: Record<string, unknown>): unknown
        mount(
          p: Element,
          d: Document,
          props?: Record<string, () => unknown>,
          slots?: Record<string, unknown>,
        ): () => void
      }
    }
    const n = mod.signal(0)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Widget.mount(parent, doc, { count: () => n() })
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('0')
    n.set(42)
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('42')
    dispose()
  })

  test('TC-C06-exec  rest member: ...rest / rest.label → DOM reactive to external signal', async () => {
    const source = `
const Label = $component((props) => {
  $script(() => { const { ...rest } = props })
  $render(() => html\`<span>\${rest.label}</span>\`)
})`
    const bundlePath = await bundleComponentWithSignal(source, 'Label')
    const mod = (await import(bundlePath)) as SignalBundleModule & {
      Label: {
        (props: Record<string, () => unknown>, slots?: Record<string, unknown>): unknown
        mount(
          p: Element,
          d: Document,
          props?: Record<string, () => unknown>,
          slots?: Record<string, unknown>,
        ): () => void
      }
    }
    const lbl = mod.signal('hello')
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Label.mount(parent, doc, { label: () => lbl() })
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('hello')
    lbl.set('world')
    mod.flushSync()
    expect(parent.querySelector('span')?.textContent).toBe('world')
    dispose()
  })
})

// ── TC-C14: Cross-file component imports — .nv specifier rewrite ───────────────

describe('TC-C14  cross-file component imports — .nv → .js specifier rewrite', () => {
  test('TC-C14a  rewriteNvSpecifiers rewrites single-quoted .nv specifier', () => {
    const src = `import { Counter } from './counter.nv'`
    const rewritten = rewriteNvSpecifiers(src)
    expect(rewritten).toBe(`import { Counter } from './counter.js'`)
  })

  test('TC-C14b  rewriteNvSpecifiers rewrites double-quoted .nv specifier', () => {
    const src = `import { Counter } from "./counter.nv"`
    const rewritten = rewriteNvSpecifiers(src)
    expect(rewritten).toBe(`import { Counter } from "./counter.js"`)
  })

  test('TC-C14c  rewriteNvSpecifiers rewrites multiple .nv specifiers', () => {
    const src = `import { Counter } from './counter.nv'\nimport { Button } from "./button.nv"`
    const rewritten = rewriteNvSpecifiers(src)
    expect(rewritten).toContain(`from './counter.js'`)
    expect(rewritten).toContain(`from "./button.js"`)
  })

  test('TC-C14d  rewriteNvSpecifiers preserves non-.nv imports', () => {
    const src = `import { Counter } from './counter.nv'\nimport { signal } from '@neutro/view/core'`
    const rewritten = rewriteNvSpecifiers(src)
    expect(rewritten).toContain(`from './counter.js'`)
    expect(rewritten).toContain(`from '@neutro/view/core'`)
  })

  test('TC-C14f  two-file esbuild bundle: Counter imported by App renders prop value', async () => {
    // counter.nv: simple component that renders a count prop (exported, imported by App)
    const counterSource = `
const Counter = $component((props) => {
  $script(() => {
    const { count } = props
  })
  $render(() => html\`<span>\${count}</span>\`)
})`

    // app.nv: imports Counter (cross-file bundle proves .nv plugin chains) and renders
    // its own reactive state. Counter is referenced to prevent tree-shaking; it is parsed
    // by nvPlugin when app.nv is bundled, proving the two-file pipeline.
    // Note: mounting Counter as a child element is covered end-to-end by TC-C15/16/17 below
    // (cross-file child render, reactive prop threading, dispose-no-leak, ComponentRef parity).
    // TC-C14f intentionally only proves the two-file bundle/plugin chain (void Counter).
    const appSource = `
import { Counter } from './counter.nv'
const App = $component(() => {
  $script(() => {
    const n = signal(0)
    void Counter
  })
  $render(() => html\`<p>\${n}</p><button @click="\${() => n = n + 1}">+</button>\`)
})`

    // Write both .nv files to a shared temp dir so './counter.nv' resolves correctly
    const tmpDir = path.join(os.tmpdir(), `nv-exec-tc14f-${crypto.randomUUID()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    tempDirs.push(tmpDir)
    const counterFile = path.join(tmpDir, 'counter.nv')
    const appFile = path.join(tmpDir, 'app.nv')
    // Entry wrapper re-exports App from app.nv + flushSync so callers share one scheduler
    const entryFile = path.join(tmpDir, 'entry.js')
    const outFile = path.join(tmpDir, 'app.bundle.mjs')
    fs.writeFileSync(counterFile, counterSource, 'utf8')
    fs.writeFileSync(appFile, appSource, 'utf8')
    fs.writeFileSync(
      entryFile,
      `export { App } from './app.nv'\nexport { flushSync } from '@neutro/view/core'\n`,
      'utf8',
    )

    // Bundle app.nv through esbuild using the real nvPlugin().
    // nvPlugin rewrites .nv → .js in emitted source, so we also need a resolver
    // that maps .js back to the original .nv file on disk.
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
            build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({
              path: coreIndexPath,
            }))
            build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
              path: rendererIndexPath,
            }))
            build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
              path: rendererRuntimePath,
            }))
            // Remap .js imports that originated from .nv specifiers back to .nv
            // so nvPlugin can pick them up (nvPlugin rewrites .nv→.js in emitted source)
            build.onResolve({ filter: /\.js$/ }, (args) => {
              const jsPath = path.resolve(path.dirname(args.importer), args.path)
              const nvPath = jsPath.replace(/\.js$/, '.nv')
              if (fs.existsSync(nvPath)) {
                return { path: nvPath }
              }
              return null
            })
          },
        },
        nvPlugin(),
      ],
    })

    const mod = (await import(outFile)) as { App: ComponentFactory; flushSync: () => void }

    // App is exported from the bundle (Counter is bundled but not re-exported)
    expect(typeof mod.App).toBe('function')

    // Mount App and verify it renders correctly
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.App.mount(parent, doc)
    mod.flushSync()

    // App renders a <p> showing "0"
    expect(parent.querySelector('p')?.textContent).toBe('0')

    // Click button → n increments → DOM updates (proves reactivity end-to-end)
    const btn = parent.querySelector('button')
    btn?.dispatchEvent(new dom.window.MouseEvent('click'))
    mod.flushSync()
    expect(parent.querySelector('p')?.textContent).toBe('1')

    dispose()
  })

  test('TC-C14e  emitModule output can be rewritten by rewriteNvSpecifiers', () => {
    // Create a source that imports from another .nv file
    const parentSource = `
const Parent = $component(() => {
  $script(() => {
    const msg = signal('parent')
  })
  $render(() => html\`<div>\${msg}</div>\`)
})`

    const results = parseNvFileForEmit(parentSource, 'parent.nv', sharedDoc)
    const emitted = emitModule(results)
    const rewritten = rewriteNvSpecifiers(emitted)

    // Verify emitted JS is valid after rewrite
    // (rewrite should not break the structure even if no .nv imports are present)
    expect(typeof rewritten).toBe('string')
    // No .nv specifiers should remain in the output (all were rewritten or none existed)
    expect(rewritten).not.toContain('.nv')
    expect(rewritten).toContain('export function Parent(')
  })
})

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
          build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
            path: rendererRuntimePath,
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
  App: {
    (props?: Record<string, unknown>, slots?: Record<string, unknown>): unknown
    mount(
      p: Element,
      d: Document,
      props?: Record<string, unknown>,
      slots?: Record<string, unknown>,
    ): () => void
  }
  flushSync(): void
  signal<T>(v: T): { (): T; set(v: T): void }
}

describe('TC-C15  two-component composition: App mounts Counter as child', () => {
  test('TC-C15-exec  composition: App mounts Counter as child; initial render shows "0"', async () => {
    const outFile = await buildTwoComponentBundle()
    const mod = (await import(outFile)) as TwoComponentModule

    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.App.mount(parent, doc)
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
            build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
              path: rendererRuntimePath,
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
    type AppMod = {
      App: {
        (props: Record<string, () => unknown>, slots?: Record<string, unknown>): unknown
        mount(
          p: Element,
          d: Document,
          props?: Record<string, () => unknown>,
          slots?: Record<string, unknown>,
        ): () => void
      }
      flushSync(): void
      signal<T>(v: T): { (): T; set(v: T): void }
    }
    const mod = (await import(outFile)) as AppMod

    const n = mod.signal(0)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.App.mount(parent, doc, { n: () => n() })
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
            build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
              path: rendererRuntimePath,
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
    type AppMod = {
      App: {
        (props: Record<string, () => unknown>, slots?: Record<string, unknown>): unknown
        mount(
          p: Element,
          d: Document,
          props?: Record<string, () => unknown>,
          slots?: Record<string, unknown>,
        ): () => void
      }
      flushSync(): void
      signal<T>(v: T): { (): T; set(v: T): void }
    }
    const mod = (await import(outFile)) as AppMod

    const n = mod.signal(5)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.App.mount(parent, doc, { n: () => n() })
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
            build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
              path: rendererIndexPath,
            }))
            build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
              path: rendererRuntimePath,
            }))
          },
        },
      ],
    })
    type CounterMod = {
      Counter: ((
        props: Record<string, () => unknown>,
        slots?: Record<string, unknown>,
      ) => unknown) & {
        mount(
          p: Element,
          d: Document,
          props?: Record<string, () => unknown>,
          slots?: Record<string, unknown>,
        ): () => void
      }
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

// ── TC-C16: ComponentRef shape — no mount method on instance ─────────────────

describe('TC-C16  emitted factory returns ComponentRef, not { mount }', () => {
  const tc16Source = `
const Counter = $component((props) => {
  $script(() => { const { count } = props })
  $render(() => html\`<span>\${count}</span>\`)
})`

  test('TC-C16a  Counter(props, slots) returns object with shape + bindings, no .mount', async () => {
    const results = parseNvFileForEmit(tc16Source, 'counter.nv', sharedDoc)
    const js = emitModule(results)
    const bundlePath = await bundleEmittedJs(js)
    const mod = (await import(bundlePath)) as BundleModule & {
      Counter: (props: Record<string, unknown>, slots: Record<string, unknown>) => unknown
    }
    const ir = mod.Counter({}, {})
    // Must be a plain object with shape/bindings
    expect(ir).toBeDefined()
    expect(typeof ir).toBe('object')
    expect((ir as Record<string, unknown>).shape).toBeDefined()
    expect((ir as Record<string, unknown>).bindings).toBeDefined()
    // Must NOT have a .mount method on the returned IR
    expect((ir as Record<string, unknown>).mount).toBeUndefined()
  })

  test('TC-C16b  Counter.mount is a function (sugar on the factory)', async () => {
    const results = parseNvFileForEmit(tc16Source, 'counter.nv', sharedDoc)
    const js = emitModule(results)
    const bundlePath = await bundleEmittedJs(js)
    const mod = (await import(bundlePath)) as BundleModule & {
      Counter: { mount?: unknown }
    }
    expect(typeof mod.Counter.mount).toBe('function')
  })
})

describe('TC-C15-parity  emitted ComponentRef is a valid ComponentRef: two independent interpreter mounts produce identical DOM', () => {
  test('parity  two createRoot+mount calls on the same emitted Counter factory produce structurallyEqual DOM before and after prop update', async () => {
    // Confirms the emitted Counter is a valid ComponentRef: the same factory can be
    // called twice (in two independent roots) and produce identical reactive DOM.
    // emitted-mount.ts back-end differential is covered by test/compiler/emitted-mount.test.ts (TC-C01..C13).

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
export { mount } from '@neutro/view/renderer/runtime'
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
            build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
              path: rendererIndexPath,
            }))
            build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
              path: rendererRuntimePath,
            }))
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

    // Path B: same factory, same interpreter mount — in a second independent root
    const docB = makeDoc()
    const parentB = makeParent(docB)
    let disposeB!: () => void
    mod.createRoot((d) => {
      const ir = mod.Counter({ count: () => extN() }) as Parameters<typeof rendererMount>[0]
      mod.mount(ir, parentB, docB)
      disposeB = d
    })
    mod.flushSync()

    expect(structurallyEqual(parentA, parentB).equal).toBe(true)

    extN.set(77)
    mod.flushSync()
    expect(structurallyEqual(parentA, parentB).equal).toBe(true)
    expect(parentA.querySelector('span')?.textContent).toBe('77')

    disposeA()
    disposeB()
  })
})

// ── EX-EACH-01..05: each authoring — .nv behavioral e2e ──────────────────────

/**
 * Shared builder for each-authoring exec tests.
 * Emits a List component with .nv <each>, bundles it, and exports
 * flushSync + signal from core so callers share one scheduler instance.
 */
async function buildListBundle(source: string): Promise<string> {
  const js = emitModule(parseNvFileForEmit(source, 'list.nv', sharedDoc))
  const withExports = `${js}\nexport { flushSync, signal } from '@neutro/view/core'\n`
  const entryFile = tmpPath('.js')
  const outFile = tmpPath('.bundle.mjs')
  fs.writeFileSync(entryFile, withExports, 'utf8')
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
          build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
            path: rendererIndexPath,
          }))
          build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
            path: rendererRuntimePath,
          }))
        },
      },
    ],
  })
  return outFile
}

type ListBundleModule = {
  List: ComponentFactory
  flushSync(): void
  signal<T>(v: T): { (): T; set(v: T): void }
}

// ── EX-EACH-01: initial render ────────────────────────────────────────────────

describe('EX-EACH-01  initial render: <each> mounts N items with correct text', () => {
  const source = `
const List = $component(() => {
  $script(() => {
    const items = signal([
      { id: 1, label: 'Alpha' },
      { id: 2, label: 'Beta' },
      { id: 3, label: 'Gamma' },
    ])
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(i) => i.id}" let={item}><li>\${item.label}</li></each></ul>\`)
})`

  test('EX-EACH-01  initial render — 3 <li> in correct order', async () => {
    const outFile = await buildListBundle(source)
    const mod = (await import(outFile)) as ListBundleModule
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.List.mount(parent, doc)
    mod.flushSync()

    const lis = parent.querySelectorAll('li')
    expect(lis.length).toBe(3)
    expect(lis[0]!.textContent).toBe('Alpha')
    expect(lis[1]!.textContent).toBe('Beta')
    expect(lis[2]!.textContent).toBe('Gamma')

    dispose()
  })
})

// ── EX-EACH-02: item reactivity + node identity (Variant-A proof) ─────────────

describe('EX-EACH-02  item reactivity: value-change updates DOM; node identity preserved (Variant-A .nv proof)', () => {
  /**
   * We drive items reactivity via an external signal threaded as a prop so the
   * test controls it directly — same pattern as TC-C04-exec / TC-C05-exec.
   * The component accepts `items` as a prop (prop-erasure → () => extItems())
   */
  const source = `
const List = $component((props) => {
  $script(() => {
    const { items } = props
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(i) => i.id}" let={item}><li>\${item.label}</li></each></ul>\`)
})`

  test('EX-EACH-02  value change at kept key — text updates, node identity preserved', async () => {
    const outFile = await buildListBundle(source)
    type Mod = {
      List: {
        (props: Record<string, () => unknown>, slots?: Record<string, unknown>): unknown
        mount(
          p: Element,
          d: Document,
          props?: Record<string, () => unknown>,
          slots?: Record<string, unknown>,
        ): () => void
      }
      flushSync(): void
      signal<T>(v: T): { (): T; set(v: T): void }
    }
    const mod = (await import(outFile)) as Mod

    type Item = { id: number; label: string }
    const extItems = mod.signal<Item[]>([
      { id: 1, label: 'A' },
      { id: 2, label: 'B' },
    ])

    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.List.mount(parent, doc, { items: () => extItems() })
    mod.flushSync()

    const lisBefore = Array.from(parent.querySelectorAll('li'))
    expect(lisBefore.length).toBe(2)
    expect(lisBefore[0]!.textContent).toBe('A')
    expect(lisBefore[1]!.textContent).toBe('B')

    // Drive value change at the same key (id:1 stays, label changes)
    extItems.set([
      { id: 1, label: 'A-updated' },
      { id: 2, label: 'B' },
    ])
    mod.flushSync()

    const lisAfter = Array.from(parent.querySelectorAll('li'))
    expect(lisAfter[0]!.textContent).toBe('A-updated')
    expect(lisAfter[1]!.textContent).toBe('B')
    // G1: node identity — same DOM elements reused (Variant-A transparency)
    expect(lisAfter[0]!, 'node identity: <li> at index 0 must be same element').toBe(lisBefore[0]!)
    expect(lisAfter[1]!, 'node identity: <li> at index 1 must be same element').toBe(lisBefore[1]!)

    dispose()
  })
})

// ── EX-EACH-03: index reactivity on reorder ───────────────────────────────────

describe('EX-EACH-03  reorder — index accessor updates; node identity preserved', () => {
  const source = `
const List = $component((props) => {
  $script(() => {
    const { items } = props
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(i) => i.id}" let={item, index}><li>\${item.label + '#' + index}</li></each></ul>\`)
})`

  test('EX-EACH-03  reorder — index updates, same nodes reused', async () => {
    const outFile = await buildListBundle(source)
    type Mod = {
      List: {
        (props: Record<string, () => unknown>, slots?: Record<string, unknown>): unknown
        mount(
          p: Element,
          d: Document,
          props?: Record<string, () => unknown>,
          slots?: Record<string, unknown>,
        ): () => void
      }
      flushSync(): void
      signal<T>(v: T): { (): T; set(v: T): void }
    }
    const mod = (await import(outFile)) as Mod

    type Item = { id: number; label: string }
    const extItems = mod.signal<Item[]>([
      { id: 1, label: 'A' },
      { id: 2, label: 'B' },
      { id: 3, label: 'C' },
    ])

    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.List.mount(parent, doc, { items: () => extItems() })
    mod.flushSync()

    const lisBefore = Array.from(parent.querySelectorAll('li'))
    expect(lisBefore[0]!.textContent).toBe('A#0')
    expect(lisBefore[1]!.textContent).toBe('B#1')
    expect(lisBefore[2]!.textContent).toBe('C#2')

    // Reorder: C → A → B
    extItems.set([
      { id: 3, label: 'C' },
      { id: 1, label: 'A' },
      { id: 2, label: 'B' },
    ])
    mod.flushSync()

    const lisAfter = Array.from(parent.querySelectorAll('li'))
    expect(lisAfter[0]!.textContent).toBe('C#0')
    expect(lisAfter[1]!.textContent).toBe('A#1')
    expect(lisAfter[2]!.textContent).toBe('B#2')

    // Node identity: nodes reused after reorder
    expect(
      lisAfter.every((li) => lisBefore.some((lb) => lb === li)),
      'DOM nodes should be reused (identity preserved) after reorder',
    ).toBe(true)

    dispose()
  })
})

// ── EX-EACH-04: add / remove / clear ─────────────────────────────────────────

describe('EX-EACH-04  add / remove / clear — <li> count and content at each step', () => {
  const source = `
const List = $component((props) => {
  $script(() => {
    const { items } = props
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(i) => i.id}" let={item}><li>\${item.label}</li></each></ul>\`)
})`

  test('EX-EACH-04  append, remove-middle, clear', async () => {
    const outFile = await buildListBundle(source)
    type Mod = {
      List: {
        (props: Record<string, () => unknown>, slots?: Record<string, unknown>): unknown
        mount(
          p: Element,
          d: Document,
          props?: Record<string, () => unknown>,
          slots?: Record<string, unknown>,
        ): () => void
      }
      flushSync(): void
      signal<T>(v: T): { (): T; set(v: T): void }
    }
    const mod = (await import(outFile)) as Mod

    type Item = { id: number; label: string }
    const extItems = mod.signal<Item[]>([
      { id: 1, label: 'A' },
      { id: 2, label: 'B' },
    ])

    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.List.mount(parent, doc, { items: () => extItems() })
    mod.flushSync()

    // Initial: 2 items
    expect(parent.querySelectorAll('li').length).toBe(2)

    // Append
    extItems.set([
      { id: 1, label: 'A' },
      { id: 2, label: 'B' },
      { id: 3, label: 'C' },
    ])
    mod.flushSync()
    const lisAfterAppend = parent.querySelectorAll('li')
    expect(lisAfterAppend.length).toBe(3)
    expect(lisAfterAppend[2]!.textContent).toBe('C')

    // Remove middle (id:2)
    extItems.set([
      { id: 1, label: 'A' },
      { id: 3, label: 'C' },
    ])
    mod.flushSync()
    const lisAfterRemove = parent.querySelectorAll('li')
    expect(lisAfterRemove.length).toBe(2)
    expect(lisAfterRemove[0]!.textContent).toBe('A')
    expect(lisAfterRemove[1]!.textContent).toBe('C')

    // Full clear
    extItems.set([])
    mod.flushSync()
    expect(parent.querySelectorAll('li').length).toBe(0)

    dispose()
  })
})

// ── EX-EACH-05: unmount no-leak ───────────────────────────────────────────────

describe('EX-EACH-05  unmount — DOM removed, no reactive leak', () => {
  const source = `
const List = $component((props) => {
  $script(() => {
    const { items } = props
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(i) => i.id}" let={item}><li>\${item.label}</li></each></ul>\`)
})`

  test('EX-EACH-05  dispose → DOM cleared (no <li> elements, container child count 0)', async () => {
    const outFile = await buildListBundle(source)
    type Mod = {
      List: {
        (props: Record<string, () => unknown>, slots?: Record<string, unknown>): unknown
        mount(
          p: Element,
          d: Document,
          props?: Record<string, () => unknown>,
          slots?: Record<string, unknown>,
        ): () => void
      }
      flushSync(): void
      signal<T>(v: T): { (): T; set(v: T): void }
    }
    const mod = (await import(outFile)) as Mod

    type Item = { id: number; label: string }
    const extItems = mod.signal<Item[]>([
      { id: 1, label: 'A' },
      { id: 2, label: 'B' },
    ])

    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.List.mount(parent, doc, { items: () => extItems() })
    mod.flushSync()

    // Confirm initial state
    expect(parent.querySelectorAll('li').length).toBe(2)

    // Dispose and assert DOM teardown
    dispose()
    expect(parent.childElementCount).toBe(0)
    expect(parent.querySelectorAll('li').length).toBe(0)

    // Confirm no reactive leak: setting items after dispose must not cause any effect
    // (observer-count probe: __test.observerCount(extItems) requires the signal from the
    // same module instance — not accessible across bundle boundary; DOM-teardown assertion
    // is the primary proof. Observer-count is logged as residual.)
    extItems.set([{ id: 99, label: 'ghost' }])
    mod.flushSync()
    // DOM stays empty after post-dispose signal mutation
    expect(parent.childElementCount).toBe(0)
    expect(parent.querySelectorAll('li').length).toBe(0)
  })
})

// ── EX-EACH-06: non-assignment slot-prop reads in event handlers ──────────────
//
// Regression guard: item.id / item.label in bare expressions and multi-statement
// arrow handler bodies must be rewritten to slotProps.item().id / slotProps.item().label,
// not left as free variables.

describe('EX-EACH-06  non-assignment slot-prop reads in event handlers are rewritten', () => {
  const source = `
const List = $component(() => {
  $script(() => {
    const selected = signal(0)
    const log = signal('')
  })
  $render(() => html\`<ul><each .of="\${[]}" key="\${(i) => i.id}" let={item}><li @click="\${() => { log = item.label; selected = item.id }}">\${item.label}</li></each></ul>\`)
})`

  test('EX-EACH-06  multi-statement handler body: both item.label and item.id rewritten via slotProps', () => {
    const js = emitModule(parseNvFileForEmit(source, 'list.nv', sharedDoc))
    // Both slot-prop reads must be rewritten — neither should appear as bare `item.`
    expect(js).toContain('slotProps.item().label')
    expect(js).toContain('slotProps.item().id')
    expect(js).not.toContain('log.set(item.label)')
    expect(js).not.toContain('selected.set(item.id)')
  })
})

// ── EX-CL-01..04: class-selection — .nv behavioral e2e (closes D-cl-1) ──────

/**
 * Shared builder for class-selection emit-exec tests.
 * Parses .nv source through the emit path, bundles, and re-exports
 * flushSync + signal so callers share one scheduler instance.
 * Reuses buildListBundle's exact pattern (component-name-agnostic).
 */
async function buildClassBundle(source: string): Promise<string> {
  const js = emitModule(parseNvFileForEmit(source, 'cls.nv', sharedDoc))
  const withExports = `${js}\nexport { flushSync, signal } from '@neutro/view/core'\n`
  const entryFile = tmpPath('.js')
  const outFile = tmpPath('.bundle.mjs')
  fs.writeFileSync(entryFile, withExports, 'utf8')
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
          build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
            path: rendererIndexPath,
          }))
          build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
            path: rendererRuntimePath,
          }))
        },
      },
    ],
  })
  return outFile
}

type ClassBundleModule = {
  Box: ComponentFactory
  flushSync(): void
  signal<T>(v: T): { (): T; set(v: T): void }
}

// ── EX-CL-01: initial render, static + toggle mix ────────────────────────────

describe('EX-CL-01  initial render: static "card" always present; "active" token when active=true', () => {
  // Identifier-only keys: prop.name.getText() returns the name without quotes for identifiers.
  // Quoted string keys (e.g. 'is-active') include surrounding quotes in getText() — a src/ limitation
  // that is out of scope for this test-only increment (G0 disqualifier prevents src/ touch).
  const source = `
const Box = $component((props) => {
  $script(() => {
    const { active } = props
  })
  $render(() => html\`<div class="\${{ card: true, active: active }}">x</div>\`)
})`

  test('EX-CL-01  both tokens present when active prop is true', async () => {
    const outFile = await buildClassBundle(source)
    const mod = (await import(outFile)) as ClassBundleModule
    const extActive = mod.signal(true)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Box.mount(parent, doc, { active: () => extActive() })
    mod.flushSync()

    const div = parent.querySelector('div')!
    expect(div.classList.contains('card')).toBe(true)
    expect(div.classList.contains('active')).toBe(true)

    dispose()
  })
})

// ── EX-CL-02: per-key toggle reactivity (LOAD-BEARING — closes D-cl-1) ───────

describe('EX-CL-02  per-key toggle reactivity: real emit boolSrc (not stubExpr) wired into wireClassList', () => {
  /**
   * Load-bearing gate. If the emitted module carried a stubbed expr (() => undefined),
   * the extActive.set(false) → flushSync → is-active absent assertion would fail because
   * classList.toggle('is-active', !!undefined) is always false — the *initial* set(true)
   * case would also fail. A stub reaches neither direction correctly.
   *
   * The emitted .js for this component is captured in the test output via console.log
   * for architect verification (see handoff A.3 requirement).
   */
  // Identifier-only keys; same note as EX-CL-01.
  const source = `
const Box = $component((props) => {
  $script(() => {
    const { active } = props
  })
  $render(() => html\`<div class="\${{ card: true, active: active }}">x</div>\`)
})`

  test('EX-CL-02  toggle reflects external signal; static token survives flip', async () => {
    // Capture emitted JS for architect verification (G1.1 seam proof).
    // Key artifact: entries must show real boolSrc (props.active()), not undefined.
    const emittedJs = emitModule(parseNvFileForEmit(source, 'cls.nv', sharedDoc))
    console.log('[EX-CL-02 emitted JS]\n', emittedJs)

    const outFile = await buildClassBundle(source)
    const mod = (await import(outFile)) as ClassBundleModule
    const extActive = mod.signal(true)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Box.mount(parent, doc, { active: () => extActive() })
    mod.flushSync()

    const div = parent.querySelector('div')!

    // Initial state: active=true → both tokens present
    expect(div.classList.contains('card')).toBe(true)
    expect(div.classList.contains('active')).toBe(true)

    // Flip to false: active removed; card must remain (static token / always-true toggle)
    extActive.set(false)
    mod.flushSync()
    expect(div.classList.contains('active')).toBe(false)
    expect(div.classList.contains('card')).toBe(true)

    // Flip back to true: active returns
    extActive.set(true)
    mod.flushSync()
    expect(div.classList.contains('active')).toBe(true)

    dispose()
  })
})

// ── EX-CL-03: per-key isolation across two independent toggles ────────────────

describe('EX-CL-03  per-key isolation: flipping one key does not disturb a sibling key', () => {
  // Identifier-only keys; same note as EX-CL-01.
  const source = `
const Box = $component((props) => {
  $script(() => {
    const { a, b } = props
  })
  $render(() => html\`<div class="\${{ alpha: a, beta: b }}">x</div>\`)
})`

  test('EX-CL-03  flip alpha-only → beta unchanged', async () => {
    const outFile = await buildClassBundle(source)
    const mod = (await import(outFile)) as ClassBundleModule & {
      Box: {
        mount(p: Element, d: Document, props?: Record<string, () => unknown>): () => void
      }
    }
    const extA = mod.signal(true)
    const extB = mod.signal(false)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Box.mount(parent, doc, { a: () => extA(), b: () => extB() })
    mod.flushSync()

    const div = parent.querySelector('div')!
    expect(div.classList.contains('alpha')).toBe(true)
    expect(div.classList.contains('beta')).toBe(false)

    // Flip only a → false
    extA.set(false)
    mod.flushSync()
    expect(div.classList.contains('alpha')).toBe(false)
    // beta must be unaffected (still false)
    expect(div.classList.contains('beta')).toBe(false)

    // Now set b → true, alpha stays false
    extB.set(true)
    mod.flushSync()
    expect(div.classList.contains('beta')).toBe(true)
    expect(div.classList.contains('alpha')).toBe(false)

    dispose()
  })
})

// ── EX-CL-04: unmount — no stale class mutation after dispose ─────────────────

describe('EX-CL-04  unmount: DOM removed, no reactive class mutation after dispose', () => {
  const source = `
const Box = $component((props) => {
  $script(() => {
    const { active } = props
  })
  $render(() => html\`<div class="\${{ card: true, active: active }}">x</div>\`)
})`

  test('EX-CL-04  dispose → post-dispose signal flip is a no-op', async () => {
    const outFile = await buildClassBundle(source)
    const mod = (await import(outFile)) as ClassBundleModule
    const extActive = mod.signal(true)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Box.mount(parent, doc, { active: () => extActive() })
    mod.flushSync()

    expect(parent.querySelector('div')).not.toBeNull()

    // Dispose cleans up the DOM root
    dispose()

    // Post-dispose signal mutation must not throw and must not re-add elements
    extActive.set(false)
    mod.flushSync()
    // The detached div is gone; parent has no children
    expect(parent.childElementCount).toBe(0)
  })
})

// ── EX-CL-05: D-cl-3 classlist key unquoting ─────────────────────────────────

describe('EX-CL-05  D-cl-3: classlist string-literal key unquoting', () => {
  // G1.A1: hyphenated string-literal key — 'is-active' must not become "'is-active'"
  test('EX-CL-05a  hyphenated string key: classList.contains("is-active") is true', async () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const active = signal(true)
  })
  $render(() => html\`<div class="\${{ 'is-active': active }}"></div>\`)
})`
    const results = parseNvFileForEmit(source, 'c.nv', sharedDoc)
    const js = emitModule(results)
    const bundlePath = await bundleEmittedJs(js)
    const mod = (await import(bundlePath)) as BundleModule & { C: ComponentFactory }
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.C.mount(parent, doc)
    mod.flushSync()
    expect(parent.querySelector('div')?.classList.contains('is-active')).toBe(true)
    dispose()
  })

  // G1.A2: whitespace string key — 'foo bar' splits into foo and bar, both applied
  test('EX-CL-05b  whitespace string key: "foo" and "bar" both in classList', async () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const on = signal(true)
  })
  $render(() => html\`<div class="\${{ 'foo bar': on }}"></div>\`)
})`
    const results = parseNvFileForEmit(source, 'c.nv', sharedDoc)
    const js = emitModule(results)
    const bundlePath = await bundleEmittedJs(js)
    const mod = (await import(bundlePath)) as BundleModule & { C: ComponentFactory }
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.C.mount(parent, doc)
    mod.flushSync()
    const cl = parent.querySelector('div')?.classList
    expect(cl?.contains('foo')).toBe(true)
    expect(cl?.contains('bar')).toBe(true)
    dispose()
  })

  // G1.A3: identifier key — regression guard, must still work
  test('EX-CL-05c  identifier key: classList.contains("active") is true', async () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const on = signal(true)
  })
  $render(() => html\`<div class="\${{ active: on }}"></div>\`)
})`
    const results = parseNvFileForEmit(source, 'c.nv', sharedDoc)
    const js = emitModule(results)
    const bundlePath = await bundleEmittedJs(js)
    const mod = (await import(bundlePath)) as BundleModule & { C: ComponentFactory }
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.C.mount(parent, doc)
    mod.flushSync()
    expect(parent.querySelector('div')?.classList.contains('active')).toBe(true)
    dispose()
  })
})

describe('EX-SB: SyncBinding exec', () => {
  test('EX-SB-01  :value binding round-trip via emitted module', async () => {
    const src = `
const SyncInput = $component(() => {
  $script(() => {
    const val = signal('initial')
  })
  $render(() => html\`<input :value="\${val}" />\`)
})
`
    const results = parseNvFileForEmit(src, 'SyncInput.nv', sharedDoc)
    const js = emitModule(results)
    const bundlePath = await bundleEmittedJs(js)
    const mod = (await import(bundlePath)) as BundleModule & { SyncInput: ComponentFactory }
    const doc = makeDoc()
    const parent = makeParent(doc)
    mod.SyncInput.mount(parent, doc)
    mod.flushSync()

    const input = parent.querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy()
    // signal→DOM: initial value written to DOM prop
    expect(input.value).toBe('initial')
  })
})

// ── G1 repro: <each> with a component-only body (Bug 1, task-6-bug2 spec) ────

describe('G1-repro  component-in-each: <each> body whose ONLY content is a component', () => {
  const source = `
const Row = $component((props) => {
  $script(() => {
    const { label } = props
  })
  $render(() => html\`<li class="row">\${label}</li>\`)
})
const List = $component(() => {
  $script(() => {
    const items = signal([{ id: 1, label: 'Alpha' }, { id: 2, label: 'Beta' }])
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(i) => i.id}" let={item}><Row label="\${item.label}" /></each></ul>\`)
})`

  test('G1-repro  mounts N <li class="row"> elements, not 1', async () => {
    const outFile = await buildListBundle(source)
    const mod = (await import(outFile)) as ListBundleModule
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.List.mount(parent, doc)
    mod.flushSync()

    const rows = parent.querySelectorAll('.row')
    expect(rows.length).toBe(2)
    expect(rows[0]?.textContent).toBe('Alpha')
    expect(rows[1]?.textContent).toBe('Beta')

    dispose()
  })
})
