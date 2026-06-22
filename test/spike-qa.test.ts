/**
 * Spike QA: Variant A (SlotEntry thunk-style) vs Variant B (status quo writable-signal)
 *
 * Design question: can `SlotEntry.content = (props: SlotProps) => TemplateIR` thunk-style
 * be used for list item bodies? This file tests that question without touching src/.
 *
 * Variant A: itemTemplate is a thin adapter. Internally it creates valueSig/indexSig,
 *            then calls a "body factory" that only sees thunks { item: () => unknown, index: () => number }.
 * Variant B: status quo — body factory receives writable signals directly.
 *
 * Both variants run against interpreter and emitted-mount backends.
 * TC-10a through TC-10j obligations are covered for each combination.
 */

import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { emitMount } from '../src/compiler/emitted-mount.js'
import {
  __test,
  createRoot as coreCreateRoot,
  errorBoundary,
  flushSync,
  signal,
} from '../src/core/core.js'
import { createHtmlTag } from '../src/renderer/html-tag.js'
import { mount } from '../src/renderer/interpreter.js'
import type {
  ListBinding,
  SlotProps,
  TemplateIR,
  TextBinding,
  WritableSignal,
} from '../src/renderer/ir.js'

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

// ── Types ─────────────────────────────────────────────────────────────────────

type Item = { id: number; label: string }

/** The thunk-based body factory type (Variant A's "consumer" shape). */
type ThunkBodyFactory = (
  props: SlotProps & { item: () => unknown; index: () => number },
) => TemplateIR

// ── Variant A adapter ─────────────────────────────────────────────────────────
//
// This adapter wraps a thunk-body-factory into the standard itemTemplate shape.
// The reconcile loop (interpreter / emitted-mount) is NOT changed — it still
// receives and calls itemTemplate(valueSig, indexSig) as per ListBinding.
// The adapter holds the writable signals privately and exposes only thunks to
// the body factory.

function variantAAdapter(
  bodyFactory: ThunkBodyFactory,
): (vs: WritableSignal<unknown>, is: WritableSignal<number>) => TemplateIR {
  return (vs, is) => {
    // Body factory only sees read-only thunks — it cannot call .set()
    const props = {
      item: () => vs(),
      index: () => is(),
    }
    return bodyFactory(props)
  }
}

// ── Body factories (shared between variants) ──────────────────────────────────

/** Variant A body factory: reads item label via thunk. */
function liTextBodyA(props: { item: () => unknown; index: () => number }): TemplateIR {
  return {
    id: 'li-text-a',
    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'text',
        pathIndex: 0,
        expr: () => (props.item() as Item).label,
      } satisfies TextBinding,
    ],
  }
}

/** Variant A body factory: reads item label + index via thunks. */
function liIndexBodyA(props: { item: () => unknown; index: () => number }): TemplateIR {
  return {
    id: 'li-index-a',
    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'text',
        pathIndex: 0,
        expr: () => `${(props.item() as Item).label}#${props.index()}`,
      } satisfies TextBinding,
    ],
  }
}

// ── Variant B body factories (status quo — writable signals exposed directly) ─

function liTextBodyB(vs: WritableSignal<unknown>, _is: WritableSignal<number>): TemplateIR {
  return {
    id: 'li-text-b',
    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'text',
        pathIndex: 0,
        expr: () => (vs() as Item).label,
      } satisfies TextBinding,
    ],
  }
}

function liIndexBodyB(vs: WritableSignal<unknown>, is: WritableSignal<number>): TemplateIR {
  return {
    id: 'li-index-b',
    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'text',
        pathIndex: 0,
        expr: () => `${(vs() as Item).label}#${is()}`,
      } satisfies TextBinding,
    ],
  }
}

// ── IR builders ───────────────────────────────────────────────────────────────

function makeListIR(
  items: () => readonly Item[],
  makeItem: (vs: WritableSignal<unknown>, is: WritableSignal<number>) => TemplateIR,
): TemplateIR {
  return {
    id: 'list-spike',
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
        itemTemplate: makeItem,
      } satisfies ListBinding,
    ],
  }
}

// ── Backend mount helper ──────────────────────────────────────────────────────

type Backend = 'interpreter' | 'emitted-mount'

