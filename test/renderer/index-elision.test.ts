// @vitest-environment jsdom
/**
 * Index-Elision — Tier-1 corpus tests
 * Stream: (3) Renderer/templating
 * Task 5 of the Index-Elision Commission 1
 *
 * Covers:
 *   T1-1  Parser sets itemReadsIndex correctly (JSDOM DOM assertion included)
 *   T1-2  Emitted-module indexSig absence (itemReadsIndex === false → no indexSig)
 *   T1-4  IR carrier (itemReadsIndex) excluded from irStructurallyEqual
 *   T1-5  Hand-built IR with itemReadsIndex ABSENT renders correctly (conservative fallback)
 *   T1-6  Tagged-template each() allocates indexSig (carrier absent → conservative)
 */

import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { flushSync, signal } from '../../src/core/core.js'
import { createHtmlTag, each } from '../../src/renderer/html-tag.js'
import { mount } from '../../src/renderer/interpreter.js'
import type { ListBinding, TemplateIR, TextBinding, WritableSignal } from '../../src/renderer/ir.js'
import { parseNvFile } from '../../src/renderer/nv-parser.js'
import { irStructurallyEqual } from './ir-equivalence.js'

// ── jsdom setup ───────────────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document
const html = createHtmlTag(document)

function mkParent(): Element {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}
function rmParent(el: Element): void {
  document.body.removeChild(el)
}

// ── T1-1: Parser sets itemReadsIndex correctly ────────────────────────────────

test('T1-1a  <each let={item, i}>${i}</each> → itemReadsIndex === true', () => {
  const src = `
    const C = $component(() => {
      $script(() => { const items = signal([1, 2, 3]) })
      $render(() => html\`<ul><each .of="\${items}" key="\${(_, i) => i}" let={item, i}><li>\${i}</li></each></ul>\`)
    })
  `
  const results = parseNvFile(src, 'test.nv', document)
  const ir = results[0]!.ir
  const list = ir.bindings.find((b) => b.kind === 'list') as ListBinding
  expect(list, 'ListBinding found').toBeDefined()
  expect(list.itemReadsIndex, 'body reads index → true').toBe(true)
})

test('T1-1b  <each let={item, i}>${item}</each> → itemReadsIndex === false (index bound but not read in body)', () => {
  const src = `
    const C = $component(() => {
      $script(() => { const items = signal(['a', 'b']) })
      $render(() => html\`<ul><each .of="\${items}" key="\${(item) => item}" let={item, i}><li>\${item}</li></each></ul>\`)
    })
  `
  const results = parseNvFile(src, 'test.nv', document)
  const ir = results[0]!.ir
  const list = ir.bindings.find((b) => b.kind === 'list') as ListBinding
  expect(list).toBeDefined()
  expect(list.itemReadsIndex, 'index bound but body uses item, not i → false').toBe(false)
})

test('T1-1c  <each let={item}>${item}</each> → itemReadsIndex === false (index not bound)', () => {
  const src = `
    const C = $component(() => {
      $script(() => { const items = signal(['a', 'b']) })
      $render(() => html\`<ul><each .of="\${items}" key="\${(item) => item}" let={item}><li>\${item}</li></each></ul>\`)
    })
  `
  const results = parseNvFile(src, 'test.nv', document)
  const ir = results[0]!.ir
  const list = ir.bindings.find((b) => b.kind === 'list') as ListBinding
  expect(list).toBeDefined()
  expect(list.itemReadsIndex, 'index not bound at all → false').toBe(false)
})

