/**
 * recycling-hwm-correctness — Follow-up B′ Phase 1, G1 correctness gates.
 * Tests the wireRecycledListHWM prototype in isolation (not wired to <recycle> authoring).
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixtureDir = join(__dirname, 'fixtures/recycling-hwm')
const distDir = join(__dirname, 'dist')
const BUNDLE = join(distDir, 'nv-recycling-hwm-bundle.js')

type CurrentHandle = { root: Element; dispose(): void; setN(n: number): void }
type VariantHandle = {
  root: Element
  dispose(): void
  setN(n: number): void
  pool: Record<number, { valueSig: unknown; rootEl: Element | null }>
  pokeBackingRow(rowIndex: number, newLabel: string): void
}

type HWMGlobal = {
  mountCurrent(p: Element, d: Document): CurrentHandle
  mountVariant(p: Element, d: Document): VariantHandle
  flushSync(): void
  __test: { nodeAllocCount: number; nodeFreeCount: number; resetNodeCounts(): void }
}

type Handles = { current: CurrentHandle; variant: VariantHandle }

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })
  await esbuild.build({
    entryPoints: [join(fixtureDir, 'entry.ts')],
    bundle: true,
    outfile: BUNDLE,
    format: 'iife',
    globalName: '__nvHwm',
    platform: 'browser',
    target: 'es2022',
    metafile: false,
    sourcemap: false,
    minify: false,
    plugins: [
      nvPlugin(),
      {
        name: 'ts-resolve',
        setup(build) {
          build.onResolve({ filter: /\.js$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts')),
          }))
        },
      },
      {
        name: 'neutro-alias',
        setup(build) {
          build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({
            path: join(repoRoot, 'src/core/index.ts'),
          }))
          build.onResolve({ filter: /^@neutro\/view\/core\/internal$/ }, () => ({
            path: join(repoRoot, 'src/core/core.ts'),
          }))
          build.onResolve({ filter: /^@neutro\/view\/renderer\/internal$/ }, () => ({
            path: join(repoRoot, 'src/renderer/interpreter.ts'),
          }))
        },
      },
    ],
  })
})

async function mountBoth(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate(() => {
    const g = (window as unknown as { __nvHwm: HWMGlobal }).__nvHwm
    ;(window as unknown as { __handles: unknown }).__handles = {
      current: g.mountCurrent(document.body, document),
      variant: g.mountVariant(document.body, document),
    }
  })
}

test('G1.1 reuse correctness: shrink/regrow sequence renders identical row sets on current vs variant', async ({
  page,
}) => {
  await mountBoth(page)
  const sequence = [100, 50, 100, 500, 100]
  for (const n of sequence) {
    const [currentIds, variantIds] = await page.evaluate((nn) => {
      const h = (window as unknown as { __handles: Handles }).__handles
      h.current.setN(nn)
      h.variant.setN(nn)
      const idsOf = (root: Element) =>
        Array.from(root.querySelectorAll('[data-id]'))
          .map((el) => el.getAttribute('data-id'))
          .sort((a, b) => Number(a) - Number(b))
      return [idsOf(h.current.root), idsOf(h.variant.root)]
    }, n)
    expect(variantIds, `mismatch at N=${n}`).toEqual(currentIds)
    expect(currentIds.length, `N=${n} row count`).toBe(n)
  }
})

test('G1.2 inertness: shrunk-out row is not updated when the backing data source mutates', async ({
  page,
}) => {
  await mountBoth(page)
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __handles: Handles }).__handles
    // Grow to 100 so row 60 gets allocated.
    h.variant.setN(100)
    const before = h.variant.pool[60]
    const nodeExists = before?.rootEl != null
    const labelBefore = before?.rootEl != null ? before.rootEl.textContent : null

    // Shrink to 50 so row 60 becomes inactive (detached, not disposed).
    h.variant.setN(50)

    // Mutate the *backing data source* at index 60 — wireRecycledListHWM's own
    // resize/rebind effect must not propagate this into the inactive slot, since
    // its rebind loop only touches [0, activeCount).
    h.variant.pokeBackingRow(60, 'MUTATED')

    const after = h.variant.pool[60]
    return {
      nodeExists,
      labelBefore,
      attached: after?.rootEl?.isConnected ?? false,
      labelAfter: after?.rootEl != null ? after.rootEl.textContent : null,
    }
  })
  expect(result.nodeExists).toBe(true)
  expect(result.attached, 'row 60 should still be detached from the document').toBe(false)
  expect(
    result.labelAfter,
    'row 60 rendered content must be unchanged by a backing-data write while inactive',
  ).toBe(result.labelBefore)
  expect(result.labelAfter).not.toBe('MUTATED')
})

test('G1.3 churn elimination: variant shows zero alloc/free on shrink/regrow cycle; current does not', async ({
  page,
}) => {
  await mountBoth(page)
  const result = await page.evaluate(() => {
    const g = (window as unknown as { __nvHwm: HWMGlobal }).__nvHwm
    const h = (window as unknown as { __handles: Handles }).__handles
    // Warm both up to 100 first so subsequent 100<->50 cycling is pure reuse/dispose,
    // not first-allocation.
    h.current.setN(100)
    h.variant.setN(100)
    g.__test.resetNodeCounts()
    for (let i = 0; i < 10; i++) {
      h.current.setN(50)
      h.current.setN(100)
    }
    const currentAlloc = g.__test.nodeAllocCount
    const currentFree = g.__test.nodeFreeCount
    g.__test.resetNodeCounts()
    for (let i = 0; i < 10; i++) {
      h.variant.setN(50)
      h.variant.setN(100)
    }
    const variantAlloc = g.__test.nodeAllocCount
    const variantFree = g.__test.nodeFreeCount
    return { currentAlloc, currentFree, variantAlloc, variantFree }
  })
  expect(result.variantAlloc).toBe(0)
  expect(result.variantFree).toBe(0)
  expect(result.currentAlloc).toBeGreaterThan(0)
})

test('G1.4 no regression to the fast path: same-N mutations allocate nothing on either implementation', async ({
  page,
}) => {
  await mountBoth(page)
  const result = await page.evaluate(() => {
    const g = (window as unknown as { __nvHwm: HWMGlobal }).__nvHwm
    const h = (window as unknown as { __handles: Handles }).__handles
    h.current.setN(100)
    h.variant.setN(100)
    g.__test.resetNodeCounts()
    for (let i = 0; i < 10; i++) {
      h.current.setN(100)
    }
    const currentAlloc = g.__test.nodeAllocCount
    const currentFree = g.__test.nodeFreeCount
    g.__test.resetNodeCounts()
    for (let i = 0; i < 10; i++) {
      h.variant.setN(100)
    }
    const variantAlloc = g.__test.nodeAllocCount
    const variantFree = g.__test.nodeFreeCount
    return { currentAlloc, currentFree, variantAlloc, variantFree }
  })
  expect(result.currentAlloc).toBe(0)
  expect(result.currentFree).toBe(0)
  expect(result.variantAlloc).toBe(0)
  expect(result.variantFree).toBe(0)
})

test('G1.5 disposal on teardown: dispose() frees the entire retained pool, not just active slots', async ({
  page,
}) => {
  // nodeFreeCount instruments reactive-core node disposal (owner scope + per-binding
  // effects), not raw DOM node removal, so a shrunk-then-disposed pool of size N frees
  // a fixed multiple of N reactive nodes, not literally N. Rather than hardcode that
  // multiplier (an implementation detail of the item template's binding count), assert
  // the invariant the gate actually cares about: disposing after a shrink frees exactly
  // as many reactive nodes as disposing the same high-water-mark WITHOUT ever shrinking
  // — i.e. onCleanup walks the full retained pool, not just the active slots.
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  const result = await page.evaluate(() => {
    const g = (window as unknown as { __nvHwm: HWMGlobal }).__nvHwm

    // Scenario A: grow to 500, shrink to 100, then dispose.
    const a = g.mountVariant(document.body, document)
    a.setN(500)
    a.setN(100)
    g.__test.resetNodeCounts()
    a.dispose()
    const freeAfterShrink = g.__test.nodeFreeCount

    // Scenario B: grow to 500, no shrink, then dispose. Same high-water-mark (500).
    const b = g.mountVariant(document.body, document)
    b.setN(500)
    g.__test.resetNodeCounts()
    b.dispose()
    const freeNoShrink = g.__test.nodeFreeCount

    return { freeAfterShrink, freeNoShrink }
  })
  expect(result.freeAfterShrink, 'shrink-then-dispose must free the full HWM-sized pool').toBe(
    result.freeNoShrink,
  )
  expect(result.freeAfterShrink).toBeGreaterThan(0)
})
