/**
 * recycling-identity — Part B gate (Playwright, real Blink)
 *
 * B1 (FIRE): focus + uncontrolled-input-state follows SLOT POSITION in <recycle>
 * B2 (FIRE): focus + uncontrolled-input-state follows DATA in <each key=>
 * B3 (demo): footgun — <recycle> + data reorder leaves focus on wrong record
 *
 * Closes T1-1 JSDOM gap: real browser focus/activeElement used here.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixtureDir = join(__dirname, 'fixtures/recycling-identity')
const distDir = join(__dirname, 'dist')
const BUNDLE = join(distDir, 'nv-recycling-identity-bundle.js')

type IdentGlobal = {
  AppRecycle: { mount(p: Element, d: Document): () => void }
  AppKeyed: { mount(p: Element, d: Document): () => void }
  flushSync(): void
}

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })
  await esbuild.build({
    entryPoints: [join(fixtureDir, 'entry.ts')],
    bundle: true,
    outfile: BUNDLE,
    format: 'iife',
    globalName: '__nvIdent',
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

async function mountApp(
  page: import('@playwright/test').Page,
  arm: 'AppRecycle' | 'AppKeyed',
): Promise<void> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate((armName) => {
    const g = (window as unknown as { __nvIdent: IdentGlobal }).__nvIdent
    g[armName].mount(document.body, document)
    g.flushSync()
  }, arm)
}

// Writes next dataset into a <script id="next-data"> element then dispatches
// a click event on the fixture's #swap-data button (which reads it). Using
// dispatchEvent from page.evaluate avoids Playwright's focus-stealing behavior
// that would occur with page.locator('#swap-data').click().
async function swapData(page: import('@playwright/test').Page, items: string[]): Promise<void> {
  await page.evaluate((json) => {
    let el = document.getElementById('next-data')
    if (!el) {
      el = document.createElement('script')
      el.id = 'next-data'
      document.body.appendChild(el)
    }
    el.textContent = json
    // dispatchEvent preserves focus — Playwright's .click() would steal it
    document.getElementById('swap-data')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, JSON.stringify(items))
  await page.evaluate(() => {
    ;(window as unknown as { __nvIdent: IdentGlobal }).__nvIdent.flushSync()
  })
}

// ── B1: recycle — focus + typed text stays with SLOT POSITION (FIRE) ──────────

test('B1 recycle: focus + uncontrolled-input-state stays with slot position after data change (FIRE)', async ({
  page,
}) => {
  await mountApp(page, 'AppRecycle')

  // Focus slot-index-1 (0-based) and type characters — real uncontrolled state
  const slot1 = page.locator('.row-input').nth(1)
  await slot1.click()
  await page.keyboard.type('hello')

  // Confirm we typed into slot 1
  const typedValue = await slot1.inputValue()
  expect(typedValue).toContain('hello')

  // Get the actual DOM node reference for slot 1
  const slot1NodeId = await page.evaluate(() => {
    const inputs = document.querySelectorAll('.row-input')
    const el = inputs[1] as HTMLInputElement
    // Mark the node so we can identify it after re-bind
    ;(el as HTMLInputElement & { __slotId: string }).__slotId = 'slot-1-node'
    return 'slot-1-node'
  })

  // Change data — recycle re-binds slot positions with new data (slot node stays)
  await swapData(page, ['X', 'Y', 'Z', 'W', 'V'])

  // Assert: slot 1's DOM node is STILL the focused element
  const { isActive, nodeId, valueAfter } = await page.evaluate(() => {
    const inputs = document.querySelectorAll('.row-input')
    const el = inputs[1] as HTMLInputElement & { __slotId: string }
    return {
      isActive: document.activeElement === el,
      nodeId: el.__slotId,
      valueAfter: el.value,
    }
  })

  expect(nodeId, 'same DOM node is still at slot 1').toBe(slot1NodeId)
  expect(isActive, 'slot 1 node is still the activeElement after data change').toBe(true)
  expect(valueAfter, 'typed characters persist with the slot node (uncontrolled state)').toContain(
    'hello',
  )
})

// ── B2: keyed — focus + typed text follows DATA to new position (FIRE) ────────

test('B2 keyed: focus + typed text follows DATA to its new slot position (FIRE)', async ({
  page,
}) => {
  await mountApp(page, 'AppKeyed')

  // Start with [A, B, C, D, E], focus the row holding 'B' (index 1)
  const slot1 = page.locator('.row-input').nth(1)
  await slot1.click()
  await page.keyboard.type('typed')

  // Confirm typed
  expect(await slot1.inputValue()).toContain('typed')

  // Reorder: move B to the end → [A, C, D, E, B]
  await swapData(page, ['A', 'C', 'D', 'E', 'B'])

  // 'B' is now at index 4 (last). In keyed mode the DOM node for 'B' moved there.
  const { activeIndex, activeValue } = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('.row-input')) as HTMLInputElement[]
    const activeIdx = inputs.findIndex((el) => el === document.activeElement)
    return {
      activeIndex: activeIdx,
      activeValue: (document.activeElement as HTMLInputElement | null)?.value ?? '',
    }
  })

  expect(activeIndex, 'focus moved to index 4 (where B now lives)').toBe(4)
  expect(activeValue, 'typed text traveled with the keyed data node').toContain('typed')
})

// ── B3: footgun demonstration (contract-boundary demo, not a pass/fail gate) ──

test('B3 footgun demo: <recycle> + data reorder = focus stays on slot, wrong record (demo only)', async ({
  page,
}) => {
  test.info().annotations.push({
    type: 'contract-boundary-demonstration',
    description:
      'Not a pass/fail gate. Shows that <recycle> is WRONG for editable inputs when data reorders — focus stays with slot position while data changes under it.',
  })

  await mountApp(page, 'AppRecycle')

  // Focus slot 1 — holds 'B'
  const slot1 = page.locator('.row-input').nth(1)
  await slot1.click()
  await page.keyboard.type('editing-B')

  // Reorder data so slot 1 now holds 'C' (data changed under focused slot)
  await swapData(page, ['A', 'C', 'D', 'E', 'B'])

  const { activeSlotIndex, slotDataLabel, typedText } = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('.row-input')) as HTMLInputElement[]
    const activeIdx = inputs.findIndex((el) => el === document.activeElement)
    const activeEl = document.activeElement as HTMLInputElement | null
    // data-label is set by the fixture on the parent <li> — shows what item is now bound to this slot
    const slotLi = activeEl?.closest('li') ?? null
    return {
      activeSlotIndex: activeIdx,
      slotDataLabel: slotLi?.getAttribute('data-label') ?? 'unknown',
      typedText: activeEl?.value ?? '',
    }
  })

  console.log(
    `\nB3 footgun: focused slot=${activeSlotIndex}, now-bound-item="${slotDataLabel}", typed="${typedText}" — user is editing wrong record`,
  )

  // The demonstration: focus stayed on slot 1 (position-identity) but the user
  // is now editing whatever data was rebound there — NOT the 'B' record they intended.
  expect(activeSlotIndex, 'focus stayed at slot 1 — position-identity is working as designed').toBe(
    1,
  )
  // (No assertion on "wrongness" — this is documentation, not a failure condition)
})
