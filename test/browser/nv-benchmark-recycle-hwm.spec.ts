/**
 * nv-benchmark-recycle-hwm — Follow-up B' Phase 1 halt-checkpoint measurement.
 * Same-session before/after wall-clock for wireRecycledList (current) vs
 * wireRecycledListHWM (variant), at three resize magnitudes.
 * ADVISORY — logged, never asserted; this is the halt-checkpoint evidence.
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
const BUNDLE = join(distDir, 'nv-recycling-hwm-wallclock-bundle.js')

const WARMUP_STEPS = 5
const MEASURED_STEPS = 20

type HWMGlobal = {
  mountCurrent(
    p: Element,
    d: Document,
    poolSize?: number,
  ): { dispose(): void; setN(n: number): void }
  mountVariant(
    p: Element,
    d: Document,
    poolSize?: number,
  ): { dispose(): void; setN(n: number): void }
  flushSync(): void
}

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })
  await esbuild.build({
    entryPoints: [join(fixtureDir, 'entry.ts')],
    bundle: true,
    outfile: BUNDLE,
    format: 'iife',
    globalName: '__nvHwmBench',
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

// IMPORTANT — timing methodology: each measured step below is its OWN separate
// page.evaluate() round trip (its own Playwright/CDP IPC hop), matching the existing
// nv-benchmark-recycle.spec.ts pattern (measureArm's per-click page.evaluate loop).
// Do NOT batch all warmup+measured steps into a single page.evaluate call — that
// would exclude IPC overhead and produce numbers that aren't comparable to the
// 8da893a/B benchmark family this halt-checkpoint's 20% threshold is calibrated against.
type Magnitude = {
  label: string
  low: number
  high: number
  poolSize: number
  measuredSteps: number
}
const MAGNITUDES: Magnitude[] = [
  { label: 'small (50<->100)', low: 50, high: 100, poolSize: 10000, measuredSteps: MEASURED_STEPS },
  {
    label: 'medium (500<->1000)',
    low: 500,
    high: 1000,
    poolSize: 10000,
    measuredSteps: MEASURED_STEPS,
  },
  // large-spike moves ~4900 rows per step (100 vs 5000) — each step is ~50x the DOM/signal
  // work of the small magnitude's 50-row delta. Reduced to 6 measured steps (still 2 full
  // grow/shrink cycles) to stay well inside Playwright's default 30s per-test timeout across
  // all three browsers; see also the explicit test.setTimeout override below.
  { label: 'large-spike (100<->5000)', low: 100, high: 5000, poolSize: 20000, measuredSteps: 6 },
]

async function measureResize(
  page: import('@playwright/test').Page,
  arm: 'mountCurrent' | 'mountVariant',
  mag: Magnitude,
): Promise<{ avgMs: number; maxMs: number }> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate(
    ({ arm, poolSize }) => {
      const g = (window as unknown as { __nvHwmBench: HWMGlobal }).__nvHwmBench
      ;(window as unknown as { __h: unknown }).__h = g[arm as 'mountCurrent' | 'mountVariant'](
        document.body,
        document,
        poolSize,
      )
    },
    { arm, poolSize: mag.poolSize },
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
  test(`ADVISORY halt-checkpoint: ${mag.label} — current vs HWM variant`, async ({ page }) => {
    test.setTimeout(90_000)
    const current = await measureResize(page, 'mountCurrent', mag)
    const variant = await measureResize(page, 'mountVariant', mag)
    const pctChange = ((current.avgMs - variant.avgMs) / current.avgMs) * 100
    console.log(
      `\nHALT-CHECKPOINT [${mag.label}] current avg=${current.avgMs.toFixed(2)}ms max=${current.maxMs.toFixed(2)}ms | ` +
        `variant avg=${variant.avgMs.toFixed(2)}ms max=${variant.maxMs.toFixed(2)}ms | ` +
        `change=${pctChange.toFixed(1)}% (round-trip incl. IPC, ${mag.measuredSteps} resize steps, threshold=20%)`,
    )
    expect(true).toBe(true)
  })
}