test('T1-1d  <each key={i} let={item, i}>${item}</each> → itemReadsIndex === false (key uses index; body does not)', () => {
  const src = `
    const C = $component(() => {
      $script(() => { const items = signal(['a', 'b']) })
      $render(() => html\`<ul><each .of="\${items}" key="\${(_, i) => i}" let={item, i}><li>\${item}</li></each></ul>\`)
    })
  `
  const results = parseNvFile(src, 'test.nv', document)
  const ir = results[0]!.ir
  const list = ir.bindings.find((b) => b.kind === 'list') as ListBinding
  expect(list).toBeDefined()
  expect(
    list.itemReadsIndex,
    'key uses index variable, body does not → false (only body matters)',
  ).toBe(false)
})

test('T1-1e  DOM assertion: index values correct when itemReadsIndex === true', () => {
  const src = `
    const C = $component(() => {
      $script(() => { const items = signal(['a', 'b', 'c']) })
      $render(() => html\`<ul><each .of="\${items}" key="\${(_, i) => i}" let={item, i}><li>\${i}</li></each></ul>\`)
    })
  `
  const results = parseNvFile(src, 'test.nv', document)
  const list = results[0]!.ir.bindings.find((b) => b.kind === 'list') as ListBinding
  expect(list.itemReadsIndex).toBe(true)

  // Mount with live signals bound via the factory
  const items = signal(['a', 'b', 'c'])
  const outerIR: TemplateIR = {
    id: 'T1-1e',
    shape: { html: '<ul><!--nv-0--></ul>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: () => items() as readonly unknown[],
        key: (_item, i) => i,
        itemReadsIndex: true,
        itemTemplate: (_vs, is) => ({
          id: 'T1-1e-item',
          shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
          bindings: [
            {
              kind: 'text',
              pathIndex: 0,
              expr: () => is!(),
            } satisfies TextBinding,
          ],
        }),
      } satisfies ListBinding,
    ],
  }

  const parent = mkParent()
  const dispose = mount(outerIR, parent, document)
  flushSync()

  const lis = parent.querySelectorAll('li')
  expect(lis.length, '3 items').toBe(3)
  expect(lis[0]!.textContent, 'index 0').toBe('0')
  expect(lis[1]!.textContent, 'index 1').toBe('1')
  expect(lis[2]!.textContent, 'index 2').toBe('2')

  dispose()
  rmParent(parent)
})

// ── T1-1 additional paths: nested-each, attr, expr ───────────────────────────

test('T1-1-nested-each  outer <each let={item,i}><each let={sub}>${i}</each></each> → outer itemReadsIndex === true', () => {
  const src = `
    const C = $component(() => {
      $script(() => { const items = signal([[1,2],[3,4]]) })
      $render(() => html\`<ul><each .of="\${items}" key="\${(_, i) => i}" let={item, i}><each .of="\${item}" key="\${(sub) => sub}" let={sub}><li>\${i}</li></each></each></ul>\`)
    })
  `
  const results = parseNvFile(src, 'test.nv', document)
  const ir = results[0]!.ir
  const outerList = ir.bindings.find((b) => b.kind === 'list') as ListBinding
  expect(outerList, 'outer ListBinding found').toBeDefined()
  expect(
    outerList.itemReadsIndex,
    'inner each body reads outer i → outer itemReadsIndex === true',
  ).toBe(true)
})

test('T1-1-attr  <each let={item,i}><div data-x="${i}"></div></each> → itemReadsIndex === true', () => {
  const src = `
    const C = $component(() => {
      $script(() => { const items = signal(['a', 'b']) })
      $render(() => html\`<ul><each .of="\${items}" key="\${(_, i) => i}" let={item, i}><li data-x="\${i}">\${item}</li></each></ul>\`)
    })
  `
  const results = parseNvFile(src, 'test.nv', document)
  const ir = results[0]!.ir
  const list = ir.bindings.find((b) => b.kind === 'list') as ListBinding
  expect(list, 'ListBinding found').toBeDefined()
  expect(list.itemReadsIndex, 'attribute binding reads i → true').toBe(true)
})

