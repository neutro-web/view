/**
 * CP-2a probe — js-framework-benchmark keyed app in .nv
 *
 * Gates:
 *   G-2a-1  builds: .nv → nvPlugin → esbuild → bundle, no diagnostics
 *   G-2a-2  all 8 ops in real browser (chromium + webkit)
 *   G-2a-3  keyed identity: swap moves DOM nodes, does not recreate them
 *   G-2a-4  bundle is TS-compiler-free (metafile assertion)
 *   G-2a-5  no src/ change (enforced by commission constraints)
 *
 * Run: pnpm test:browser --project=chromium test/browser/nv-benchmark-probe.spec.ts
 *      pnpm test:browser --project=webkit  test/browser/nv-benchmark-probe.spec.ts
 */

import { readFileSync, statSync } from 'node:fs'
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
const BUNDLE = join(distDir, 'nv-benchmark-bundle.js')

// ── Build once ────────────────────────────────────────────────────────────────

let buildMetafile: esbuild.Metafile

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })

  const result = await esbuild.build({
    entryPoints: [join(benchmarkDir, 'entry.ts')],
    bundle: true,
    outfile: BUNDLE,
    format: 'iife',
    globalName: '__nvApp',
    platform: 'browser',
    target: 'es2022',
    metafile: true,
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
  buildMetafile = result.metafile
})

// ── G-2a-1: build ─────────────────────────────────────────────────────────────

test('G-2a-1  build: bundle exists and is non-empty', () => {
  const size = statSync(BUNDLE).size
  console.log(`\nG-2a-1: bundle size = ${(size / 1024).toFixed(1)} KB`)
  expect(size).toBeGreaterThan(1000)
})

// ── G-2a-4: TS-compiler-free ──────────────────────────────────────────────────

test('G-2a-4  TS-compiler-free: no typescript in metafile inputs', () => {
  const tsInputs = Object.keys(buildMetafile.inputs).filter((p) => p.includes('typescript'))
  console.log(`\nG-2a-4: typescript inputs = ${tsInputs.length}`)
  expect(tsInputs, 'typescript must not appear in the benchmark bundle graph').toHaveLength(0)

  const size = statSync(BUNDLE).size
  expect(size, 'bundle must be < 200 KB (TS compiler would be 4+ MB)').toBeLessThan(200 * 1024)
})

// ── Shared mount helper ───────────────────────────────────────────────────────

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

// ── G-2a-2: all 8 ops in real browser ────────────────────────────────────────

test('G-2a-2  run: creates 1000 rows', async ({ page }) => {
  await mountApp(page)
  await page.locator('#run').click()
  await flush(page)
  const count = await page.locator('#main table tbody tr').count()
  console.log(`\nG-2a-2 run: row count = ${count}`)
  expect(count).toBe(1000)
})

test('G-2a-2  runlots: creates 10000 rows', async ({ page }) => {
  await mountApp(page)
  await page.locator('#runlots').click()
  await flush(page)
  const count = await page.locator('#main table tbody tr').count()
  console.log(`\nG-2a-2 runlots: row count = ${count}`)
  expect(count).toBe(10000)
})

test('G-2a-2  add: appends 1000 rows to existing 1000', async ({ page }) => {
  await mountApp(page)
  await page.locator('#run').click()
  await flush(page)
  await page.locator('#add').click()
  await flush(page)
  const count = await page.locator('#main table tbody tr').count()
  console.log(`\nG-2a-2 add: row count = ${count}`)
  expect(count).toBe(2000)
})

test('G-2a-2  update: every 10th row label gets " !!!" suffix', async ({ page }) => {
  await mountApp(page)
  await page.locator('#run').click()
  await flush(page)

  // Record label of row at index 0 (will be updated) and index 1 (won't)
  const row0Before = await page.locator('#main table tbody tr').nth(0).locator('a.lbl').innerText()
  const row1Before = await page.locator('#main table tbody tr').nth(1).locator('a.lbl').innerText()

  await page.locator('#update').click()
  await flush(page)

  const row0After = await page.locator('#main table tbody tr').nth(0).locator('a.lbl').innerText()
  const row1After = await page.locator('#main table tbody tr').nth(1).locator('a.lbl').innerText()

  console.log(`\nG-2a-2 update: row0 "${row0Before}" → "${row0After}"`)
  console.log(`G-2a-2 update: row1 "${row1Before}" → "${row1After}" (unchanged)`)

  expect(row0After).toBe(`${row0Before} !!!`)
  expect(row1After).toBe(row1Before)
})

test('G-2a-2  clear: removes all rows', async ({ page }) => {
  await mountApp(page)
  await page.locator('#run').click()
  await flush(page)
  expect(await page.locator('#main table tbody tr').count()).toBe(1000)
  await page.locator('#clear').click()
  await flush(page)
  const count = await page.locator('#main table tbody tr').count()
  console.log(`\nG-2a-2 clear: row count = ${count}`)
  expect(count).toBe(0)
})

