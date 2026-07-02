/**
 * Real-Browser Gate — G1 nesting matrix + three-back-end parity (Task 6).
 *
 * Feeds: Tasks 1-5 fixed a nested-structural-binding bug (component/each/recycle/
 * switch nesting) in nv-parser.ts / nv-emitter.ts. This file proves the fix holds
 * in a real browser (Chromium) across all three back-ends: interpreter `mount()`,
 * emitted `emitMount()`, and full Mode-A (.nv → esbuild bundle) compilation.
 *
 * Seven fixtures under test/browser/fixtures/nested-structural/ cover the nesting
 * matrix: component-in-each, each-in-each, switch-in-each, each-in-switch-branch,
 * component-in-switch-fallback, switch-in-each-in-switch (deep 3-level nesting),
 * each-in-recycle (structural child nested inside a <recycle> body).
 *
 * Bundling convention copied verbatim (parameterized over seven fixtures) from
 * nv-author-probe.spec.ts's single-bundle-built-once-in-beforeAll pattern.
 *
 * Run: pnpm test:browser test/browser/nested-structural.spec.ts
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import type { TemplateIR, WritableSignal } from '../../src/renderer/ir.js'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixturesDir = join(__dirname, 'fixtures/nested-structural')
const distDir = join(__dirname, 'dist')

const FIXTURES = [
  { name: 'component-in-each', globalName: '__nvComponentInEach' },
  { name: 'each-in-each', globalName: '__nvEachInEach' },
  { name: 'switch-in-each', globalName: '__nvSwitchInEach' },
  { name: 'each-in-switch-branch', globalName: '__nvEachInSwitchBranch' },
  { name: 'component-in-switch-fallback', globalName: '__nvComponentInSwitchFallback' },
  { name: 'switch-in-each-in-switch', globalName: '__nvSwitchInEachInSwitch' },
  { name: 'each-in-recycle', globalName: '__nvEachInRecycle' },
  { name: 'recycle-in-each', globalName: '__nvRecycleInEach' },
] as const

// Reuse the "main" bundle already built by real-browser.spec.ts for the
// interpreter/emitMount half of the three-back-end parity test (Step 3):
// it exposes window.__nv = { mount, emitMount, flushSync, signal, ... }.
const MAIN_BUNDLE = join(distDir, 'nv-bundle.js')

const bundlePaths: Record<string, string> = {}
// If a fixture's esbuild.build() throws (e.g. a real nv-emitter.ts bug),
// record the error here instead of letting beforeAll
// abort the whole file. Each fixture's tests below check this map first so a
// single broken fixture surfaces as a clear, attributable per-test failure
// rather than nuking all 9 tests in this file via a failed beforeAll.
const buildErrors: Record<string, string> = {}

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })
  for (const f of FIXTURES) {
    const outfile = join(distDir, `nv-${f.name}-bundle.js`)
    try {
      await esbuild.build({
        entryPoints: [join(fixturesDir, `${f.name}-entry.ts`)],
        bundle: true,
        outfile,
        format: 'iife',
        globalName: f.globalName,
        platform: 'browser',
        target: 'es2022',
        plugins: [
          nvPlugin(),
          {
            name: 'ts-resolve',
            setup(build) {
              build.onResolve({ filter: /\.js$/ }, (args) => {
                const absTs = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'))
                return { path: absTs }
              })
            },
          },
          {
            name: 'neutro-alias',
            setup(build) {
              build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({
                path: join(repoRoot, 'src/core/index.ts'),
              }))
              build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
                path: join(repoRoot, 'src/renderer/index.ts'),
              }))
              build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
                path: join(repoRoot, 'src/renderer/runtime.ts'),
              }))
            },
          },
        ],
        sourcemap: false,
        minify: false,
      })
      bundlePaths[f.name] = outfile
    } catch (err) {
      buildErrors[f.name] = err instanceof Error ? err.message : String(err)
    }
  }
})

function requireBundle(name: string): string {
  const err = buildErrors[name]
  if (err !== undefined) {
    throw new Error(
      `[G1] esbuild.build() for fixture '${name}' failed — likely an nv-emitter.ts ` +
        `computeBodyThunks/emitBindingLiteral divergence. Build error: ${err}`,
    )
  }
  const p = bundlePaths[name]
  if (p === undefined) throw new Error(`[G1] no bundle path recorded for fixture '${name}'`)
  return p
}

// ── Step 2: G1 nesting-matrix DOM tests (real browser, one per fixture) ───────

test('G1 component-in-each: Mode-A emit mounts <Row> per item in real browser', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('component-in-each') })
  const rows = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvComponentInEach: {
          List: { mount: (p: Element, d: Document) => void }
          flushSync: () => void
        }
      }
    ).__nvComponentInEach
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.List.mount(parent, document)
    app.flushSync()
    return Array.from(parent.querySelectorAll('.row')).map((el) => el.textContent)
  })
  expect(rows).toEqual(['Alpha', 'Beta'])
})

test('G1 each-in-each: Mode-A emit mounts nested rows/cells in real browser', async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('each-in-each') })
  const cellsByRow = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvEachInEach: {
          Grid: {
            mount: (p: Element, d: Document, props?: Record<string, () => unknown>) => void
          }
          flushSync: () => void
          signal: <T>(v: T) => { (): T; set: (v: T) => void }
        }
      }
    ).__nvEachInEach
    const rows = app.signal([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Grid.mount(parent, document, { rows: () => rows() })
    app.flushSync()
    return Array.from(parent.querySelectorAll('.row')).map((row) =>
      Array.from(row.querySelectorAll('.cell')).map((c) => c.textContent),
    )
  })
  expect(cellsByRow).toEqual([['a', 'b'], ['c']])
})

test('G1 each-in-recycle: Mode-A emit mounts nested rows/cells inside a recycled list in real browser', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('each-in-recycle') })
  const cellsByRow = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvEachInRecycle: {
          Grid: {
            mount: (p: Element, d: Document, props?: Record<string, () => unknown>) => void
          }
          flushSync: () => void
          signal: <T>(v: T) => { (): T; set: (v: T) => void }
        }
      }
    ).__nvEachInRecycle
    const rows = app.signal([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Grid.mount(parent, document, { rows: () => rows() })
    app.flushSync()
    return Array.from(parent.querySelectorAll('.row')).map((row) =>
      Array.from(row.querySelectorAll('.cell')).map((c) => c.textContent),
    )
  })
  expect(cellsByRow).toEqual([['a', 'b'], ['c']])
})

test('G1 recycle-in-each: Mode-A emit mounts nested cells inside a recycled list inside each row in real browser (Follow-up A′ — the 4th and final nesting direction)', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('recycle-in-each') })
  const cellsByRow = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvRecycleInEach: {
          Grid: {
            mount: (p: Element, d: Document, props?: Record<string, () => unknown>) => void
          }
          flushSync: () => void
          signal: <T>(v: T) => { (): T; set: (v: T) => void }
        }
      }
    ).__nvRecycleInEach
    const rows = app.signal([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Grid.mount(parent, document, { rows: () => rows() })
    app.flushSync()
    return Array.from(parent.querySelectorAll('.row')).map((row) =>
      Array.from(row.querySelectorAll('.cell')).map((c) => c.textContent),
    )
  })
  expect(cellsByRow).toEqual([['a', 'b'], ['c']])
})

test('G1 switch-in-each: Mode-A emit picks the correct branch per row in real browser', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('switch-in-each') })
  const statuses = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvSwitchInEach: {
          List: { mount: (p: Element, d: Document) => void }
          flushSync: () => void
        }
      }
    ).__nvSwitchInEach
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.List.mount(parent, document)
    app.flushSync()
    return Array.from(parent.querySelectorAll('li')).map(
      (li) => li.querySelector('span')?.className,
    )
  })
  expect(statuses).toEqual(['ok', 'err'])
})

test('G1 each-in-switch-branch: Mode-A emit mounts the list branch in real browser', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('each-in-switch-branch') })
  const labels = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvEachInSwitchBranch: {
          Panel: { mount: (p: Element, d: Document) => void }
          flushSync: () => void
        }
      }
    ).__nvEachInSwitchBranch
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Panel.mount(parent, document)
    app.flushSync()
    return Array.from(parent.querySelectorAll('li')).map((li) => li.textContent)
  })
  expect(labels).toEqual(['A', 'B'])
})

test('G1 component-in-switch-fallback: Mode-A emit mounts <Empty> in the fallback branch in real browser', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('component-in-switch-fallback') })
  const text = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvComponentInSwitchFallback: {
          Panel: { mount: (p: Element, d: Document) => void }
          flushSync: () => void
        }
      }
    ).__nvComponentInSwitchFallback
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Panel.mount(parent, document)
    app.flushSync()
    return parent.querySelector('.empty-state')?.textContent
  })
  expect(text).toBe('Nothing here')
})

test('G1 switch-in-each-in-switch: deep nesting recursion terminates and renders correctly in real browser', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('switch-in-each-in-switch') })
  const flags = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvSwitchInEachInSwitch: {
          Panel: { mount: (p: Element, d: Document) => void }
          flushSync: () => void
        }
      }
    ).__nvSwitchInEachInSwitch
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Panel.mount(parent, document)
    app.flushSync()
    return Array.from(parent.querySelectorAll('li span')).map((s) => s.className)
  })
  expect(flags).toEqual(['flagged', 'unflagged'])
})

// ── Step 3: three-back-end parity (interpreter, emitted-mount, Mode-A) ────────

test('three-back-end parity: interpreter, emitted-mount, and Mode-A produce equivalent DOM for each-in-each', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: MAIN_BUNDLE }) // window.__nv (interpreter + emitMount)

  const irBased = await page.evaluate(() => {
    const { mount, emitMount, flushSync } = window.__nv

    // Hand-built TemplateIR mirroring each-in-each.nv's authored structure:
    // rows = [{id:1, cells:[{id:10,v:'a'},{id:11,v:'b'}]}, {id:2, cells:[{id:20,v:'c'}]}]
    const makeIR = () => ({
      id: 'grid-nested',
      shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
      bindings: [
        {
          kind: 'list' as const,
          pathIndex: 0,
          items: () => [
            {
              id: 1,
              cells: [
                { id: 10, v: 'a' },
                { id: 11, v: 'b' },
              ],
            },
            { id: 2, cells: [{ id: 20, v: 'c' }] },
          ],
          key: (row: unknown) => (row as { id: number }).id,
          itemTemplate: (rowVs: WritableSignal<unknown>) =>
            ({
              id: 'row',
              shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
              bindings: [
                {
                  kind: 'list' as const,
                  pathIndex: 0,
                  items: () => (rowVs() as { cells: unknown[] }).cells,
                  key: (cell: unknown) => (cell as { id: number }).id,
                  itemTemplate: (cellVs: WritableSignal<unknown>) =>
                    ({
                      id: 'cell',
                      shape: { html: '<span><!--nv-0--></span>', bindingPaths: [[0, 0]] },
                      bindings: [
                        {
                          kind: 'text' as const,
                          pathIndex: 0,
                          expr: () => (cellVs() as { v: string }).v,
                        },
                      ],
                    }) as TemplateIR,
                },
              ],
            }) as TemplateIR,
        },
      ],
    })

    const pI = document.createElement('div')
    document.body.appendChild(pI)
    mount(makeIR(), pI, document)

    const pE = document.createElement('div')
    document.body.appendChild(pE)
    emitMount(makeIR()).mountFn(pE, document)

    flushSync()

    // Deviation from the brief's literal `div > div` selector: `root` (pI/pE) is
    // itself a <div>, so `div > div` also matches the shape wrapper div (child of
    // root), producing a spurious extra "row" containing every cell. Select only
    // row-divs (divs whose direct children include a <span>) instead.
    const cellsFrom = (root: Element) =>
      Array.from(root.querySelectorAll('div'))
        .filter((d) => Array.from(d.children).some((c) => c.tagName === 'SPAN'))
        .map((row) => Array.from(row.querySelectorAll('span')).map((s) => s.textContent))

    return { interpreterCells: cellsFrom(pI), emittedMountCells: cellsFrom(pE) }
  })

  expect(irBased.interpreterCells).toEqual([['a', 'b'], ['c']])
  expect(irBased.emittedMountCells).toEqual([['a', 'b'], ['c']])

  await page.goto('about:blank') // fresh context — no global collision with window.__nv
  await page.addScriptTag({ path: requireBundle('each-in-each') })
  const modeACells = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvEachInEach: {
          Grid: {
            mount: (p: Element, d: Document, props?: Record<string, () => unknown>) => void
          }
          flushSync: () => void
          signal: <T>(v: T) => { (): T; set: (v: T) => void }
        }
      }
    ).__nvEachInEach
    const rows = app.signal([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Grid.mount(parent, document, { rows: () => rows() })
    app.flushSync()
    return Array.from(parent.querySelectorAll('.row')).map((row) =>
      Array.from(row.querySelectorAll('.cell')).map((c) => c.textContent),
    )
  })

  expect(modeACells).toEqual([['a', 'b'], ['c']])
})

// ── Follow-up A′: recycle-in-each — two-back-end parity ────────────────────────
//
// DEVIATION from the commission's literal "three-back-end parity" wording, per
// docs/gates/recycle-in-each-emit.md's header-note correction: `emitted-mount.ts`'s
// `recycled-list` case is a pre-existing, unconditional stub
// (`throw new Error('[nv/emitted-mount] RecycledListBinding not yet implemented in
// compiler back-end')`, src/compiler/emitted-mount.ts:808-812) — not each-body-
// specific, predates A′, covers top-level <recycle> too. `each-in-recycle` (Follow-up
// A) already established the precedent: Mode-A-only, no interpreter/emitted-mount
// three-way test. This test follows that precedent: interpreter + Mode-A only.
test('two-back-end parity: interpreter and Mode-A produce equivalent DOM for recycle-in-each', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: MAIN_BUNDLE }) // window.__nv (interpreter)

  const interpreterCells = await page.evaluate(() => {
    const { mount, flushSync } = window.__nv

    // Hand-built TemplateIR mirroring recycle-in-each.nv's authored structure:
    // rows = [{id:1, cells:[{id:10,v:'a'},{id:11,v:'b'}]}, {id:2, cells:[{id:20,v:'c'}]}]
    const makeIR = () => ({
      id: 'grid-nested-recycle',
      shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
      bindings: [
        {
          kind: 'list' as const,
          pathIndex: 0,
          items: () => [
            {
              id: 1,
              cells: [
                { id: 10, v: 'a' },
                { id: 11, v: 'b' },
              ],
            },
            { id: 2, cells: [{ id: 20, v: 'c' }] },
          ],
          key: (row: unknown) => (row as { id: number }).id,
          itemTemplate: (rowVs: WritableSignal<unknown>) =>
            ({
              id: 'row',
              shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
              bindings: [
                {
                  kind: 'recycled-list' as const,
                  pathIndex: 0,
                  items: () => (rowVs() as { cells: unknown[] }).cells,
                  itemTemplate: (cellVs: WritableSignal<unknown>) =>
                    ({
                      id: 'cell',
                      shape: { html: '<span><!--nv-0--></span>', bindingPaths: [[0, 0]] },
                      bindings: [
                        {
                          kind: 'text' as const,
                          pathIndex: 0,
                          expr: () => (cellVs() as { v: string }).v,
                        },
                      ],
                    }) as TemplateIR,
                },
              ],
            }) as TemplateIR,
        },
      ],
    })

    const pI = document.createElement('div')
    document.body.appendChild(pI)
    mount(makeIR(), pI, document)
    flushSync()

    const cellsFrom = (root: Element) =>
      Array.from(root.querySelectorAll('div'))
        .filter((d) => Array.from(d.children).some((c) => c.tagName === 'SPAN'))
        .map((row) => Array.from(row.querySelectorAll('span')).map((s) => s.textContent))

    return cellsFrom(pI)
  })

  expect(interpreterCells).toEqual([['a', 'b'], ['c']])

  await page.goto('about:blank') // fresh context — no global collision with window.__nv
  await page.addScriptTag({ path: requireBundle('recycle-in-each') })
  const modeACells = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvRecycleInEach: {
          Grid: {
            mount: (p: Element, d: Document, props?: Record<string, () => unknown>) => void
          }
          flushSync: () => void
          signal: <T>(v: T) => { (): T; set: (v: T) => void }
        }
      }
    ).__nvRecycleInEach
    const rows = app.signal([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Grid.mount(parent, document, { rows: () => rows() })
    app.flushSync()
    return Array.from(parent.querySelectorAll('.row')).map((row) =>
      Array.from(row.querySelectorAll('.cell')).map((c) => c.textContent),
    )
  })

  expect(modeACells).toEqual([['a', 'b'], ['c']])
})

// ── Step 4: reactivity-through-nesting (external signal → nested text update,
//    node identity preserved — EX-EACH-02 pattern) ────────────────────────────

test('reactivity-through-nesting: external rows signal updates nested .cell text; node identity preserved', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('each-in-each') })

  const result = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvEachInEach: {
          Grid: {
            mount: (p: Element, d: Document, props?: Record<string, () => unknown>) => void
          }
          flushSync: () => void
          signal: <T>(v: T) => { (): T; set: (v: T) => void }
        }
      }
    ).__nvEachInEach

    type Cell = { id: number; v: string }
    type Row = { id: number; cells: Cell[] }

    const extRows = app.signal<Row[]>([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Grid.mount(parent, document, { rows: () => extRows() })
    app.flushSync()

    const cellsBefore = Array.from(parent.querySelectorAll('.cell'))
    const textBefore = cellsBefore.map((c) => c.textContent)

    // Drive value change at a kept key: cell id:10's value changes.
    extRows.set([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a-updated' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])
    app.flushSync()

    const cellsAfter = Array.from(parent.querySelectorAll('.cell'))
    const textAfter = cellsAfter.map((c) => c.textContent)

    return {
      textBefore,
      textAfter,
      sameNodeIdentity: cellsAfter[0] === cellsBefore[0] && cellsAfter[1] === cellsBefore[1],
    }
  })

  expect(result.textBefore).toEqual(['a', 'b', 'c'])
  expect(result.textAfter).toEqual(['a-updated', 'b', 'c'])
  expect(
    result.sameNodeIdentity,
    'G1: .cell DOM nodes at kept keys must be reused across nested reactive update',
  ).toBe(true)
})

// ── Step 5: disposal-through-nesting ──────────────────────────────────────────
//
// __test.nodeAllocCount / __test.nodeFreeCount (src/core/core.ts) are the
// closest existing owner-tree-adjacent counters: every reactive node (signal,
// derived, effect — including per-item scopes created by the nested <each>
// lists) increments nodeAllocCount on creation.
//
// Bug 2 investigation: naive alloc === free parity
// does NOT hold, even for a fully-correct dispose() — and this is by design,
// not a leak. src/core/core.ts's signal() (unlike effect()/derived()/
// createRoot()) never sets `.owner` and never calls addChild(currentOwner, ...)
// on the node it creates (core.ts ~1084-1099): signals are intentionally
// owner-less and are NEVER disposed via the owner-tree cascade (preRunCleanup /
// disposeChildrenOf / disposeNodeFull only walk EFFECT/DERIVED/root nodes).
// They're expected to become unreachable (and GC'd) once whatever closure
// holds them is dropped — not explicitly disposed, so they never increment
// nodeFreeCount.
//
// The interpreter's per-item list bookkeeping (wireList, src/renderer/
// interpreter.ts ~588-589) allocates each item's `valueSig` (and `indexSig`
// when itemReadsIndex) via a bare `signal(...)` call OUTSIDE the item's own
// createRoot/runWithOwner scope — by design (EX-EACH-05 already documents that
// list-item signal liveness is verified via DOM teardown, not owner-cascade
// disposal, because "observer-count parity" isn't part of the disposal
// contract). So every mounted list item leaves exactly one permanently-
// unowned, never-freed signal node behind (two if itemReadsIndex is true).
//
// each-in-each.nv's <each> bindings don't reference an index (`let={row}` /
// let={cell}`, no second binding), so itemReadsIndex is false for both levels:
// the fixture's 2 rows + 3 cells (2 in row 1, 1 in row 2) = 5 items each leave
// exactly one unowned valueSig. That gives the expected, by-design "deficit"
// of nodeAllocCount - nodeFreeCount === 5 after a fully-correct dispose() —
// confirmed by tracing every ALLOC/FREE pair with temporary instrumentation
// (not committed; see report) and cross-checked against a minimal jsdom repro
// of the same nested-list shape, which reproduces the identical 1-unowned-
// signal-per-item pattern. This is (b) a test-methodology artifact, not (a) a
// real disposal bug — updated to assert the documented, not naive, invariant.
const EACH_IN_EACH_ITEM_COUNT = 5 // 2 rows + (2 + 1) cells — see comment above
const EACH_IN_EACH_EXPECTED_UNOWNED_SIGNALS = EACH_IN_EACH_ITEM_COUNT // itemReadsIndex is false at both levels

test('disposal-through-nesting: mount + dispose of each-in-each frees every allocated reactive node (nodeAllocCount/nodeFreeCount parity proxy)', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('each-in-each') })

  const result = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvEachInEach: {
          Grid: {
            mount: (p: Element, d: Document, props?: Record<string, () => unknown>) => () => void
          }
          flushSync: () => void
          signal: <T>(v: T) => { (): T; set: (v: T) => void }
          __test: {
            nodeAllocCount: number
            nodeFreeCount: number
            resetNodeCounts: () => void
          }
        }
      }
    ).__nvEachInEach

    type Cell = { id: number; v: string }
    type Row = { id: number; cells: Cell[] }

    const extRows = app.signal<Row[]>([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])

    app.__test.resetNodeCounts()

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const dispose = app.Grid.mount(parent, document, { rows: () => extRows() })
    app.flushSync()

    const allocAfterMount = app.__test.nodeAllocCount
    const freeAfterMount = app.__test.nodeFreeCount

    dispose()
    app.flushSync()

    const allocAfterDispose = app.__test.nodeAllocCount
    const freeAfterDispose = app.__test.nodeFreeCount

    return { allocAfterMount, freeAfterMount, allocAfterDispose, freeAfterDispose }
  })

  // Mounting a nested two-level <each> must allocate at least one reactive node
  // per row/cell scope (sanity: the proxy counter is actually moving).
  expect(result.allocAfterMount).toBeGreaterThan(0)
  // Nothing should be freed while still mounted.
  expect(result.freeAfterMount).toBe(0)
  // No further reactive-node allocation happens during dispose() itself.
  expect(result.allocAfterDispose).toBe(result.allocAfterMount)
  // After dispose(), every EFFECT/DERIVED/root reactive node allocated for the
  // nested structure (outer list reconcile effect, per-row item roots, inner
  // lists' reconcile effects, per-cell item roots) must be freed — no invisible
  // retained effect surviving the nested-structural dispose walk. The only
  // nodes NOT freed are the per-item `valueSig` signals themselves, which are
  // owner-less by design (see comment above) — exactly
  // EACH_IN_EACH_EXPECTED_UNOWNED_SIGNALS of them, one per mounted list item.
  expect(
    result.allocAfterDispose - result.freeAfterDispose,
    'G1: dispose() must free every EFFECT/DERIVED/root node allocated by the nested ' +
      'each-in-each mount, leaving only the (by-design, owner-less) per-item value signals ' +
      'unfreed — see the comment above this test for why naive alloc === free parity is wrong',
  ).toBe(EACH_IN_EACH_EXPECTED_UNOWNED_SIGNALS)
})

// ── Step 6: needsSyntheticRoot cost measurement (docs/design/spec-recycling-playwright.md
//    convention — node-churn = countable/asserted gate, wall-clock = supplementary/logged
//    only, never asserted as a ratio) ──────────────────────────────────────────
//
// Background: `needsSyntheticRoot` (src/renderer/nv-parser.ts) auto-wraps an
// <each>/<recycle> item body in a synthetic root <div> whenever the body's only
// content is a single nested structural child with no wrapping element of its own
// (e.g. `<each><Row/></each>` with no <div> around <Row/> — exactly
// component-in-each.nv's shape). An adversarial review claimed, WITHOUT measuring,
// that this costs exactly one extra DOM element per mounted item (not per-render,
// not O(n^2)) and ZERO extra reactive-node allocations (the wrapper is a static
// structural element baked into the item's cloned HTML template, not a signal/
// effect/derived). This test verifies both halves of that claim empirically.
//
// Source-level corroboration (see report): building component-in-each-entry.ts
// with esbuild and inspecting the emitted TemplateIR's `shape.html` directly
// shows the wrapper is serialized into the item's literal HTML string —
// `"<div><!--nv-comp-0--></div>"` — i.e. it is cloned via the template's
// innerHTML at mount time, not constructed via any imperative createElement +
// reactive-binding path. `nodeAllocCount` (src/core/core.ts) only increments in
// makeNode(), which fires exclusively for signal/effect/derived/root creation —
// never for raw HTML template cloning — so the wrapper is structurally
// incapable of contributing to nodeAllocCount. This test corroborates that at
// runtime rather than merely asserting it from source reading.
//
// Proof strategy chosen (spec step 8): component-in-each.nv's item count is a
// fixed internal signal (2 items: Alpha, Beta — not threaded in as an external
// prop like each-in-each.nv's `rows`), so an exact single-N baseline is the
// natural, non-fragile measurement here (no fixture change needed to vary N).
// To additionally rule out O(n^2)/compounding cost across repeated mounts (the
// adversarial review's other concern — "not per-render"), the fixture is
// mounted TWICE, independently, with a full dispose + resetNodeCounts() between
// runs: if the wrapper's cost were anything other than a fixed, bounded
// per-item constant, the second mount's nodeAllocCount would differ from the
// first's. Identical alloc counts across both independent mounts is the
// linear/bounded proof; the wrapper-div count assertion (exactly 2, matching
// the 2 mounted items, not more/fewer) is the DOM-cost proof.
test('needsSyntheticRoot cost: component-in-each wraps exactly one synthetic <div> per item and contributes zero extra reactive-node allocations', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('component-in-each') })

  const result = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvComponentInEach: {
          List: { mount: (p: Element, d: Document) => () => void }
          flushSync: () => void
          __test: {
            nodeAllocCount: number
            nodeFreeCount: number
            resetNodeCounts: () => void
          }
        }
      }
    ).__nvComponentInEach

    // A synthetic wrapper <div> is the immediate parent of a `.row` <li> and
    // nothing else — this distinguishes it from any other <div> that might
    // exist in the tree (there are none here, but the query is written to be
    // unambiguous regardless of surrounding markup).
    const countWrapperDivs = (root: Element) =>
      Array.from(root.querySelectorAll('div')).filter(
        (d) => d.children.length === 1 && d.children[0]?.matches('li.row'),
      ).length

    // ── Mount 1 ──
    app.__test.resetNodeCounts()
    const parent1 = document.createElement('div')
    document.body.appendChild(parent1)
    const dispose1 = app.List.mount(parent1, document)
    app.flushSync()
    const wrapperCount1 = countWrapperDivs(parent1)
    const rowTexts1 = Array.from(parent1.querySelectorAll('.row')).map((el) => el.textContent)
    const allocAfterMount1 = app.__test.nodeAllocCount
    dispose1()
    app.flushSync()

    // ── Mount 2 (fully independent — proves the per-mount cost is bounded/
    //    linear, not compounding across repeated mounts) ──
    app.__test.resetNodeCounts()
    const parent2 = document.createElement('div')
    document.body.appendChild(parent2)
    const dispose2 = app.List.mount(parent2, document)
    app.flushSync()
    const wrapperCount2 = countWrapperDivs(parent2)
    const allocAfterMount2 = app.__test.nodeAllocCount
    dispose2()
    app.flushSync()

    return { wrapperCount1, rowTexts1, allocAfterMount1, wrapperCount2, allocAfterMount2 }
  })

  // Sanity: the fixture actually mounted (2 items, Alpha/Beta) — not a vacuous
  // pass because mount silently produced nothing.
  expect(result.rowTexts1).toEqual(['Alpha', 'Beta'])

  // DOM-cost claim: exactly one synthetic wrapper <div> per mounted item — not
  // more (would indicate double-wrapping), not fewer (would indicate the fix
  // regressed and the multi-root-list-item bug is back).
  expect(
    result.wrapperCount1,
    'needsSyntheticRoot must produce exactly one wrapper <div> per mounted item (2 items)',
  ).toBe(2)
  expect(result.wrapperCount2).toBe(2)

  // Reactive-node-cost claim: the two independent mounts (same fixture, same
  // item count) must allocate the IDENTICAL number of reactive nodes. If the
  // synthetic wrapper contributed any reactive-node cost of its own (a signal/
  // effect/derived per wrapper), that cost would still be identical between
  // two structurally-identical mounts, so this assertion alone does not by
  // itself rule out ANY wrapper-attributable allocation — it rules out
  // O(n^2)/compounding cost, i.e. the "not per-render" half of the claim.
  expect(
    result.allocAfterMount2,
    'needsSyntheticRoot cost must be a bounded per-mount constant — repeated ' +
      'independent mounts of the same 2-item fixture must allocate the same ' +
      'number of reactive nodes each time (not compounding/growing)',
  ).toBe(result.allocAfterMount1)

  // The "zero extra reactive-node allocations FROM THE WRAPPER SPECIFICALLY"
  // half of the claim is corroborated by source/build inspection (see the
  // comment block above this test and the report): the wrapper is serialized
  // into the item's static `shape.html` template string
  // (`"<div><!--nv-comp-0--></div>"`) and cloned via the template at mount —
  // nodeAllocCount only increments in makeNode(), which never fires for raw
  // HTML template cloning. A nonzero, sane allocAfterMount1 confirms the
  // counter is genuinely moving for this fixture's real reactive work (the
  // <each> reconcile effect, per-item scopes), i.e. this isn't a proxy counter
  // that's trivially zero for everything.
  expect(result.allocAfterMount1).toBeGreaterThan(0)
})

// ── Follow-up A′: recycle-in-each — reactivity, per-item recycling, keyed
//    identity, and disposal through nesting ─────────────────────────────────

test('recycle-in-each reactivity-through-nesting: external rows signal updates nested .cell text from within an each-item scope; node identity preserved by position', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('recycle-in-each') })

  const result = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvRecycleInEach: {
          Grid: {
            mount: (p: Element, d: Document, props?: Record<string, () => unknown>) => void
          }
          flushSync: () => void
          signal: <T>(v: T) => { (): T; set: (v: T) => void }
        }
      }
    ).__nvRecycleInEach

    type Cell = { id: number; v: string }
    type Row = { id: number; cells: Cell[] }

    const extRows = app.signal<Row[]>([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Grid.mount(parent, document, { rows: () => extRows() })
    app.flushSync()

    const cellsBefore = Array.from(parent.querySelectorAll('.cell'))
    const textBefore = cellsBefore.map((c) => c.textContent)

    // Same array length/positions — a pure value update, driving the inner
    // <recycle>'s position-identity rebind path (Op-3), not grow/shrink.
    extRows.set([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a-updated' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])
    app.flushSync()

    const cellsAfter = Array.from(parent.querySelectorAll('.cell'))
    const textAfter = cellsAfter.map((c) => c.textContent)

    return {
      textBefore,
      textAfter,
      sameNodeIdentity: cellsAfter[0] === cellsBefore[0] && cellsAfter[1] === cellsBefore[1],
    }
  })

  expect(result.textBefore).toEqual(['a', 'b', 'c'])
  expect(result.textAfter).toEqual(['a-updated', 'b', 'c'])
  expect(
    result.sameNodeIdentity,
    'A′: nested <recycle> DOM nodes must be reused (rebound in place) across a reactive ' +
      'value update driven from within the outer each-item scope',
  ).toBe(true)
})

test("recycle-in-each per-item recycling behavior: inner <recycle> reuses the position-0 DOM node across a shrink-then-grow of one row's cells", async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('recycle-in-each') })

  const result = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvRecycleInEach: {
          Grid: {
            mount: (p: Element, d: Document, props?: Record<string, () => unknown>) => void
          }
          flushSync: () => void
          signal: <T>(v: T) => { (): T; set: (v: T) => void }
        }
      }
    ).__nvRecycleInEach

    type Cell = { id: number; v: string }
    type Row = { id: number; cells: Cell[] }

    const extRows = app.signal<Row[]>([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Grid.mount(parent, document, { rows: () => extRows() })
    app.flushSync()

    const firstRow = () => parent.querySelectorAll('.row')[0] as Element
    const secondRow = () => parent.querySelectorAll('.row')[1] as Element
    const cellAt0 = () => firstRow().querySelectorAll('.cell')[0]

    const node0Before = cellAt0()
    // Sibling (row 2, untouched by the mutations below) — proves no cross-scope
    // leakage: row 1's pool churn must not disturb row 2's item signal/pool at all.
    const row2CellBefore = secondRow().querySelectorAll('.cell')[0]
    const row2TextBefore = row2CellBefore?.textContent

    // Shrink row 1's cells from 2 to 1 (recycle pool shrink: disposes slot 1, keeps slot 0).
    extRows.set([
      { id: 1, cells: [{ id: 10, v: 'a2' }] },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])
    app.flushSync()
    const node0AfterShrink = cellAt0()
    const cellCountAfterShrink = firstRow().querySelectorAll('.cell').length

    // Grow row 1's cells back to 2 (recycle pool grow: slot 0 rebound in place, slot 1 recreated).
    extRows.set([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a3' },
          { id: 11, v: 'b2' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])
    app.flushSync()
    const node0AfterGrow = cellAt0()
    const textsAfterGrow = Array.from(firstRow().querySelectorAll('.cell')).map(
      (c) => c.textContent,
    )
    const row2CellAfter = secondRow().querySelectorAll('.cell')[0]

    return {
      cellCountAfterShrink,
      textsAfterGrow,
      position0StableAcrossShrink: node0AfterShrink === node0Before,
      position0StableAcrossGrow: node0AfterGrow === node0Before,
      row2NodeIdentityStable: row2CellAfter === row2CellBefore,
      row2TextBefore,
      row2TextAfter: row2CellAfter?.textContent,
    }
  })

  expect(result.cellCountAfterShrink).toBe(1)
  expect(result.textsAfterGrow).toEqual(['a3', 'b2'])
  expect(
    result.position0StableAcrossShrink,
    "A′: shrinking the inner <recycle>'s pool must not dispose/recreate the surviving position-0 node",
  ).toBe(true)
  expect(
    result.position0StableAcrossGrow,
    "A′: growing the inner <recycle>'s pool back must rebind (not recreate) the already-pooled position-0 node",
  ).toBe(true)
  // No cross-scope leakage: row 2's outer item signal and inner recycle pool must
  // be completely unaffected by row 1's pool shrink/grow churn.
  expect(result.row2TextBefore).toBe('c')
  expect(result.row2TextAfter).toBe('c')
  expect(
    result.row2NodeIdentityStable,
    "A′: no cross-scope leakage — row 2's nested <recycle> DOM node must be untouched by row 1's pool churn",
  ).toBe(true)
})

test('recycle-in-each outer keyed identity: outer <each> row node identity is unaffected by the nested <recycle>, stable across a reorder', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('recycle-in-each') })

  const result = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvRecycleInEach: {
          Grid: {
            mount: (p: Element, d: Document, props?: Record<string, () => unknown>) => void
          }
          flushSync: () => void
          signal: <T>(v: T) => { (): T; set: (v: T) => void }
        }
      }
    ).__nvRecycleInEach

    type Cell = { id: number; v: string }
    type Row = { id: number; cells: Cell[] }

    const extRows = app.signal<Row[]>([
      { id: 1, cells: [{ id: 10, v: 'a' }] },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    app.Grid.mount(parent, document, { rows: () => extRows() })
    app.flushSync()

    const rowsBefore = Array.from(parent.querySelectorAll('.row'))
    const row1Before = rowsBefore[0]
    const row2Before = rowsBefore[1]

    // Reorder by key (same two rows, swapped) — same underlying row data/id.
    extRows.set([
      { id: 2, cells: [{ id: 20, v: 'c' }] },
      { id: 1, cells: [{ id: 10, v: 'a' }] },
    ])
    app.flushSync()

    const rowsAfter = Array.from(parent.querySelectorAll('.row'))

    return {
      textsAfter: rowsAfter.map((r) => r.textContent),
      row1Identity: rowsAfter[1] === row1Before,
      row2Identity: rowsAfter[0] === row2Before,
    }
  })

  expect(result.textsAfter).toEqual(['c', 'a'])
  expect(
    result.row1Identity && result.row2Identity,
    'A′: outer <each> keyed row identity must survive a reorder unaffected by the nested <recycle>',
  ).toBe(true)
})

// Disposal deficit derivation (same methodology as each-in-each above): signal()
// is intentionally owner-less (src/core/core.ts) and never freed via the owner-
// tree cascade. Outer <each let={row}> has no index binding (itemReadsIndex
// false) → 1 unowned valueSig per row (2 rows = 2). Inner <recycle let={cell, i}>
// NEVER elides its indexSig (wireRecycledList mirrors wireList's Op-1 growth path
// exactly but always allocates both valueSig and indexSig per pool slot) → 2
// unowned signals per pooled cell (3 cells across both rows = 6). Total expected
// deficit: 2 + 6 = 8.
const RECYCLE_IN_EACH_EXPECTED_UNOWNED_SIGNALS = 8

test("recycle-in-each disposal-through-nesting: tearing down an outer each-item disposes the nested recycle's pooled rows (owner-tree assertion, not DOM-count)", async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: requireBundle('recycle-in-each') })

  const result = await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvRecycleInEach: {
          Grid: {
            mount: (p: Element, d: Document, props?: Record<string, () => unknown>) => () => void
          }
          flushSync: () => void
          signal: <T>(v: T) => { (): T; set: (v: T) => void }
          __test: {
            nodeAllocCount: number
            nodeFreeCount: number
            resetNodeCounts: () => void
          }
        }
      }
    ).__nvRecycleInEach

    type Cell = { id: number; v: string }
    type Row = { id: number; cells: Cell[] }

    const extRows = app.signal<Row[]>([
      {
        id: 1,
        cells: [
          { id: 10, v: 'a' },
          { id: 11, v: 'b' },
        ],
      },
      { id: 2, cells: [{ id: 20, v: 'c' }] },
    ])

    app.__test.resetNodeCounts()

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const dispose = app.Grid.mount(parent, document, { rows: () => extRows() })
    app.flushSync()

    const allocAfterMount = app.__test.nodeAllocCount
    const freeAfterMount = app.__test.nodeFreeCount

    dispose()
    app.flushSync()

    const allocAfterDispose = app.__test.nodeAllocCount
    const freeAfterDispose = app.__test.nodeFreeCount
    const orphanedPooledDom = parent.querySelectorAll('.cell, .row').length

    return {
      allocAfterMount,
      freeAfterMount,
      allocAfterDispose,
      freeAfterDispose,
      orphanedPooledDom,
    }
  })

  expect(result.allocAfterMount).toBeGreaterThan(0)
  expect(result.freeAfterMount).toBe(0)
  expect(result.allocAfterDispose).toBe(result.allocAfterMount)
  expect(result.orphanedPooledDom, 'A′: dispose() must remove every pooled row/cell DOM node').toBe(
    0,
  )
  expect(
    result.allocAfterDispose - result.freeAfterDispose,
    'A′: dispose() must free every EFFECT/DERIVED/root node allocated by the nested ' +
      'recycle-in-each mount, leaving only the (by-design, owner-less) per-item/per-pool-slot ' +
      'value+index signals unfreed — see the derivation comment above this test',
  ).toBe(RECYCLE_IN_EACH_EXPECTED_UNOWNED_SIGNALS)
})
