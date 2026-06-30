/**
 * recycling-node-churn — Part A gate (Playwright, real browser)
 *
 * A2: FIRE — recycled steady-state nodeAllocCount === 0 AND nodeFreeCount === 0
 * A2: Contrast — keyed control nodeAllocCount > 0
 * A3: Wall-clock logged (never asserted)
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixtureDir = join(__dirname, 'fixtures/recycling-churn')
const distDir = join(__dirname, 'dist')
const BUNDLE = join(distDir, 'nv-recycling-churn-bundle.js')

const WARMUP_STEPS = 5
const MEASURED_STEPS = 40
const WINDOW_N = 50

type ChurnGlobal = {
  AppRecycled: { mount(p: Element, d: Document): () => void }
  AppKeyed: { mount(p: Element, d: Document): () => void }
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
    globalName: '__nvChurn',
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
  arm: 'AppRecycled' | 'AppKeyed',
): Promise<void> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate((armName) => {
    const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
    g[armName].mount(document.body, document)
    g.flushSync()
  }, arm)
}

async function scrollStep(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#scroll-step').click()
  await page.evaluate(() => {
    ;(window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn.flushSync()
  })
}

test('A2 recycled: nodeAllocCount === 0 AND nodeFreeCount === 0 in steady-state (FIRE)', async ({
  page,
}) => {
  await mountArm(page, 'AppRecycled')

  // Warmup — warms the link free-list pool; counts discarded
  await page.evaluate(() => {
    const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
    g.__test.resetNodeCounts()
  })
  for (let i = 0; i < WARMUP_STEPS; i++) {
    await scrollStep(page)
  }

  // Reset for measurement
  await page.evaluate(() => {
    const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
    g.__test.resetNodeCounts()
  })

  for (let i = 0; i < MEASURED_STEPS; i++) {
    await scrollStep(page)
  }

  const { allocCount, freeCount } = await page.evaluate(() => {
    const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
    return { allocCount: g.__test.nodeAllocCount, freeCount: g.__test.nodeFreeCount }
  })

  console.log(
    `\nA2 recycled N=${WINDOW_N} — nodeAllocCount=${allocCount} nodeFreeCount=${freeCount} over ${MEASURED_STEPS} steps`,
  )
  expect(allocCount, 'recycled steady-state: zero ReactiveNode allocations').toBe(0)
  expect(freeCount, 'recycled steady-state: zero ReactiveNode frees').toBe(0)
})

test('A2 keyed control: nodeAllocCount > 0 (confirms churn is real in keyed mode)', async ({
  page,
}) => {
  await mountArm(page, 'AppKeyed')

  await page.evaluate(() => {
    const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
    g.__test.resetNodeCounts()
  })
  for (let i = 0; i < WARMUP_STEPS; i++) {
    await scrollStep(page)
  }

  await page.evaluate(() => {
    const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
    g.__test.resetNodeCounts()
  })

  for (let i = 0; i < MEASURED_STEPS; i++) {
    await scrollStep(page)
  }

  const { allocCount, freeCount } = await page.evaluate(() => {
    const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
    return { allocCount: g.__test.nodeAllocCount, freeCount: g.__test.nodeFreeCount }
  })

  console.log(
    `\nA2 keyed N=${WINDOW_N} — nodeAllocCount=${allocCount} nodeFreeCount=${freeCount} over ${MEASURED_STEPS} steps`,
  )
  expect(
    allocCount,
    'keyed control: non-zero ReactiveNode allocations (proves churn)',
  ).toBeGreaterThan(0)
})
