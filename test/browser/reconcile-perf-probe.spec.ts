/**
 * reconcile-perf-probe — T2-1/T2-2/T2-3 gate (Playwright, real browser)
 *
 * Task 4 · Part C
 *
 * Verifies correctness of remove-one and swap after the prefix/suffix skip
 * (Task 2). Also measures and logs wall-clock timing for both operations
 * as real-browser evidence. The strict perf gate (FIRE condition) comes
 * from the harness numbers in Part B — these timing logs are supplementary.
 *
 * Run: pnpm test:browser test/browser/reconcile-perf-probe.spec.ts
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const benchmarkDir = join(__dirname, 'fixtures/benchmark')
const distDir = join(__dirname, 'dist')
const BUNDLE = join(distDir, 'nv-reconcile-perf-bundle.js')

// ── Build once ────────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })

  await esbuild.build({
    entryPoints: [join(benchmarkDir, 'entry.ts')],
    bundle: true,
    outfile: BUNDLE,
    format: 'iife',
    globalName: '__nvApp',
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
          build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
            path: join(repoRoot, 'src/renderer/index.ts'),
          }))
          build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
            path: join(repoRoot, 'src/renderer/runtime.ts'),
          }))
        },
      },
    ],
  })
})

// ── Shared helpers ─────────────────────────────────────────────────────────────

type AppGlobal = {
  App: { mount(p: Element, d: Document): () => void }
  flushSync(): void
}

async function mountApp(page: import('@playwright/test').Page) {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate(() => {
    ;(window as unknown as { __nvApp: AppGlobal }).__nvApp.App.mount(document.body, document)
    ;(window as unknown as { __nvApp: AppGlobal }).__nvApp.flushSync()
  })
}

async function flush(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __nvApp: AppGlobal }).__nvApp.flushSync()
  })
}

// ── T2-2: swap correctness + timing ──────────────────────────────────────────

test('T2-2 swap: rows 1 and 998 swap correctly (correctness + timing)', async ({ page }) => {
  await mountApp(page)
  await page.locator('#run').click()
  await flush(page)

  const rowCount = await page.locator('#main table tbody tr').count()
  expect(rowCount, 'setup: 1000 rows').toBe(1000)

  const label1Before = await page
    .locator('#main table tbody tr')
    .nth(1)
    .locator('a.lbl')
    .innerText()
  const label998Before = await page
    .locator('#main table tbody tr')
    .nth(998)
    .locator('a.lbl')
    .innerText()

  // Timed swap
  const swapMs = await page.evaluate(() => {
    const t0 = performance.now()
    document.querySelector<HTMLElement>('#swaprows')?.click()
    ;(window as unknown as { __nvApp: AppGlobal }).__nvApp.flushSync()
    return performance.now() - t0
  })
  console.log(`\nT2-2 swap wall-clock: ${swapMs.toFixed(2)}ms`)

  // Correctness: positions 1 and 998 exchanged
  const label1After = await page.locator('#main table tbody tr').nth(1).locator('a.lbl').innerText()
  const label998After = await page
    .locator('#main table tbody tr')
    .nth(998)
    .locator('a.lbl')
    .innerText()

  expect(label1After, 'pos 1 now has label from pos 998').toBe(label998Before)
  expect(label998After, 'pos 998 now has label from pos 1').toBe(label1Before)
  expect(await page.locator('#main table tbody tr').count(), 'row count unchanged after swap').toBe(
    1000,
  )
})

// ── T2-1: remove-one correctness + timing ─────────────────────────────────────

test('T2-1 remove-one: row 2 removed correctly (correctness + timing)', async ({ page }) => {
  await mountApp(page)
  await page.locator('#run').click()
  await flush(page)

  const rowCount = await page.locator('#main table tbody tr').count()
  expect(rowCount, 'setup: 1000 rows').toBe(1000)

  // Record label of row 3 (will shift to row 2 after removing row 2)
  const label3Before = await page
    .locator('#main table tbody tr')
    .nth(3)
    .locator('a.lbl')
    .innerText()

  // Timed remove-one (click delete on row index 2)
  const removeMs = await page.evaluate(() => {
    const deleteBtn = document
      .querySelectorAll('#main table tbody tr')[2]
      ?.querySelector('a.remove') as HTMLElement | undefined
    const t0 = performance.now()
    deleteBtn?.click()
    ;(window as unknown as { __nvApp: AppGlobal }).__nvApp.flushSync()
    return performance.now() - t0
  })
  console.log(`\nT2-1 remove-one wall-clock: ${removeMs.toFixed(2)}ms`)

  // Correctness
  const countAfter = await page.locator('#main table tbody tr').count()
  expect(countAfter, '999 rows remain').toBe(999)

  // Former row 3 is now row 2
  const label2After = await page.locator('#main table tbody tr').nth(2).locator('a.lbl').innerText()
  expect(label2After, 'former row 3 shifted to row 2').toBe(label3Before)
})
