/**
 * Probe: .nv authoring — does event-handler → signal-write work end-to-end?
 *
 * Feeds: roadmap/v0.1.0.md CP-1b (event-handler authoring) + CP-3 (app entry).
 * Commission: handoff-nv-author-probe-SONNET.md (2026-06-25).
 *
 * Three probe steps (in order):
 *   Step 1 — Parse + emit: counter.nv → emitted JS contains real EventBinding.
 *   Step 2 — jsdom: already proven by EX-01 in nv-emitter-exec.test.ts (same
 *             counter source, same path, 659/0 green). Not duplicated here.
 *   Step 3 — Real browser: bundle via nvPlugin + esbuild, Playwright-click,
 *             assert DOM update.
 *
 * Run: pnpm test:browser --project=chromium test/browser/nv-author-probe.spec.ts
 */

import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixturesDir = join(__dirname, 'fixtures')
const distDir = join(__dirname, 'dist')
const COUNTER_BUNDLE = join(distDir, 'nv-counter-bundle.js')

// ── Build the counter bundle once before all tests ────────────────────────────

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })

  await esbuild.build({
    entryPoints: [join(fixturesDir, 'counter-entry.ts')],
    bundle: true,
    outfile: COUNTER_BUNDLE,
    format: 'iife',
    globalName: '__nvCounter',
    platform: 'browser',
    target: 'es2022',
    plugins: [
      nvPlugin(),
      {
        name: 'ts-resolve',
        setup(build) {
          build.onResolve({ filter: /\.js$/ }, (args) => {
            const absTs = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'))
            return { path: absTs }
          })
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
        },
      },
    ],
    sourcemap: false,
    minify: false,
  })
})

// ── Step 1 — Parse + emit (inspected from the built bundle) ──────────────────

test('Step 1 — emitted bundle contains EventBinding wired to handler', () => {
  const bundle = readFileSync(COUNTER_BUNDLE, 'utf8')

  // esbuild normalises quotes to double — check for the IR literal in the bundle.
  expect(bundle).toContain('kind: "event"')
  expect(bundle).toContain('eventName: "click"')
  // The erased handler: count.set(count() + 1)
  expect(bundle).toContain('count.set(')
  expect(bundle).toContain('handlerKind: "reactive"')

  console.log('\n── Step 1: emitted EventBinding (grep from bundle) ──')
  const lines = bundle.split('\n')
  const eventLines = lines.filter(
    (l) =>
      l.includes('kind: "event"') ||
      (l.includes('eventName') && l.includes('click')) ||
      l.includes('count.set') ||
      l.includes('handlerKind'),
  )
  for (const l of eventLines) console.log(' ', l.trim())
})

// ── Step 3 — Real browser: mount, click, assert DOM ──────────────────────────

test('Step 3 — real browser: click increments count in DOM', async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: COUNTER_BUNDLE })

  // Mount the counter into document.body and flush.
  await page.evaluate(() => {
    const app = (
      window as unknown as {
        __nvCounter: {
          Counter: { mount: (p: Element, d: Document) => void }
          flushSync: () => void
        }
      }
    ).__nvCounter
    app.Counter.mount(document.body, document)
    app.flushSync()
  })

  // Initial state: count is 0.
  await expect(page.locator('#count')).toHaveText('0')

  // Click once → 1.
  await page.locator('#btn').click()
  await page.evaluate(() => {
    ;(window as unknown as { __nvCounter: { flushSync: () => void } }).__nvCounter.flushSync()
  })
  await expect(page.locator('#count')).toHaveText('1')

  // Click again → 2.
  await page.locator('#btn').click()
  await page.evaluate(() => {
    ;(window as unknown as { __nvCounter: { flushSync: () => void } }).__nvCounter.flushSync()
  })
  await expect(page.locator('#count')).toHaveText('2')

  console.log('\n── Step 3: real-browser interaction verified (chromium) ──')
  console.log('  Initial: 0 ✓')
  console.log('  After click 1: 1 ✓')
  console.log('  After click 2: 2 ✓')
})