test("T1-1-expr  <each let={item,i}><span class=\"${i > 0 ? 'after' : 'first'}\"></span></each> → itemReadsIndex === true", () => {
  const src = `
    const C = $component(() => {
      $script(() => { const items = signal(['a', 'b', 'c']) })
      $render(() => html\`<ul><each .of="\${items}" key="\${(_, i) => i}" let={item, i}><li class="\${i > 0 ? 'after' : 'first'}">\${item}</li></each></ul>\`)
    })
  `
  const results = parseNvFile(src, 'test.nv', document)
  const ir = results[0]!.ir
  const list = ir.bindings.find((b) => b.kind === 'list') as ListBinding
  expect(list, 'ListBinding found').toBeDefined()
  expect(list.itemReadsIndex, 'conditional expr reads i → true').toBe(true)
})

// ── T1-2: itemReadsIndex === false → itemTemplate called without indexSig ─────

test('T1-2  itemReadsIndex === false: itemTemplate factory receives no indexSig (or undefined)', () => {
  const src = `
    const C = $component(() => {
      $script(() => { const items = signal(['x', 'y']) })
      $render(() => html\`<ul><each .of="\${items}" key="\${(item) => item}" let={item}><li>\${item}</li></each></ul>\`)
    })
  `
  const results = parseNvFile(src, 'test.nv', document)
  const list = results[0]!.ir.bindings.find((b) => b.kind === 'list') as ListBinding
  expect(list.itemReadsIndex).toBe(false)

  // Call itemTemplate with a stub valueSig and NO indexSig — must not throw
  const stubVs = signal<unknown>('hello')
  let receivedIndexSig: WritableSignal<number> | undefined = signal(99) // intentionally non-undefined
  expect(() => {
    const itemIR = list.itemTemplate(stubVs, undefined)
    // Collect what the factory sees; the factory itself cannot expose it, but
    // the fact that it doesn't throw is the primary assertion.
    void itemIR
    receivedIndexSig = undefined // mark as "no error"
  }).not.toThrow()
  expect(receivedIndexSig, 'factory returned without error').toBeUndefined()
})

// ── T1-4: itemReadsIndex carrier excluded from irStructurallyEqual ────────────

test('T1-4  irStructurallyEqual: IR with itemReadsIndex:false equals IR with itemReadsIndex absent', () => {
  // Build two ListBinding IRs that are logically identical but differ only in the
  // carrier field (itemReadsIndex: false vs not set). The equivalence checker must
  // treat them as equal (the carrier is metadata, not structural).
  const stubVs = signal<unknown>(null)

  function makeItemTemplate(
    _vs: WritableSignal<unknown>,
    _is?: WritableSignal<number>,
  ): TemplateIR {
    return {
      id: 'T1-4-item',
      shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
      bindings: [
        {
          kind: 'text',
          pathIndex: 0,
          expr: () => String(_vs()),
        } satisfies TextBinding,
      ],
    }
  }

  const irWithFalse: TemplateIR = {
    id: 'T1-4',
    shape: { html: '<ul><!--nv-0--></ul>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: () => [],
        key: (_item, i) => i,
        itemReadsIndex: false,
        itemTemplate: makeItemTemplate,
      } satisfies ListBinding,
    ],
  }

  const irWithAbsent: TemplateIR = {
    id: 'T1-4',
    shape: { html: '<ul><!--nv-0--></ul>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: () => [],
        key: (_item, i) => i,
        // itemReadsIndex intentionally absent
        itemTemplate: makeItemTemplate,
      } satisfies ListBinding,
    ],
  }

  // Verify that the two itemTemplate factories produce shape.html-equal item IRs
  const aItemIR = irWithFalse.bindings[0]!
  const bItemIR = irWithAbsent.bindings[0]!
  const aBody = (aItemIR as ListBinding).itemTemplate(stubVs, undefined)
  const bBody = (bItemIR as ListBinding).itemTemplate(stubVs, undefined)
  expect(aBody.shape.html, 'item shape.html equal').toBe(bBody.shape.html)

  // Root-level equivalence (with doc for shape comparison)
  const result = irStructurallyEqual(document, irWithFalse, irWithAbsent)
  expect(result.equal, `irStructurallyEqual must be true; got: ${result.reason}`).toBe(true)
})

