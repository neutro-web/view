/**
 * nv-benchmark-recycle — advisory wall-clock for the <recycle> mutation matrix
 *
 * In-repo nv-only venue (see docs/superpowers/plans/2026-07-02-followup-b-perf-harness.md
 * "Correction to the commission's premise" — no Solid/Svelte/Lit/React/Vanilla foil
 * harness exists in this repo; that comparison remains the external, manual CP-2d
 * process). Timing here is ADVISORY ONLY — logged, never asserted.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'
import { SCENARIOS, mutationStep } from './fixtures/recycling-churn/scenarios.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixtureDir = join(__dirname, 'fixtures/recycling-churn')
const distDir = join(__dirname, 'dist')
const BUNDLE = join(distDir, 'nv-recycling-churn-bundle.js')

const WARMUP_STEPS = 5
const MEASURED_STEPS = 40

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

async function flushChurn(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn.flushSync()
  })
}

// One test per (scenario, arm) pair — NOT a single test iterating the whole
// matrix. A single-test-body design was tried first and timed out on firefox
// (default 30s Playwright test timeout; firefox's per-click round-trip in this
// environment is slow enough that 5 scenarios × 2 arms × 45 clicks each
// cumulatively exceeds the budget even though nothing in the body is a real
// assertion). Splitting gives each pair its own 30s budget, matching the
// per-scenario test pattern already used in the Task 3 churn matrix.
for (const scenario of SCENARIOS) {
  for (const arm of ['AppRecycled', 'AppKeyed'] as const) {
    test(`ADVISORY wall-clock — ${scenario.label} — ${arm} (nv-only, logged never asserted)`, async ({
      page,
    }) => {
      await mountArm(page, arm)
      for (let i = 0; i < WARMUP_STEPS; i++) {
        await mutationStep(page, scenario, () => flushChurn(page))
      }
      const times: number[] = []
      for (let i = 0; i < MEASURED_STEPS; i++) {
        const t0 = Date.now()
        await mutationStep(page, scenario, () => flushChurn(page))
        times.push(Date.now() - t0)
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length
      const max = Math.max(...times)
      console.log(
        `\nADVISORY [${scenario.key}] ${arm} — avg=${avg.toFixed(2)}ms max=${max.toFixed(2)}ms (round-trip incl. IPC; not isolated in-page timing)`,
      )
      // Advisory only — no timing assertion, matches A3 wall-clock discipline.
      expect(true).toBe(true)
    })
  }
}
