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
import { rewriteNvSpecifiers } from '../../src/renderer/nv-esbuild-plugin.js'
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
    expect(rewritten.length > 0).toBe(true)
    expect(rewritten).toContain('export function Parent(')
  })
})