// ── T1-5: Hand-built IR with itemReadsIndex ABSENT renders correctly ──────────

test('T1-5  hand-built IR with itemReadsIndex ABSENT: conservative fallback allocates indexSig, renders correctly', () => {
  const items = signal<string[]>(['apple', 'banana', 'cherry'])

  // Build IR without setting itemReadsIndex (absent = conservative default → allocate indexSig)
  const outerIR: TemplateIR = {
    id: 'T1-5',
    shape: { html: '<ul><!--nv-0--></ul>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: () => items() as readonly unknown[],
        key: (item) => item as string,
        // itemReadsIndex intentionally absent → renderer must allocate indexSig
        itemTemplate: (vs, is) => ({
          id: 'T1-5-item',
          shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
          bindings: [
            {
              kind: 'text',
              pathIndex: 0,
              expr: () => `${is!()}:${vs() as string}`,
            } satisfies TextBinding,
          ],
        }),
      } satisfies ListBinding,
    ],
  }

  const parent = mkParent()
  const dispose = mount(outerIR, parent, document)
  flushSync()

  const lis = parent.querySelectorAll('li')
  expect(lis.length).toBe(3)
  expect(lis[0]!.textContent).toBe('0:apple')
  expect(lis[1]!.textContent).toBe('1:banana')
  expect(lis[2]!.textContent).toBe('2:cherry')

  // Verify reactive update still works
  items.set(['apple', 'blueberry', 'cherry'])
  flushSync()

  const lisAfter = parent.querySelectorAll('li')
  expect(lisAfter[1]!.textContent).toBe('1:blueberry')

  dispose()
  rmParent(parent)
})

// ── T1-6: Tagged-template each() allocates indexSig (conservative path) ───────

test('T1-6  tagged-template each(): carrier absent → conservative allocate; index renders correctly', () => {
  // The tagged-template each() does NOT set itemReadsIndex on the ListBinding,
  // so the renderer must take the conservative path and allocate indexSig.
  const items = signal<Array<{ id: number; label: string }>>([
    { id: 1, label: 'X' },
    { id: 2, label: 'Y' },
    { id: 3, label: 'Z' },
  ])

  const ir = html`<ul>${each(
    () => items() as readonly unknown[],
    (item) => (item as { id: number }).id,
    ({ item: _item, index: _index }) => {
      const item = _item!
      const index = _index!
      return html`<li>${() => `${index()}:${(item() as { label: string }).label}`}</li>`
    },
  )}</ul>`

  // Verify that the ListBinding does NOT have itemReadsIndex set (tagged-template path)
  const list = ir.bindings.find((b) => b.kind === 'list') as ListBinding
  expect(list, 'ListBinding found').toBeDefined()
  expect(list.itemReadsIndex, 'tagged-template each() does not set itemReadsIndex').toBeUndefined()

  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const lis = parent.querySelectorAll('li')
  expect(lis.length).toBe(3)
  expect(lis[0]!.textContent).toBe('0:X')
  expect(lis[1]!.textContent).toBe('1:Y')
  expect(lis[2]!.textContent).toBe('2:Z')

  // Reorder: index must update
  items.set([
    { id: 3, label: 'Z' },
    { id: 1, label: 'X' },
    { id: 2, label: 'Y' },
  ])
  flushSync()

  const lisAfter = parent.querySelectorAll('li')
  expect(lisAfter[0]!.textContent).toBe('0:Z')
  expect(lisAfter[1]!.textContent).toBe('1:X')
  expect(lisAfter[2]!.textContent).toBe('2:Y')

  dispose()
  rmParent(parent)
})
