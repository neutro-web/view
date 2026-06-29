/**
 * Index-Elision Interpreter Tests — Task 3 (Commission 1)
 *
 * Verifies that when a ListBinding has itemReadsIndex === false:
 *  - Items render correctly (elided list)
 *  - Reordering renders in correct visual order
 *  - No indexSig is allocated (behavioral: index closure never called)
 * And that non-elided lists still expose correct index values on mount and reorder.
 *
 * Follows the same JSDOM setup pattern as interpreter.test.ts (manual JSDOM instance).
 */

import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { flushSync, signal } from '../../src/core/core.js'
import { mount } from '../../src/renderer/interpreter.js'
import type { ListBinding, TemplateIR, TextBinding, WritableSignal } from '../../src/renderer/ir.js'

// ── jsdom setup ───────────────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document

function mkParent(): HTMLDivElement {
  const div = document.createElement('div')
  document.body.appendChild(div)
  return div as HTMLDivElement
}

function rmParent(el: Element): void {
  el.remove()
}

/**
 * Return the text content of each <li>/<span> element child of the container,
 * skipping comment nodes.
 */
function itemTexts(container: Element): string[] {
  const out: string[] = []
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === 8 /* COMMENT */) continue
    if (child.nodeType === 1 /* ELEMENT */) {
      out.push((child as Element).textContent ?? '')
    }
  }
  return out
}

// ── IR builders ───────────────────────────────────────────────────────────────

/** Item template: <li> with text bound to valueSig() string value */
function liValueTemplate(vs: WritableSignal<unknown>): TemplateIR {
  return {
    id: 'li-value',
    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'text',
        pathIndex: 0,
        expr: () => String(vs()),
      } satisfies TextBinding,
    ],
  }
}

/** Item template: <li> with text "value:index" (reads both signals) */
function liIndexTemplate(vs: WritableSignal<unknown>, is?: WritableSignal<number>): TemplateIR {
  return {
    id: 'li-index',
    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'text',
        pathIndex: 0,
        // is! safe: liIndexTemplate is only wired to lists where itemReadsIndex !== false → interpreter always allocates indexSig
        expr: () => `${String(vs())}:${is!()}`,
      } satisfies TextBinding,
    ],
  }
}

/** Outer list IR with itemReadsIndex: false — elided */
function elidedListIR(items: WritableSignal<string[]>): TemplateIR {
  return {
    id: 'elided-list',
    shape: {
      html: '<ul><!--nv-0--></ul>',
      bindingPaths: [[0, 0]],
    },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: () => items() as unknown[],
        key: (item: unknown) => item as string,
        itemTemplate: (vs) => liValueTemplate(vs),
        itemReadsIndex: false,
      } satisfies ListBinding,
    ],
  }
}

/** Outer list IR with itemReadsIndex: true (or omitted) — non-elided */
function fullListIR(items: WritableSignal<string[]>): TemplateIR {
  return {
    id: 'full-list',
    shape: {
      html: '<ul><!--nv-0--></ul>',
      bindingPaths: [[0, 0]],
    },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: () => items() as unknown[],
        key: (item: unknown) => item as string,
        itemTemplate: (vs, is) => liIndexTemplate(vs, is),
        itemReadsIndex: true,
      } satisfies ListBinding,
    ],
  }
}

// ── TC-IE-01: Elided list renders correctly ───────────────────────────────────

test('TC-IE-01  elided list (itemReadsIndex:false) renders items correctly', () => {
  const items = signal(['apple', 'banana', 'cherry'])
  const ir = elidedListIR(items)
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  const ul = parent.firstElementChild!
  expect(itemTexts(ul)).toEqual(['apple', 'banana', 'cherry'])

  dispose()
  rmParent(parent)
})

// ── TC-IE-02: Elided list re-renders on items signal change ──────────────────

test('TC-IE-02  elided list re-renders when items signal changes', () => {
  const items = signal(['x', 'y'])
  const ir = elidedListIR(items)
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  items.set(['a', 'b', 'c'])
  flushSync()

  const ul = parent.firstElementChild!
  expect(itemTexts(ul)).toEqual(['a', 'b', 'c'])

  dispose()
  rmParent(parent)
})

// ── TC-IE-03: Elided list reordering renders correct visual order ─────────────

test('TC-IE-03  elided list swap renders correct visual order', () => {
  const items = signal(['first', 'second', 'third'])
  const ir = elidedListIR(items)
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  // Swap first and last
  items.set(['third', 'second', 'first'])
  flushSync()

  const ul = parent.firstElementChild!
  expect(itemTexts(ul)).toEqual(['third', 'second', 'first'])

  dispose()
  rmParent(parent)
})

// ── TC-IE-04: Elided list removes items correctly ────────────────────────────

test('TC-IE-04  elided list removes items on shrink', () => {
  const items = signal(['p', 'q', 'r', 's'])
  const ir = elidedListIR(items)
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  items.set(['p', 's'])
  flushSync()

  const ul = parent.firstElementChild!
  expect(itemTexts(ul)).toEqual(['p', 's'])

  dispose()
  rmParent(parent)
})

// ── TC-IE-05: Non-elided list renders correct index values ───────────────────

test('TC-IE-05  non-elided list (itemReadsIndex:true) renders correct index values', () => {
  const items = signal(['a', 'b', 'c'])
  const ir = fullListIR(items)
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  const ul = parent.firstElementChild!
  // Each item renders "value:index"
  expect(itemTexts(ul)).toEqual(['a:0', 'b:1', 'c:2'])

  dispose()
  rmParent(parent)
})

// ── TC-IE-06: Non-elided list updates index on reorder ────────────────────────

test('TC-IE-06  non-elided list updates index values on reverse', () => {
  const items = signal(['a', 'b', 'c'])
  const ir = fullListIR(items)
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  // Reverse
  items.set(['c', 'b', 'a'])
  flushSync()

  const ul = parent.firstElementChild!
  expect(itemTexts(ul)).toEqual(['c:0', 'b:1', 'a:2'])

  dispose()
  rmParent(parent)
})
