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
import {
  type MutationScenario,
  SCENARIOS,
  mutationStep,
} from './fixtures/recycling-churn/scenarios.js'

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
  n: 50 | 100 = 50,
): Promise<void> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate((armName) => {
    const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
    g[armName].mount(document.body, document)
    g.flushSync()
  }, arm)
  if (n === 100) {
    await page.locator('#set-n-100').click()
    await page.evaluate(() => {
      ;(window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn.flushSync()
    })
  }
}

async function scrollStep(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#scroll-step').click()
  await page.evaluate(() => {
    ;(window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn.flushSync()
  })
}

async function flushChurn(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn.flushSync()
  })
}

async function runChurnScenario(
  page: import('@playwright/test').Page,
  arm: 'AppRecycled' | 'AppKeyed',
  scenario: MutationScenario,
): Promise<{ allocCount: number; freeCount: number }> {
  await mountArm(page, arm)

  await page.evaluate(() => {
    ;(window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn.__test.resetNodeCounts()
  })
  for (let i = 0; i < WARMUP_STEPS; i++) {
    await mutationStep(page, scenario, () => flushChurn(page))
  }

  await page.evaluate(() => {
    ;(window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn.__test.resetNodeCounts()
  })
  for (let i = 0; i < MEASURED_STEPS; i++) {
    await mutationStep(page, scenario, () => flushChurn(page))
  }

  return page.evaluate(() => {
    const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
    return { allocCount: g.__test.nodeAllocCount, freeCount: g.__test.nodeFreeCount }
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

test('A3 wall-clock: log scroll-step timing both arms, N=50 and N=100 (supplementary — never asserted)', async ({
  page,
}) => {
  async function measureArm(arm: 'AppRecycled' | 'AppKeyed', n: 50 | 100): Promise<number[]> {
    await mountArm(page, arm, n)
    // warmup
    for (let i = 0; i < WARMUP_STEPS; i++) await scrollStep(page)
    // measured — time each step inside the browser to exclude round-trip overhead
    const times: number[] = []
    for (let i = 0; i < MEASURED_STEPS; i++) {
      const ms = await page.evaluate(() => {
        const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
        const btn = document.querySelector<HTMLElement>('#scroll-step')!
        const t0 = performance.now()
        btn.click()
        g.flushSync()
        return performance.now() - t0
      })
      times.push(ms)
    }
    return times
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
  const max = (arr: number[]) => Math.max(...arr)

  for (const n of [50, 100] as const) {
    const recycledTimes = await measureArm('AppRecycled', n)
    const keyedTimes = await measureArm('AppKeyed', n)
    console.log(`\nA3 wall-clock N=${n}:`)
    console.log(
      `  recycled avg=${avg(recycledTimes).toFixed(2)}ms max=${max(recycledTimes).toFixed(2)}ms`,
    )
    console.log(
      `  keyed    avg=${avg(keyedTimes).toFixed(2)}ms max=${max(keyedTimes).toFixed(2)}ms`,
    )
  }

  // No timing assertion — supplementary evidence only
  expect(true).toBe(true)
})

for (const scenario of SCENARIOS) {
  if (scenario.mode === 'failable') {
    test(`A2 matrix — ${scenario.label} — recycled: zero churn (FIRE)`, async ({ page }) => {
      const { allocCount, freeCount } = await runChurnScenario(page, 'AppRecycled', scenario)
      console.log(`\nA2 matrix [${scenario.key}] recycled — alloc=${allocCount} free=${freeCount}`)
      expect(allocCount, `${scenario.key}: zero ReactiveNode allocations`).toBe(0)
      expect(freeCount, `${scenario.key}: zero ReactiveNode frees`).toBe(0)
    })

    test(`A2 matrix — ${scenario.label} — keyed control: churn > 0`, async ({ page }) => {
      const { allocCount } = await runChurnScenario(page, 'AppKeyed', scenario)
      console.log(`\nA2 matrix [${scenario.key}] keyed — alloc=${allocCount}`)
      expect(
        allocCount,
        `${scenario.key}: keyed control shows non-zero allocations (proves churn detectable)`,
      ).toBeGreaterThan(0)
    })
  } else {
    test(`ADVISORY A2 matrix — ${scenario.label} — recycled (logged, never asserted — retained for historical trend evidence)`, async ({
      page,
    }) => {
      const { allocCount, freeCount } = await runChurnScenario(page, 'AppRecycled', scenario)
      console.log(
        `\nADVISORY A2 matrix [${scenario.key}] recycled — alloc=${allocCount} free=${freeCount} (post-Follow-up-B' collapse: wireRecycledList retains pool state across windowN resize, so this is expected to be zero — kept advisory rather than promoted to failable per docs/superpowers/plans/2026-07-03-followup-b-prime-phase2-hwm-hardening.md Step 3c)`,
      )
      expect(true).toBe(true)
    })
  }
}

async function assertResizeCorrectness(
  page: import('@playwright/test').Page,
  arm: 'AppRecycled' | 'AppKeyed',
): Promise<void> {
  await mountArm(page, arm)
  for (const [lowBtn, highBtn] of [
    ['#set-n-50', '#set-n-100'],
    ['#set-n-500', '#set-n-1000'],
    ['#set-n-100', '#set-n-5000'],
  ] as const) {
    await page.locator(highBtn).click()
    await flushChurn(page)
    const highCount = await page.locator('.row').count()
    await page.locator(lowBtn).click()
    await flushChurn(page)
    const lowCount = await page.locator('.row').count()
    await page.locator(highBtn).click()
    await flushChurn(page)
    const regrowCount = await page.locator('.row').count()
    const regrowIds = await page
      .locator('.row')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-id')))
    expect(new Set(regrowIds).size, `${highBtn}: regrown rows have unique data-id`).toBe(
      regrowIds.length,
    )
    expect(regrowCount, `${highBtn}: regrow count matches high-N click`).toBe(highCount)
    expect(lowCount, `${lowBtn}: shrink count matches low-N click`).toBeLessThan(highCount)
  }
}

test('standing resize correctness: rows render correctly across all magnitudes (recycled)', async ({
  page,
}) => {
  await assertResizeCorrectness(page, 'AppRecycled')
})

test('standing resize correctness: rows render correctly across all magnitudes (keyed)', async ({
  page,
}) => {
  await assertResizeCorrectness(page, 'AppKeyed')
})
