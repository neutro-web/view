/**
 * recycling-collapse-integration — Follow-up B' Phase 2, Task 3.
 * Proves <recycle> authoring (real .nv compilation, not the test-only bypass
 * harness used elsewhere in this plan) still works end-to-end after the HWM
 * collapse — this is the first test in the B'/B lineage to exercise HWM
 * pooling via actual <recycle> authoring rather than direct function calls.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixtureDir = join(__dirname, 'fixtures/recycling-collapse')
const distDir = join(__dirname, 'dist')
const BUNDLE = join(distDir, 'nv-recycling-collapse-bundle.js')

type CollapseGlobal = {
  AppRecycleIntegration: { mount(p: Element, d: Document): () => void }
  flushSync(): void
}

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })
  await esbuild.build({
    entryPoints: [join(fixtureDir, 'entry.ts')],
    bundle: true,
    outfile: BUNDLE,
    format: 'iife',
    globalName: '__nvCollapse',
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

test('<recycle> authoring works end-to-end post-collapse: grow reuses retained rows correctly', async ({
  page,
}) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate(() => {
    const g = (window as unknown as { __nvCollapse: CollapseGlobal }).__nvCollapse
    g.AppRecycleIntegration.mount(document.body, document)
    g.flushSync()
  })
  await page.locator('#grow').click()
  await page.evaluate(() =>
    (window as unknown as { __nvCollapse: CollapseGlobal }).__nvCollapse.flushSync(),
  )
  const grownCount = await page.locator('.row').count()
  await page.locator('#shrink').click()
  await page.evaluate(() =>
    (window as unknown as { __nvCollapse: CollapseGlobal }).__nvCollapse.flushSync(),
  )
  const shrunkCount = await page.locator('.row').count()
  await page.locator('#grow').click()
  await page.evaluate(() =>
    (window as unknown as { __nvCollapse: CollapseGlobal }).__nvCollapse.flushSync(),
  )
  const regrownIds = await page
    .locator('.row')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-id')))
  expect(grownCount).toBe(100)
  expect(shrunkCount).toBe(50)
  expect(regrownIds.length).toBe(100)
  expect(new Set(regrownIds).size).toBe(100)
})
