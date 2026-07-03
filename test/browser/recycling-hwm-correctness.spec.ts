/**
 * recycling-hwm-correctness — Follow-up B′ Phase 2, G1 correctness gates.
 * Tests wireRecycledList (the collapsed, HWM-pooling production implementation) via the
 * test-only mountVariant bypass harness (direct function construction, not .nv authoring —
 * see recycling-collapse-integration.spec.ts for the real-.nv-compilation counterpart).
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

type VariantHandle = {
  root: Element
  dispose(): void
  setN(n: number): void
  pool: readonly { valueSig: unknown; rootEl: Element | null }[]
  pokeBackingRow(rowIndex: number, newLabel: string): void
  replaceAll(): void
  appendRows(count: number): void
  prependRows(count: number): void
  setNNoFlush(n: number): void
  flush(): void
  setThrowOnId(id: number | null): void
}

type HWMGlobal = {
  mountVariant(p: Element, d: Document): VariantHandle
  flushSync(): void
  __test: { nodeAllocCount: number; nodeFreeCount: number; resetNodeCounts(): void }
}

type Handles = { variant: VariantHandle }

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

async function mountVariant(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate(() => {
    const g = (window as unknown as { __nvHwm: HWMGlobal }).__nvHwm
    ;(window as unknown as { __handles: unknown }).__handles = {
      variant: g.mountVariant(document.body, document),
    }
  })
}

test('G1.1 reuse correctness: shrink/regrow sequence renders correct, unique rows', async ({
  page,
}) => {
  await mountVariant(page)
  const sequence = [100, 50, 100, 500, 100]
  for (const n of sequence) {
    const ids = await page.evaluate((nn) => {
      const h = (window as unknown as { __handles: Handles }).__handles
      h.variant.setN(nn)
      return Array.from(h.variant.root.querySelectorAll('[data-id]'))
        .map((el) => el.getAttribute('data-id'))
        .sort((a, b) => Number(a) - Number(b))
    }, n)
    expect(ids.length, `N=${n} row count`).toBe(n)
    expect(new Set(ids).size, `N=${n} unique data-id count`).toBe(n)
  }
})

test('G1.2 inertness: shrunk-out row is not updated when the backing data source mutates', async ({
  page,
}) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __handles: Handles }).__handles
    // Grow to 100 so row 60 gets allocated.
    h.variant.setN(100)
    const before = h.variant.pool[60]
    const nodeExists = before?.rootEl != null
    const labelBefore = before?.rootEl != null ? before.rootEl.textContent : null

    // Shrink to 50 so row 60 becomes inactive (detached, not disposed).
    h.variant.setN(50)

    // Mutate the *backing data source* at index 60 — wireRecycledList's own
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

test('G1.3 churn elimination: variant shows zero alloc/free on shrink/regrow cycle', async ({
  page,
}) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const g = (window as unknown as { __nvHwm: HWMGlobal }).__nvHwm
    const h = (window as unknown as { __handles: Handles }).__handles
    h.variant.setN(100)
    g.__test.resetNodeCounts()
    for (let i = 0; i < 10; i++) {
      h.variant.setN(50)
      h.variant.setN(100)
    }
    return { variantAlloc: g.__test.nodeAllocCount, variantFree: g.__test.nodeFreeCount }
  })
  expect(result.variantAlloc).toBe(0)
  expect(result.variantFree).toBe(0)
})

test('G1.4 no regression to the fast path: same-N mutations allocate nothing', async ({ page }) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const g = (window as unknown as { __nvHwm: HWMGlobal }).__nvHwm
    const h = (window as unknown as { __handles: Handles }).__handles
    h.variant.setN(100)
    g.__test.resetNodeCounts()
    for (let i = 0; i < 10; i++) {
      h.variant.setN(100)
    }
    return { variantAlloc: g.__test.nodeAllocCount, variantFree: g.__test.nodeFreeCount }
  })
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

test('ADVERSARIAL: rapid grow/shrink/grow does not corrupt pool bookkeeping', async ({ page }) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __handles: Handles }).__handles
    const seq = [100, 50, 200, 10, 500, 50, 100]
    for (const n of seq) h.variant.setN(n)
    const ids = Array.from(h.variant.root.querySelectorAll('[data-id]'))
      .map((el) => el.getAttribute('data-id'))
      .sort((a, b) => Number(a) - Number(b))
    return { finalCount: ids.length, uniqueCount: new Set(ids).size, expectedN: seq.at(-1) }
  })
  expect(result.finalCount, 'row count matches final N').toBe(result.expectedN)
  expect(result.uniqueCount, 'no duplicate data-id after rapid resize').toBe(result.finalCount)
})

test('ADVERSARIAL: resize to 0 and back regrows correctly', async ({ page }) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __handles: Handles }).__handles
    h.variant.setN(100)
    h.variant.setN(0)
    const zeroCount = h.variant.root.querySelectorAll('[data-id]').length
    h.variant.setN(100)
    const ids = Array.from(h.variant.root.querySelectorAll('[data-id]'))
      .map((el) => el.getAttribute('data-id'))
      .sort((a, b) => Number(a) - Number(b))
    return { zeroCount, regrowCount: ids.length, uniqueCount: new Set(ids).size }
  })
  expect(result.zeroCount, 'N=0 renders zero rows').toBe(0)
  expect(result.regrowCount, 'regrow from 0 matches N=100').toBe(100)
  expect(result.uniqueCount, 'no duplicate ids on regrow-from-0').toBe(100)
})

test('ADVERSARIAL: resize interleaved with replace/append/prepend stays correct', async ({
  page,
}) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __handles: Handles }).__handles
    h.variant.setN(100)
    h.variant.replaceAll()
    h.variant.setN(50)
    h.variant.appendRows(20)
    h.variant.setN(150)
    h.variant.prependRows(10)
    h.variant.setN(80)
    const ids = Array.from(h.variant.root.querySelectorAll('[data-id]'))
      .map((el) => el.getAttribute('data-id'))
      .sort((a, b) => Number(a) - Number(b))
    return { count: ids.length, uniqueCount: new Set(ids).size }
  })
  expect(result.count, 'final row count matches final N').toBe(80)
  expect(result.uniqueCount, 'no duplicate ids after interleaved mutation').toBe(80)
})

test('ADVERSARIAL: resize during pending effects does not lose or duplicate rows', async ({
  page,
}) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __handles: Handles }).__handles
    // Rapid unflushed setN calls before any flush — exercises the resize effect
    // coalescing multiple pending writes into one recompute, not one per call.
    h.variant.setNNoFlush(100)
    h.variant.setNNoFlush(30)
    h.variant.setNNoFlush(300)
    h.variant.flush()
    const ids = Array.from(h.variant.root.querySelectorAll('[data-id]'))
      .map((el) => el.getAttribute('data-id'))
      .sort((a, b) => Number(a) - Number(b))
    return { count: ids.length, uniqueCount: new Set(ids).size }
  })
  expect(result.count, 'coalesced resize lands on final N').toBe(300)
  expect(result.uniqueCount, 'no duplicate ids after coalesced resize').toBe(300)
})

test('BOUNDED MEMORY: repeated 50<->100 resize loop never grows pool past the high-water-mark', async ({
  page,
}) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __handles: Handles }).__handles
    h.variant.setN(100) // establish high-water-mark = 100
    const hwmAfterFirstGrow = h.variant.pool.length
    for (let i = 0; i < 20; i++) {
      h.variant.setN(50)
      h.variant.setN(100)
    }
    return { hwmAfterFirstGrow, poolLengthAfter20Cycles: h.variant.pool.length }
  })
  expect(result.hwmAfterFirstGrow, 'pool reaches exactly 100 on first grow').toBe(100)
  expect(
    result.poolLengthAfter20Cycles,
    'pool length never exceeds the high-water-mark across repeated cycles',
  ).toBe(100)
})

test('BOUNDED MEMORY: reactive-node count stabilizes after high-water-mark is reached (Addition 1)', async ({
  page,
}) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const g = (window as unknown as { __nvHwm: HWMGlobal }).__nvHwm
    const h = (window as unknown as { __handles: Handles }).__handles
    const test = g.__test
    h.variant.setN(100) // establish high-water-mark = 100, discard this allocation from the count
    test.resetNodeCounts()
    // 30 more resize cycles at or below the established high-water-mark.
    for (let i = 0; i < 30; i++) {
      h.variant.setN(50)
      h.variant.setN(100)
    }
    return {
      allocAfter30Cycles: test.nodeAllocCount,
      freeAfter30Cycles: test.nodeFreeCount,
    }
  })
  expect(
    result.allocAfter30Cycles,
    'zero further reactive-node allocation once the high-water-mark is established — retained nodes are reused, not reallocated, so held cost does not grow with cycle count',
  ).toBe(0)
  expect(result.freeAfter30Cycles, 'zero disposal during resize — retention, not teardown').toBe(0)
})

test('FAULT TOLERANCE: partial grow failure keeps activeCount/pool bookkeeping consistent (self-heals on next resize)', async ({
  page,
}) => {
  // NOTE: mount + fault injection + first resize must all happen inside ONE
  // page.evaluate() call. effect() schedules an async flush at creation
  // (core.ts scheduleFlush) — if mounting and the first setN() are split
  // across two separate evaluate() calls (as mountVariant()+a later evaluate
  // would do), the IPC round-trip between them is enough of an event-loop
  // turn for that scheduled flush to fire on its own, rendering the default
  // windowN=50 BEFORE setThrowOnId() is ever set — turning "grow 0->5 with a
  // fault" into an untested "shrink 50->5 with no fault" instead.
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  const result = await page.evaluate(() => {
    const g = (window as unknown as { __nvHwm: HWMGlobal }).__nvHwm
    const h = g.mountVariant(document.body, document)
    // Run 1: grow 0 -> 5, itemTemplate throws while constructing the row for id=3
    // (the reactive core swallows the throw internally — routeErrorFrom finds no
    // errorBoundary and logs to console; it never rethrows out of flushSync()).
    h.setThrowOnId(3)
    h.setN(5)
    const domCountAfterFault = h.root.querySelectorAll('[data-id]').length

    // Run 2: shrink to 1, fault cleared. If activeCount correctly reflects only
    // the rows actually committed before the Run-1 throw (not the full requested
    // N=5), this shrink must reclaim every row above index 0 — including the
    // ones Run 1 created before failing — leaving exactly 1 row in the DOM.
    h.setThrowOnId(null)
    h.setN(1)
    const domCountAfterRecovery = h.root.querySelectorAll('[data-id]').length

    return { domCountAfterFault, domCountAfterRecovery }
  })
  // Run 1 partially succeeds (rows for id=0,1,2 construct fine before id=3 throws) —
  // some rows are expected in the DOM, just not the full requested 5.
  expect(result.domCountAfterFault, 'partial grow leaves the successfully-built rows visible').toBe(
    3,
  )
  // The load-bearing assertion: after Run 1's partial failure, a subsequent shrink
  // to N=1 must leave exactly 1 row — not 3 — proving activeCount tracked the real
  // committed state (3), not an unadvanced stale value that would leave rows 1
  // and 2 permanently orphaned and un-reclaimable by any future resize.
  expect(
    result.domCountAfterRecovery,
    'a later resize must reclaim every row the failed grow left behind, not just the requested delta',
  ).toBe(1)
})