test('G-2a-2  select: clicking label adds danger class to that row', async ({ page }) => {
  await mountApp(page)
  await page.locator('#run').click()
  await flush(page)

  // Click label on row 5 (0-indexed)
  await page.locator('#main table tbody tr').nth(5).locator('a.lbl').click()
  await flush(page)

  const hasDanger5 = await page
    .locator('#main table tbody tr')
    .nth(5)
    .evaluate((el) => el.classList.contains('danger'))
  const hasDanger0 = await page
    .locator('#main table tbody tr')
    .nth(0)
    .evaluate((el) => el.classList.contains('danger'))
  console.log(`\nG-2a-2 select: row 5 has danger = ${hasDanger5}, row 0 has danger = ${hasDanger0}`)
  expect(hasDanger5).toBe(true)
  expect(hasDanger0).toBe(false)

  // Click a different row — danger moves
  await page.locator('#main table tbody tr').nth(2).locator('a.lbl').click()
  await flush(page)
  const hasDanger5After = await page
    .locator('#main table tbody tr')
    .nth(5)
    .evaluate((el) => el.classList.contains('danger'))
  const hasDanger2After = await page
    .locator('#main table tbody tr')
    .nth(2)
    .evaluate((el) => el.classList.contains('danger'))
  expect(hasDanger5After).toBe(false)
  expect(hasDanger2After).toBe(true)
})

test('G-2a-2  remove: clicking ✕ removes that row', async ({ page }) => {
  await mountApp(page)
  await page.locator('#run').click()
  await flush(page)

  // Record label of row 3 (the one we're about to keep) before removing row 2
  const row3Label = await page.locator('#main table tbody tr').nth(3).locator('a.lbl').innerText()

  await page.locator('#main table tbody tr').nth(2).locator('a.remove').dispatchEvent('click')
  await flush(page)

  const countAfter = await page.locator('#main table tbody tr').count()
  console.log(`\nG-2a-2 remove: row count = ${countAfter}`)
  expect(countAfter).toBe(999)

  // Former row 3 is now row 2
  const newRow2Label = await page
    .locator('#main table tbody tr')
    .nth(2)
    .locator('a.lbl')
    .innerText()
  expect(newRow2Label).toBe(row3Label)
})

// ── G-leak: whitespace text-node leak probe (create-1000 → clear → create-1000) ──

test('G-leak  childNodes stable: create-1000 → clear → create-1000 = single create-1000', async ({
  page,
}) => {
  // Baseline: single create-1000 from fresh mount
  await mountApp(page)
  await page.locator('#run').click()
  await flush(page)
  const baseline = await page.evaluate(
    () => document.querySelector('#main tbody')!.childNodes.length,
  )

  // Drive: clear, then create-1000 again
  await page.locator('#clear').click()
  await flush(page)
  await page.locator('#run').click()
  await flush(page)
  const afterCycle = await page.evaluate(
    () => document.querySelector('#main tbody')!.childNodes.length,
  )

  console.log(`\nG-leak childNodes: baseline=${baseline}, after-clear-recreate=${afterCycle}`)
  expect(afterCycle, 'childNodes must not grow across create→clear→create').toBe(baseline)
})

// ── G-2a-3: keyed identity — swap moves DOM nodes ────────────────────────────

test('G-2a-3  swaprows: row positions swap + DOM nodes are moved, not recreated', async ({
  page,
}) => {
  await mountApp(page)
  await page.locator('#run').click()
  await flush(page)

  // Record labels at positions 1 and 998 (0-indexed)
  const label1 = await page.locator('#main table tbody tr').nth(1).locator('a.lbl').innerText()
  const label998 = await page.locator('#main table tbody tr').nth(998).locator('a.lbl').innerText()

  // Mark the DOM nodes with a unique attribute to verify identity after swap
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#main table tbody tr')
    rows[1]?.setAttribute('data-nv-probe', 'was-1')
    rows[998]?.setAttribute('data-nv-probe', 'was-998')
  })

  await page.locator('#swaprows').click()
  await flush(page)

  // Labels should be swapped
  const newLabel1 = await page.locator('#main table tbody tr').nth(1).locator('a.lbl').innerText()
  const newLabel998 = await page
    .locator('#main table tbody tr')
    .nth(998)
    .locator('a.lbl')
    .innerText()

  console.log('\nG-2a-3 swaprows:')
  console.log(`  pos 1: "${label1}" → "${newLabel1}"`)
  console.log(`  pos 998: "${label998}" → "${newLabel998}"`)

  expect(newLabel1).toBe(label998)
  expect(newLabel998).toBe(label1)

  // Node identity: the DOM nodes were MOVED, not recreated.
  // The data-nv-probe attribute must survive on the now-swapped nodes.
  const probe1 = await page.locator('#main table tbody tr').nth(1).getAttribute('data-nv-probe')
  const probe998 = await page.locator('#main table tbody tr').nth(998).getAttribute('data-nv-probe')

  console.log(`  DOM identity: pos1.probe="${probe1}", pos998.probe="${probe998}"`)

  expect(probe1, 'node at pos 1 must be the node that was at pos 998 (moved, not recreated)').toBe(
    'was-998',
  )
  expect(
    probe998,
    'node at pos 998 must be the node that was at pos 1 (moved, not recreated)',
  ).toBe('was-1')
})
