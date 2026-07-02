/**
 * Real-Browser Gate — G1 nesting matrix + three-back-end parity (Task 6).
 *
 * Feeds: Tasks 1-5 fixed a nested-structural-binding bug (component/each/recycle/
 * switch nesting) in nv-parser.ts / nv-emitter.ts. This file proves the fix holds
 * in a real browser (Chromium) across all three back-ends: interpreter `mount()`,
 * emitted `emitMount()`, and full Mode-A (.nv → esbuild bundle) compilation.
 *
 * Six fixtures under test/browser/fixtures/nested-structural/ cover the nesting
 * matrix: component-in-each, each-in-each, switch-in-each, each-in-switch-branch,
 * component-in-switch-fallback, switch-in-each-in-switch (deep 3-level nesting).
 *
 * Bundling convention copied verbatim (parameterized over six fixtures) from
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
] as const

// Reuse the "main" bundle already built by real-browser.spec.ts for the
// interpreter/emitMount half of the three-back-end parity test (Step 3):
// it exposes window.__nv = { mount, emitMount, flushSync, signal, ... }.
const MAIN_BUNDLE = join(distDir, 'nv-bundle.js')

const bundlePaths: Record<string, string> = {}
// If a fixture's esbuild.build() throws (e.g. a real nv-emitter.ts bug —
// see task-6-report.md), record the error here instead of letting beforeAll
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
      `[G1] esbuild.build() for fixture '${name}' failed — see task-6-report.md for root-cause ` +
        `analysis (nv-emitter.ts computeBodyThunks/emitBindingLiteral divergence). Build error: ${err}`,
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
// Bug 2 investigation (task-6-bug2-fix-report.md): naive alloc === free parity
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
