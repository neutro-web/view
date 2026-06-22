/**
 * spike-qb.test.ts — D-slot-2 ownership witness
 *
 * Question: When a list row is removed, are content effects (that read a
 * shared parent-owned signal) severed (D-slot-2/invocation-scoped) or do
 * they leak until the whole list unmounts (D-slot-1/parent-lexical)?
 *
 * Witness: observerCount(parentSignal) before vs after middle-row removal.
 *   delta = 0  → D-slot-1 (leak)
 *   delta > 0  → D-slot-2 (invocation-scoped, severed on dispose)
 *
 * Run: pnpm vitest run test/spike-qb.test.ts
 */

import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { emitMount } from '../src/compiler/emitted-mount.js'
import { __test, flushSync, signal } from '../src/core/core.js'
import { createHtmlTag } from '../src/renderer/html-tag.js'
import { mount } from '../src/renderer/interpreter.js'
import type { ListBinding, TemplateIR, TextBinding, WritableSignal } from '../src/renderer/ir.js'

// ── jsdom setup ───────────────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document
const html = createHtmlTag(document)

function mkParent(): Element {
  const div = document.createElement('div')
  document.body.appendChild(div)
  return div
}

function rmParent(el: Element): void {
  el.remove()
}

// ── shared types ──────────────────────────────────────────────────────────────

type Item = { id: number; label: string }

// ── IR builders ───────────────────────────────────────────────────────────────

/**
 * Build a list IR where each row's text binding closes over `parentSignal`.
 * This is the key setup: parentSignal is external to the list, defined in the
 * outer scope. Every row reads it in its text expression.
 */
function makeSharedSignalListIR(
  items: () => readonly Item[],
  parentSignal: WritableSignal<string>,
): TemplateIR {
  return {
    id: 'spike-list',
    shape: {
      html: '<ul><!--nv-0--></ul>',
      bindingPaths: [[0, 0]],
    },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: items as () => readonly unknown[],
        key: (item) => (item as Item).id,
        itemTemplate: (_vs: WritableSignal<unknown>, _is: WritableSignal<number>): TemplateIR => ({
          id: 'spike-li',
          shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
          bindings: [
            {
              kind: 'text',
              pathIndex: 0,
              // Closes over parentSignal — the shared external signal
              expr: () => parentSignal(),
            } satisfies TextBinding,
          ],
        }),
      } satisfies ListBinding,
    ],
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

type MountFn = (ir: TemplateIR, parent: Element, doc: Document) => () => void

function wrapEmitMount(ir: TemplateIR, parent: Element, doc: Document): () => void {
  const { mountFn } = emitMount(ir)
  return mountFn(parent, doc)
}

function runOwnershipSpike(label: string, mountFn: MountFn) {
  describe(`${label} — D-slot-2 ownership witness`, () => {
    test('observerCount drops after middle-row removal (D-slot-2) or stays (D-slot-1)', () => {
      // Shared parent-owned signal — external to the list, closed over by all rows
      const parentSignal = signal('shared-value')

      const items = signal<Item[]>([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
        { id: 3, label: 'C' },
      ])

      const ir = makeSharedSignalListIR(() => items(), parentSignal)
      const parent = mkParent()

      const dispose = mountFn(ir, parent, document)
      flushSync()

      // Verify 3 rows rendered
      expect(parent.querySelectorAll('li').length, '3 rows initially').toBe(3)

      // All rows should read parentSignal → each row contributes at least 1 observer edge
      const countBefore = __test.observerCount(parentSignal)
      console.log(`[${label}] observerCount(parentSignal) with 3 rows: ${countBefore}`)
      expect(countBefore, 'parentSignal has >= 3 observers (one per row)').toBeGreaterThanOrEqual(3)

      // Remove the middle row (id=2)
      items.set([
        { id: 1, label: 'A' },
        { id: 3, label: 'C' },
      ])
      flushSync()

      const countAfter = __test.observerCount(parentSignal)
      const delta = countBefore - countAfter
      console.log(`[${label}] observerCount(parentSignal) after removing id=2: ${countAfter}`)
      console.log(`[${label}] delta = ${delta}`)

      if (delta === 0) {
        console.log(`[${label}] RESULT: D-slot-1 (LEAK) — removed row still observes parentSignal`)
      } else if (delta > 0) {
        console.log(`[${label}] RESULT: D-slot-2 (INVOCATION-SCOPED) — removed row's edge severed`)
      }

      // Report the ownership verdict (not assert — this is the evidence)
      // We DO assert that siblings (id=1, id=3) still react to parentSignal writes
      parentSignal.set('updated-value')
      flushSync()

      const lis = parent.querySelectorAll('li')
      expect(lis.length, '2 sibling rows remain after removal').toBe(2)
      // Both surviving rows should show the updated value
      expect(lis[0]!.textContent, 'sibling id=1 reacts to parentSignal').toBe('updated-value')
      expect(lis[1]!.textContent, 'sibling id=3 reacts to parentSignal').toBe('updated-value')
      console.log(`[${label}] Siblings still reactive: YES (both show 'updated-value')`)

      dispose()
      rmParent(parent)
    })

    test('records exact delta for oracle comparison', () => {
      const parentSignal = signal('shared')

      const items = signal<Item[]>([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
        { id: 3, label: 'C' },
      ])

      const ir = makeSharedSignalListIR(() => items(), parentSignal)
      const parent = mkParent()

      const dispose = mountFn(ir, parent, document)
      flushSync()

      const countWith3 = __test.observerCount(parentSignal)

      // Remove middle row
      items.set([
        { id: 1, label: 'A' },
        { id: 3, label: 'C' },
      ])
      flushSync()

      const countWith2 = __test.observerCount(parentSignal)
      const delta = countWith3 - countWith2

      // Remove another row
      items.set([{ id: 1, label: 'A' }])
      flushSync()

      const countWith1 = __test.observerCount(parentSignal)
      const delta2 = countWith2 - countWith1

      console.log(
        `[${label}] countWith3=${countWith3}, countWith2=${countWith2}, countWith1=${countWith1}`,
      )
      console.log(`[${label}] delta on first removal: ${delta}, delta on second removal: ${delta2}`)

      // Ownership classification:
      if (delta === 0 && delta2 === 0) {
        console.log(`[${label}] Classification: D-slot-1 (LEAK) — no observer drop on removal`)
      } else if (delta > 0 && delta2 > 0) {
        console.log(
          `[${label}] Classification: D-slot-2 (INVOCATION-SCOPED) — observer drops on each removal`,
        )
      } else {
        console.log(
          `[${label}] Classification: MIXED — inconsistent drops (delta=${delta}, delta2=${delta2})`,
        )
      }

      // snapshot assertions so vitest records the values
      expect({ countWith3, countWith2, countWith1, delta, delta2 }).toMatchSnapshot()

      dispose()
      rmParent(parent)
    })
  })
}

// Run for both backends
runOwnershipSpike('interpreter', mount)
runOwnershipSpike('emitted-mount', wrapEmitMount)
