/**
 * nv-benchmark-conditional — ADVISORY baseline for <conditional> and <switch>
 *
 * No load-bearing perf claim exists for these constructs; this records wall-clock
 * + node-alloc/free numbers for future same-session before/after comparison.
 * ADVISORY ONLY — logged, never asserted (no failable perf gate on these constructs).
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixtureDir = join(__dirname, 'fixtures/benchmark-conditional')
const distDir = join(__dirname, 'dist')
const BUNDLE = join(distDir, 'nv-benchmark-conditional-bundle.js')

const WARMUP_STEPS = 5
const MEASURED_STEPS = 40

type CondGlobal = {
  AppConditional: { mount(p: Element, d: Document): () => void }
  AppSwitch: { mount(p: Element, d: Document): () => void }
  flushSync(): void
  __test: { nodeAllocCount: number; nodeFreeCount: number; resetNodeCounts(): void }
}

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })
  await esbuild.build({
    entryPoints: [join(fixtureDir, 'entry.ts')],
    bundle: true,
    outfile: BUNDLE,
    format: 'iife',
    globalName: '__nvCond',
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
          build.onResolve({ filter: /^@neutro\/view\/core\/internal$/ }, () => ({
            path: join(repoRoot, 'src/core/core.ts'),
          }))
        },
      },
    ],
  })
})

async function mountArm(
  page: import('@playwright/test').Page,
  arm: 'AppConditional' | 'AppSwitch',
): Promise<void> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate((armName) => {
    const g = (window as unknown as { __nvCond: CondGlobal }).__nvCond
    g[armName].mount(document.body, document)
    g.flushSync()
  }, arm)
}

async function flush(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __nvCond: CondGlobal }).__nvCond.flushSync()
  })
}

async function measure(
  page: import('@playwright/test').Page,
  arm: 'AppConditional' | 'AppSwitch',
  buttonId: string,
): Promise<{ avgMs: number; maxMs: number; allocCount: number; freeCount: number }> {
  await mountArm(page, arm)
  for (let i = 0; i < WARMUP_STEPS; i++) {
    await page.locator(buttonId).click()
    await flush(page)
  }
  await page.evaluate(() => {
    ;(window as unknown as { __nvCond: CondGlobal }).__nvCond.__test.resetNodeCounts()
  })
  const times: number[] = []
  for (let i = 0; i < MEASURED_STEPS; i++) {
    const t0 = Date.now()
    await page.locator(buttonId).click()
    await flush(page)
    times.push(Date.now() - t0)
  }
  const { allocCount, freeCount } = await page.evaluate(() => {
    const g = (window as unknown as { __nvCond: CondGlobal }).__nvCond
    return { allocCount: g.__test.nodeAllocCount, freeCount: g.__test.nodeFreeCount }
  })
  return {
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    maxMs: Math.max(...times),
    allocCount,
    freeCount,
  }
}

test('ADVISORY: conditional branch-swap baseline (logged, never asserted)', async ({ page }) => {
  const r = await measure(page, 'AppConditional', '#toggle')
  console.log(
    `\nADVISORY [conditional toggle] avg=${r.avgMs.toFixed(2)}ms max=${r.maxMs.toFixed(2)}ms alloc=${r.allocCount} free=${r.freeCount} over ${MEASURED_STEPS} toggles`,
  )
  expect(true).toBe(true)
})

test('ADVISORY: switch 5-branch cycle baseline (logged, never asserted)', async ({ page }) => {
  const r = await measure(page, 'AppSwitch', '#cycle')
  console.log(
    `\nADVISORY [switch cycle] avg=${r.avgMs.toFixed(2)}ms max=${r.maxMs.toFixed(2)}ms alloc=${r.allocCount} free=${r.freeCount} over ${MEASURED_STEPS} cycles`,
  )
  expect(true).toBe(true)
})
