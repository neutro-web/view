/**
 * Spike: Reorder-cost characterization for ListBinding.
 *
 * Measures wall-clock time and insertBefore call count for one reconcile cycle
 * after various reorder patterns at N ∈ {100, 1000, 10000}.
 *
 * This is a measurement-only spike — no src/ changes, no LIS implementation.
 * Run: pnpm test:browser --project=chromium test/browser/spike-qr.spec.ts
 */

import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Page, test } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(__dirname, 'dist', 'nv-bundle.js')

async function loadNv(page: Page): Promise<void> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
}

type ReorderPattern = 'reverse' | 'shuffle' | 'single-move' | 'head-to-tail'

interface MeasureResult {
  ms: number
  insertBeforeCount: number
}

const NS = [100, 1000, 10000] as const
const PATTERNS: ReorderPattern[] = ['reverse', 'shuffle', 'single-move', 'head-to-tail']

// Timeout budget per test: 60 s (covers N=10000 worst case; we cap inside if it's too slow)
test.setTimeout(90_000)

// Collect all results across subtests into a module-level table, printed at end.
const rows: Array<{
  pattern: ReorderPattern
  n: number
  ms: number
  insertBeforeCount: number
}> = []

for (const pattern of PATTERNS) {
  for (const n of NS) {
    test(`spike-qr | ${pattern} | N=${n}`, async ({ page }) => {
      await loadNv(page)

      const result: MeasureResult = await page.evaluate(
        ({ n, pattern }: { n: number; pattern: ReorderPattern }) => {
          const { signal, flushSync, mount } = window.__nv

          // ── build initial list ────────────────────────────────────────────
          type Item = { id: number; label: string }
          const initial: Item[] = Array.from({ length: n }, (_, i) => ({
            id: i,
            label: `item-${i}`,
          }))

          const items = signal<Item[]>(initial)

          const listIR = {
            id: 'spike-qr-list',
            shape: { html: '<ul><!--nv-0--></ul>', bindingPaths: [[0, 0]] },
            bindings: [
              {
                kind: 'list' as const,
                pathIndex: 0,
                items: () => items(),
                key: (item: unknown) => (item as Item).id,
                itemTemplate: (vs: { (): unknown }) =>
                  ({
                    id: 'spike-li',
                    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
                    bindings: [
                      {
                        kind: 'text' as const,
                        pathIndex: 0,
                        expr: () => (vs() as Item).label,
                      },
                    ],
                  }) as never,
              },
            ],
          }

          const container = document.createElement('div')
          document.body.appendChild(container)
          mount(listIR, container, document)
          flushSync()

          // ── build reordered array ─────────────────────────────────────────
          const arr = initial.slice()
          let reordered: Item[]

          if (pattern === 'reverse') {
            reordered = arr.slice().reverse()
          } else if (pattern === 'shuffle') {
            // deterministic Fisher-Yates with seed-like offset
            const s = arr.slice()
            for (let i = s.length - 1; i > 0; i--) {
              const j = (i * 1103515245 + 12345) % (i + 1)
              const tmp = s[i]
              s[i] = s[j < 0 ? -j : j]
              s[j < 0 ? -j : j] = tmp
            }
            reordered = s
          } else if (pattern === 'single-move') {
            // move first item to last
            const s = arr.slice()
            s.push(s.shift()!)
            reordered = s
          } else {
            // head-to-tail: last becomes first (rotate left)
            const s = arr.slice()
            s.unshift(s.pop()!)
            reordered = s
          }

          // ── patch insertBefore counter ────────────────────────────────────
          let insertBeforeCount = 0
          const origInsertBefore = Node.prototype.insertBefore
          Node.prototype.insertBefore = function <T extends Node>(
            this: Node,
            newNode: T,
            refNode: Node | null,
          ): T {
            insertBeforeCount++
            return origInsertBefore.call(this, newNode, refNode) as T
          }

          // ── measure ───────────────────────────────────────────────────────
          const t0 = performance.now()
          items.set(reordered)
          flushSync()
          const ms = performance.now() - t0

          const count = insertBeforeCount

          // restore
          Node.prototype.insertBefore = origInsertBefore
          container.remove()

          return { ms, insertBeforeCount: count }
        },
        { n, pattern },
      )

      rows.push({ pattern, n, ms: result.ms, insertBeforeCount: result.insertBeforeCount })

      // If N=10000 took >30s, flag it (test still passes; we just note it).
      if (n === 10000 && result.ms > 30_000) {
        console.warn(`[spike-qr] N=10000 ${pattern} exceeded 30s cap: ${result.ms.toFixed(1)} ms`)
      }
    })
  }
}

// Print consolidated table after all tests. Playwright runs tests in declaration order
// for a single file, so the last defined test fires after all the measurement tests.
test('spike-qr | RESULTS TABLE', async () => {
  // Sort rows: pattern then N for readability
  const sorted = [...rows].sort((a, b) => {
    if (a.pattern < b.pattern) return -1
    if (a.pattern > b.pattern) return 1
    return a.n - b.n
  })

  const header = ['Pattern', 'N', 'ms/reorder', 'insertBefore count']
  const divider = '|---------|-------|------------|---------------------|'
  const lines = [
    '',
    '┌─────────────────────────────── SPIKE-QR RESULTS ───────────────────────────────┐',
    `| ${header.join(' | ')} |`,
    divider,
    ...sorted.map(
      (r) =>
        `| ${r.pattern.padEnd(11)} | ${String(r.n).padStart(5)} | ${r.ms.toFixed(2).padStart(10)} | ${String(r.insertBeforeCount).padStart(19)} |`,
    ),
    '└────────────────────────────────────────────────────────────────────────────────┘',
    '',
    'VERDICT (O(N) insertBefore characterization):',
    sorted
      .map((r) => {
        let verdict = ''
        if (r.insertBeforeCount <= r.n) {
          verdict = '≤N moves — O(N) acceptable'
        } else {
          verdict = `${r.insertBeforeCount} moves > N=${r.n} — exceeds O(N)`
        }
        return `  ${r.pattern} N=${r.n}: ${verdict} (${r.ms.toFixed(1)} ms)`
      })
      .join('\n'),
    '',
  ].join('\n')

  console.log(lines)

  // The test itself always passes — it's a measurement spike, not a correctness gate.
  // Playwright will show the console output in the report.
})
