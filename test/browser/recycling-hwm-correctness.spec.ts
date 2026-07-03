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

test('G1.5 disposal: total node frees across a scenario are the same whether freed via cap-eviction or final teardown', async ({
  page,
}) => {
  // Cap-eviction (added in Follow-up B'-cap) disposes evicted rows immediately at
  // shrink time, not just at teardown — so the count must span the whole scenario,
  // not just the final dispose() call, for the two scenarios to be comparable.
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  const result = await page.evaluate(() => {
    const g = (window as unknown as { __nvHwm: HWMGlobal }).__nvHwm

    // Scenario A: grow to 500, reset, shrink to 100 (evicts 300 immediately under
    // the cap), then dispose (frees the remaining 200). Total counted from reset.
    const a = g.mountVariant(document.body, document)
    a.setN(500)
    g.__test.resetNodeCounts()
    a.setN(100)
    const freeDuringEviction = g.__test.nodeFreeCount
    a.dispose()
    const freeAfterShrinkTotal = g.__test.nodeFreeCount

    // Scenario B: grow to 500, reset, no shrink, then dispose (frees all 500 at once).
    const b = g.mountVariant(document.body, document)
    b.setN(500)
    g.__test.resetNodeCounts()
    b.dispose()
    const freeNoShrinkTotal = g.__test.nodeFreeCount

    return { freeDuringEviction, freeAfterShrinkTotal, freeNoShrinkTotal }
  })
  expect(
    result.freeDuringEviction,
    'eviction at shrink time frees rows immediately, not deferred',
  ).toBeGreaterThan(0)
  expect(
    result.freeAfterShrinkTotal,
    'total frees across the scenario (eviction + final teardown) must equal the never-shrunk baseline — nothing leaked, nothing double-counted',
  ).toBe(result.freeNoShrinkTotal)
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

test('CAP: retained pool never exceeds 2x active count after a shrink', async ({ page }) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __handles: Handles }).__handles
    h.variant.setN(1000) // establish a large high-water-mark
    h.variant.setN(50) // shrink hard — retained-inactive would be 950 uncapped
    const poolLengthAfterShrink = h.variant.pool.length
    h.variant.setN(200) // grow past the shrunk pool — forces fresh allocation, pool.length
    // becomes exactly 200 (not a cap-eviction event; the cap only fires on shrink)
    h.variant.setN(30) // shrink again — THIS is where the cap re-evaluates, to 2*30=60
    const poolLengthAfterSecondShrink = h.variant.pool.length
    return { poolLengthAfterShrink, poolLengthAfterSecondShrink }
  })
  // Cap = 2 * activeCount. After shrinking 1000 -> 50, activeCount = 50, so
  // pool.length must not exceed 2*50 = 100 (not the uncapped 1000).
  expect(
    result.poolLengthAfterShrink,
    'pool length must be bounded by 2x the post-shrink active count, not the historical high-water-mark',
  ).toBeLessThanOrEqual(100)
  // After the second shrink (to 30), cap = 2*30 = 60.
  expect(
    result.poolLengthAfterSecondShrink,
    'cap re-evaluates fresh on every shrink',
  ).toBeLessThanOrEqual(60)
})

test('CAP: evicted rows are genuinely disposed (reactive nodes freed, not just array-truncated)', async ({
  page,
}) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const g = (window as unknown as { __nvHwm: HWMGlobal }).__nvHwm
    const h = (window as unknown as { __handles: Handles }).__handles
    h.variant.setN(500)
    g.__test.resetNodeCounts()
    h.variant.setN(10) // shrink hard — cap = 20, so ~480 rows must be evicted+disposed
    return { freeCount: g.__test.nodeFreeCount, poolLength: h.variant.pool.length }
  })
  expect(result.poolLength, 'pool truncated to the cap (2*10=20)').toBeLessThanOrEqual(20)
  expect(
    result.freeCount,
    'evicted rows must be disposed (nodeFreeCount > 0), not merely dropped from the array',
  ).toBeGreaterThan(0)
})

test('CAP: regrow after eviction still produces correct, unique rows', async ({ page }) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __handles: Handles }).__handles
    h.variant.setN(500)
    h.variant.setN(10) // evicts most of the pool (cap=20)
    h.variant.setN(500) // regrow past the evicted range — must allocate fresh, not read stale/disposed rows
    const ids = Array.from(h.variant.root.querySelectorAll('[data-id]'))
      .map((el) => el.getAttribute('data-id'))
      .sort((a, b) => Number(a) - Number(b))
    return { count: ids.length, uniqueCount: new Set(ids).size }
  })
  expect(result.count, 'regrow past an evicted range still produces the full requested count').toBe(
    500,
  )
  expect(result.uniqueCount, 'no duplicate or corrupted ids after eviction + regrow').toBe(500)
})

test('CAP: N=0 evicts the entire retained pool (deliberate "no floor" consequence)', async ({
  page,
}) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __handles: Handles }).__handles
    h.variant.setN(200)
    h.variant.setN(0) // cap = 0 * 2 = 0 — the entire retained pool must be evicted, not just detached
    return { poolLengthAtZero: h.variant.pool.length }
  })
  // This is the intended behavior of "no floor," not an accidental edge case: a
  // transient empty state (e.g. clear/filter-to-no-results) gets zero retention
  // benefit on the next regrow. Documented explicitly here so it's a recorded
  // decision, not a silent side effect nobody noticed.
  expect(result.poolLengthAtZero, 'shrinking to N=0 evicts the entire pool (cap=0)').toBe(0)
})

test('CAP: pure-reuse regrow (no allocation) never exceeds the new cap', async ({ page }) => {
  await mountVariant(page)
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __handles: Handles }).__handles
    h.variant.setN(100) // pool.length = 100, activeCount = 100
    h.variant.setN(50) // shrink: cap = 2*50 = 100. pool.length(100) is NOT > 100, so no eviction fires — pool.length stays 100
    const poolLengthAfterShrink = h.variant.pool.length
    // Regrow to 80 — this is activeCount(50) < N(80) <= P(100), a PURE REUSE grow
    // (no allocation, since P already covers it). pool.length must stay unchanged
    // at 100 and must not exceed the new cap (2*80=160) — proving growth alone,
    // without passing through the shrink branch's eviction logic, can never
    // violate the cap (see the plan's Global Constraints for the proof).
    h.variant.setN(80)
    const poolLengthAfterPureReuseRegrow = h.variant.pool.length
    return { poolLengthAfterShrink, poolLengthAfterPureReuseRegrow }
  })
  expect(
    result.poolLengthAfterShrink,
    'exact-boundary shrink (pool.length === cap) does not evict',
  ).toBe(100)
  expect(
    result.poolLengthAfterPureReuseRegrow,
    'pure-reuse regrow (no allocation) leaves pool.length unchanged and within the new cap',
  ).toBe(100)
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
