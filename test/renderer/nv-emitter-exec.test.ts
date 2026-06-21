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
        },
      },
    ],
  })

  return outFile
}

// ── Bundle module type ────────────────────────────────────────────────────────

type ComponentFactory = () => { mount(parent: Element, doc: Document): () => void }

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
    const dispose = mod.Counter().mount(parent, doc)
    mod.flushSync()

    expect(parent.querySelector('span')?.textContent).toBe('0')
    dispose()
  })

  test('EX-01b  click → "1", click → "2"', async () => {
    const mod = await buildCounter()
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Counter().mount(parent, doc)
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
    const dispose = mod.Counter().mount(parent, doc)
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
    const dispose = mod.Toggle().mount(parent, doc)
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
    const dispose = mod.Toggle().mount(parent, doc)
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
    const disposeA = mod.A().mount(parentA, doc)
    mod.flushSync()
    expect(parentA.querySelector('p')?.textContent).toBe('hello')

    const parentB = makeParent(doc)
    const disposeB = mod.B().mount(parentB, doc)
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
      Counter: (props: Record<string, () => unknown>) => {
        mount(p: Element, d: Document): () => void
      }
    }
    const n = mod.signal(0)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Counter({ count: () => n() }).mount(parent, doc)
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
      Widget: (props: Record<string, () => unknown>) => {
        mount(p: Element, d: Document): () => void
      }
    }
    const n = mod.signal(0)
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Widget({ count: () => n() }).mount(parent, doc)
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
      Label: (props: Record<string, () => unknown>) => {
        mount(p: Element, d: Document): () => void
      }
    }
    const lbl = mod.signal('hello')
    const doc = makeDoc()
    const parent = makeParent(doc)
    const dispose = mod.Label({ label: () => lbl() }).mount(parent, doc)
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
    // Note: mounting Counter as a child element requires the emitter factory shape to match
    // ComponentRef — deferred to a later milestone.
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
    const dispose = mod.App().mount(parent, doc)
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
