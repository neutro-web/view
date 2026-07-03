/**
 * nv-benchmark-recycle-cap — Follow-up B'-cap win-retention measurement.
 * Single-arm (production wireRecycledList, now capped) wall-clock at the same
 * three magnitudes Phase 1 measured. Compare against the ARCHIVED Phase 1
 * halt-checkpoint numbers (docs/superpowers/handoffs/2026-07-03-followup-b-prime-
 * phase1-halt-checkpoint.md) — the pre-HWM dispose-based baseline no longer
 * exists in the tree, so this cannot be a live two-arm comparison.
 * ADVISORY — logged, never asserted.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixtureDir = join(__dirname, 'fixtures/recycling-hwm-cap-bench')
const distDir = join(__dirname, 'dist')
const BUNDLE = join(distDir, 'nv-recycling-hwm-cap-bench-bundle.js')

const WARMUP_STEPS = 5

type CapBenchGlobal = {
  mount(p: Element, d: Document, poolSize?: number): { dispose(): void; setN(n: number): void }
  flushSync(): void
}

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })
  await esbuild.build({
    entryPoints: [join(fixtureDir, 'entry.ts')],
    bundle: true,
    outfile: BUNDLE,
    format: 'iife',
    globalName: '__nvCapBench',
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
          build.onResolve({ filter: /^@neutro\/view\/renderer\/internal$/ }, () => ({
            path: join(repoRoot, 'src/renderer/interpreter.ts'),
          }))
        },
      },
    ],
  })
})

type Magnitude = {
  label: string
  low: number
  high: number
  poolSize: number
  measuredSteps: number
}
const MAGNITUDES: Magnitude[] = [
  { label: 'small (50<->100)', low: 50, high: 100, poolSize: 10000, measuredSteps: 20 },
  { label: 'medium (500<->1000)', low: 500, high: 1000, poolSize: 10000, measuredSteps: 20 },
  { label: 'large-spike (100<->5000)', low: 100, high: 5000, poolSize: 20000, measuredSteps: 6 },
]

async function measureResize(
  page: import('@playwright/test').Page,
  mag: Magnitude,
): Promise<{ avgMs: number; maxMs: number }> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate(
    ({ poolSize }) => {
      const g = (window as unknown as { __nvCapBench: CapBenchGlobal }).__nvCapBench
      ;(window as unknown as { __h: unknown }).__h = g.mount(document.body, document, poolSize)
    },
    { poolSize: mag.poolSize },
  )
  for (let i = 0; i < WARMUP_STEPS; i++) {
    const n = i % 2 === 0 ? mag.high : mag.low
    await page.evaluate((n) => {
      ;(window as unknown as { __h: { setN(n: number): void } }).__h.setN(n)
    }, n)
  }
  const times: number[] = []
  for (let i = 0; i < mag.measuredSteps; i++) {
    const n = i % 2 === 0 ? mag.high : mag.low
    const ms = await page.evaluate((n) => {
      const t0 = performance.now()
      ;(window as unknown as { __h: { setN(n: number): void } }).__h.setN(n)
      return performance.now() - t0
    }, n)
    times.push(ms)
  }
  await page.evaluate(() => {
    ;(window as unknown as { __h: { dispose(): void } }).__h.dispose()
  })
  return {
    avgMs: times.reduce((a: number, b: number) => a + b, 0) / times.length,
    maxMs: Math.max(...times),
  }
}

for (const mag of MAGNITUDES) {
  test(`ADVISORY: capped-HWM resize wall-clock — ${mag.label}`, async ({ page }) => {
    test.setTimeout(90_000)
    const capped = await measureResize(page, mag)
    console.log(
      `\nB'-CAP win-retention [${mag.label}] capped-HWM avg=${capped.avgMs.toFixed(2)}ms max=${capped.maxMs.toFixed(2)}ms ` +
        `(round-trip incl. IPC, ${mag.measuredSteps} resize steps — compare against archived Phase 1 halt-checkpoint baseline for this magnitude)`,
    )
    expect(true).toBe(true)
  })
}