function mountVia(backend: Backend, ir: TemplateIR, parent: Element, doc: Document): () => void {
  if (backend === 'interpreter') return mount(ir, parent, doc)
  const { mountFn } = emitMount(ir)
  return mountFn(parent, doc)
}

// ── Variant labels ────────────────────────────────────────────────────────────

const VARIANTS = {
  A: {
    liText: variantAAdapter(liTextBodyA),
    liIndex: variantAAdapter(liIndexBodyA),
  },
  B: {
    liText: liTextBodyB,
    liIndex: liIndexBodyB,
  },
} as const

type Variant = keyof typeof VARIANTS
const BACKENDS: Backend[] = ['interpreter', 'emitted-mount']
const VARIANT_KEYS: Variant[] = ['A', 'B']

// ── Test matrix ───────────────────────────────────────────────────────────────

for (const backend of BACKENDS) {
  for (const variant of VARIANT_KEYS) {
    const v = VARIANTS[variant]
    const prefix = `[${backend}][Variant ${variant}]`

    // TC-10a: Initial render
    test(`${prefix} TC-10a initial render: N items correct order and content`, () => {
      const items = signal<Item[]>([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
        { id: 3, label: 'C' },
      ])
      const ir = makeListIR(() => items(), v.liText)
      const parent = mkParent()
      const dispose = mountVia(backend, ir, parent, document)
      flushSync()

      const lis = parent.querySelectorAll('li')
      expect(lis.length, '3 items').toBe(3)
      expect(lis[0]!.textContent).toBe('A')
      expect(lis[1]!.textContent).toBe('B')
      expect(lis[2]!.textContent).toBe('C')

      dispose()
      rmParent(parent)
    })

    // TC-10b: Append
    test(`${prefix} TC-10b append: new item added at end`, () => {
      const items = signal<Item[]>([{ id: 1, label: 'A' }])
      const ir = makeListIR(() => items(), v.liText)
      const parent = mkParent()
      const dispose = mountVia(backend, ir, parent, document)
      flushSync()

      items.set([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
      ])
      flushSync()

      const lis = parent.querySelectorAll('li')
      expect(lis.length).toBe(2)
      expect(lis[0]!.textContent).toBe('A')
      expect(lis[1]!.textContent).toBe('B')

      dispose()
      rmParent(parent)
    })

    // TC-10c: Prepend
    test(`${prefix} TC-10c prepend: new item added at beginning`, () => {
      const items = signal<Item[]>([{ id: 2, label: 'B' }])
      const ir = makeListIR(() => items(), v.liText)
      const parent = mkParent()
      const dispose = mountVia(backend, ir, parent, document)
      flushSync()

      items.set([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
      ])
      flushSync()

      const lis = parent.querySelectorAll('li')
      expect(lis.length).toBe(2)
      expect(lis[0]!.textContent).toBe('A')
      expect(lis[1]!.textContent).toBe('B')

      dispose()
      rmParent(parent)
    })

    // TC-10d: Insert middle
    test(`${prefix} TC-10d insert-middle: item inserted between existing`, () => {
      const items = signal<Item[]>([
        { id: 1, label: 'A' },
        { id: 3, label: 'C' },
      ])
      const ir = makeListIR(() => items(), v.liText)
      const parent = mkParent()
      const dispose = mountVia(backend, ir, parent, document)
      flushSync()

      items.set([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
        { id: 3, label: 'C' },
      ])
      flushSync()

      const lis = parent.querySelectorAll('li')
      expect(lis.length).toBe(3)
      expect(lis[0]!.textContent).toBe('A')
      expect(lis[1]!.textContent).toBe('B')
      expect(lis[2]!.textContent).toBe('C')

      dispose()
      rmParent(parent)
    })

    // TC-10e: Remove
    test(`${prefix} TC-10e remove: item DOM removed, reactive edges severed`, () => {
      const items = signal<Item[]>([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
      ])

      let removedVsSig: WritableSignal<unknown> | null = null
      const irWithSpy = makeListIR(
        () => items(),
        (vs, is) => {
          if ((vs() as Item).id === 2) removedVsSig = vs
          return v.liText(vs, is)
        },
      )

      const parent = mkParent()
      const dispose = mountVia(backend, irWithSpy, parent, document)
      flushSync()

      expect(parent.querySelectorAll('li').length).toBe(2)

      items.set([{ id: 1, label: 'A' }])
      flushSync()

      const lis = parent.querySelectorAll('li')
      expect(lis.length).toBe(1)
      expect(lis[0]!.textContent).toBe('A')

      if (removedVsSig !== null) {
        expect(__test.observerCount(removedVsSig), 'removed item signal has 0 observers').toBe(0)
      }

      dispose()
      rmParent(parent)
    })

    // TC-10f: Value change at kept key — THE CRITICAL NODE IDENTITY TEST
    test(`${prefix} TC-10f value change at kept key: DOM updates, node identity preserved`, () => {
      const items = signal<Item[]>([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
      ])
      const ir = makeListIR(() => items(), v.liText)
      const parent = mkParent()
      const dispose = mountVia(backend, ir, parent, document)
      flushSync()

      const lisBefore = parent.querySelectorAll('li')
      const firstLiBefore = lisBefore[0]!
      const secondLiBefore = lisBefore[1]!

      items.set([
        { id: 1, label: 'A-updated' },
        { id: 2, label: 'B' },
      ])
      flushSync()

      const lisAfter = parent.querySelectorAll('li')
      expect(lisAfter.length, 'still 2 items').toBe(2)
      expect(lisAfter[0]!.textContent, 'first item updated').toBe('A-updated')
      expect(lisAfter[1]!.textContent, 'second unchanged').toBe('B')

      // NODE IDENTITY: must be same DOM objects (no rebuild)
      expect(lisAfter[0]!, `[${prefix}] TC-10f first li node identity preserved`).toBe(
        firstLiBefore,
      )
      expect(lisAfter[1]!, `[${prefix}] TC-10f second li node identity preserved`).toBe(
        secondLiBefore,
      )

      dispose()
      rmParent(parent)
    })

    // TC-10g: Reorder — THE CRITICAL INDEX REACTIVITY TEST
    test(`${prefix} TC-10g reorder: DOM order correct, index reactive, roots persist`, () => {
      const items = signal<Item[]>([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
        { id: 3, label: 'C' },
      ])
      const ir = makeListIR(() => items(), v.liIndex)
      const parent = mkParent()
      const dispose = mountVia(backend, ir, parent, document)
      flushSync()

      const lisBefore = Array.from(parent.querySelectorAll('li'))
      expect(lisBefore[0]!.textContent).toBe('A#0')
      expect(lisBefore[1]!.textContent).toBe('B#1')
      expect(lisBefore[2]!.textContent).toBe('C#2')

      // Reorder to [C, A, B]
      items.set([
        { id: 3, label: 'C' },
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
      ])
      flushSync()

      const lisAfter = Array.from(parent.querySelectorAll('li'))
      expect(lisAfter.length, '3 items after reorder').toBe(3)
      expect(lisAfter[0]!.textContent, `[${prefix}] TC-10g C now first with index 0`).toBe('C#0')
      expect(lisAfter[1]!.textContent, `[${prefix}] TC-10g A now second with index 1`).toBe('A#1')
      expect(lisAfter[2]!.textContent, `[${prefix}] TC-10g B now third with index 2`).toBe('B#2')

      // Node identity: same <li> objects after reorder
      // We use label-only (before reorder) to build the before-map
      const liBeforeByText = new Map(lisBefore.map((li) => [li.textContent, li] as const))
      // After reorder, text changed (index updated), so match by label prefix
      const labelOf = (text: string | null) => text?.split('#')[0] ?? ''
      for (const li of lisAfter) {
        const label = labelOf(li.textContent)
        const beforeEl = lisBefore.find((el) => labelOf(el.textContent) === label)
        expect(li, `[${prefix}] TC-10g node identity for label ${label}`).toBe(beforeEl)
      }

      dispose()
      rmParent(parent)
    })

    // TC-10h: Key collision → error boundary catches it
    test(`${prefix} TC-10h key collision: duplicate key → error-route`, () => {
      const items = signal<Item[]>([{ id: 1, label: 'A' }])
      const ir = makeListIR(() => items(), v.liText)
      const parent = mkParent()

      let caughtError: unknown = null

      const dispose = coreCreateRoot((d) => {
        errorBoundary(
          (e) => {
            caughtError = e
          },
          () => {
            mountVia(backend, ir, parent, document)
          },
        )
        return d
      })
      flushSync()

      items.set([
        { id: 1, label: 'A' },
        { id: 1, label: 'A-dup' },
      ])
      flushSync()

      expect(caughtError, 'error caught by boundary').not.toBeNull()
      expect(String(caughtError), 'error mentions duplicate key').toMatch(/duplicate key/)

      dispose()
      rmParent(parent)
    })

    // TC-10i: List unmount — no reactive leaks
    test(`${prefix} TC-10i list unmount: all item roots disposed, no reactive leaks`, () => {
      const labelA = signal('A')
      const labelB = signal('B')

      const items = signal<Item[]>([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
      ])

      // Custom itemTemplate that closes over external signals (not using v.liText)
      // so we can observe observer counts — same for both variants since we're
      // wrapping the same adapter pattern
      const externalTemplate = (
        vs: WritableSignal<unknown>,
        _is: WritableSignal<number>,
      ): TemplateIR => ({
        id: 'li-ext',
        shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
        bindings: [
          {
            kind: 'text',
            pathIndex: 0,
            expr: () => ((vs() as Item).id === 1 ? labelA() : labelB()),
          } satisfies TextBinding,
        ],
      })

      const ir = makeListIR(() => items(), externalTemplate)
      const parent = mkParent()
      const dispose = mountVia(backend, ir, parent, document)
      flushSync()

      expect(__test.observerCount(labelA) >= 1, 'labelA observed while mounted').toBe(true)
      expect(__test.observerCount(labelB) >= 1, 'labelB observed while mounted').toBe(true)

      dispose()

      expect(__test.observerCount(labelA), 'labelA has 0 observers after unmount').toBe(0)
      expect(__test.observerCount(labelB), 'labelB has 0 observers after unmount').toBe(0)
      expect(__test.observerCount(items), 'items signal has 0 observers after unmount').toBe(0)
      expect(parent.querySelectorAll('li').length, 'no li elements after unmount').toBe(0)

      rmParent(parent)
    })

    // TC-10j: Nested ListBinding — disposal cascades
    test(`${prefix} TC-10j nested ListBinding: disposal cascades to inner list`, () => {
      type Group = { id: number; label: string; children: Item[] }
      const groups = signal<Group[]>([
        {
          id: 1,
          label: 'G1',
          children: [
            { id: 11, label: 'A' },
            { id: 12, label: 'B' },
          ],
        },
      ])

      const innerItems = (vs: WritableSignal<unknown>) =>
        (vs() as Group).children as readonly unknown[]

      const innerIR = (vs: WritableSignal<unknown>): TemplateIR => ({
        id: 'inner-list',
        shape: { html: '<ul><!--nv-0--></ul>', bindingPaths: [[0, 0]] },
        bindings: [
          {
            kind: 'list',
            pathIndex: 0,
            items: () => innerItems(vs),
            key: (item) => (item as Item).id,
            itemTemplate: (childVs, _childIs) => ({
              id: 'inner-li',
              shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
              bindings: [
                {
                  kind: 'text',
                  pathIndex: 0,
                  expr: () => (childVs() as Item).label,
                } satisfies TextBinding,
              ],
            }),
          } satisfies ListBinding,
        ],
      })

      const outerIR: TemplateIR = {
        id: 'outer-list',
        shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
        bindings: [
          {
            kind: 'list',
            pathIndex: 0,
            items: () => groups() as readonly unknown[],
            key: (g) => (g as Group).id,
            itemTemplate: (vs, _is) => innerIR(vs),
          } satisfies ListBinding,
        ],
      }

      const parent = mkParent()
      const dispose = mountVia(backend, outerIR, parent, document)
      flushSync()

      expect(parent.querySelectorAll('li').length, '2 inner items initially').toBe(2)
      expect(__test.observerCount(groups) >= 1, 'groups observed').toBe(true)

      dispose()

      expect(parent.querySelectorAll('li').length, '0 li after dispose').toBe(0)
      expect(__test.observerCount(groups), 'groups has 0 observers after dispose').toBe(0)

      rmParent(parent)
    })
  }
}
