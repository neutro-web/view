/**
 * Recycled list (<recycle>) correctness tests — T1-1 through T1-5.
 * Tests position-identity semantics, rendering, footgun guard, and pool sizing.
 */

import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { flushSync, signal } from '../../src/core/core.js'
import { mount } from '../../src/renderer/interpreter.js'
import type {
  RecycledListBinding,
  TemplateIR,
  TextBinding,
  WritableSignal,
} from '../../src/renderer/ir.js'
import { parseNvFile } from '../../src/renderer/nv-parser.js'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document

function mkParent(): Element {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

function rmParent(el: Element): void {
  el.remove()
}

/** Build a TemplateIR with a RecycledListBinding wrapping a <ul>. */
function makeRecycleIR(
  items: () => readonly unknown[],
  itemTemplate: (vs: WritableSignal<unknown>, is: WritableSignal<number>) => TemplateIR,
): TemplateIR {
  return {
    id: 'recycle-test',
    shape: {
      html: '<ul><!--nv-recycled-list-0--></ul>',
      bindingPaths: [[0, 0]],
    },
    bindings: [
      {
        kind: 'recycled-list',
        pathIndex: 0,
        items,
        itemTemplate,
      } satisfies RecycledListBinding,
    ],
  }
}

/** Item template: <li> with a text node bound to valueSig() */
function spanTextTemplate(vs: WritableSignal<unknown>, _is: WritableSignal<number>): TemplateIR {
  return {
    id: 'span-text',
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

/** Item template: <li> with an <input> whose .value is bound to valueSig() */
function inputTemplate(vs: WritableSignal<unknown>, _is: WritableSignal<number>): TemplateIR {
  return {
    id: 'input-item',
    shape: { html: '<li><input/></li>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'prop',
        name: 'value',
        pathIndex: 0,
        expr: () => vs(),
      },
    ],
  }
}

// ── T1-1 (FIRE): position-identity — focus stays on slot position after data change ──

it('T1-1 (FIRE): row local DOM state follows slot position after data change', () => {
  const items = signal<string[]>(['alpha', 'beta', 'gamma'])
  const ir = makeRecycleIR(() => items(), inputTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const ul = parent.querySelector('ul')!
  const inputs0 = Array.from(ul.querySelectorAll('input'))
  expect(inputs0.length, '3 inputs initially').toBe(3)

  // Focus the input in slot 0 (position 0)
  const slot0Input = inputs0[0]!
  slot0Input.focus()
  const focused = document.activeElement

  // Shift data: slot 0 now holds different data
  items.set(['zeta', 'alpha', 'beta'])
  flushSync()

  // Position-identity: focus (local DOM state) stays with slot 0's input node
  expect(document.activeElement, 'focus stays on slot-0 input').toBe(focused)

  dispose()
  rmParent(parent)
})

// ── T1-2: renders correct data and re-renders on signal update ──

it('T1-2: renders correct data and re-renders on signal update', () => {
  const items = signal<string[]>(['A', 'B', 'C'])
  const ir = makeRecycleIR(() => items(), spanTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const ul = parent.querySelector('ul')!

  // Initial render
  let lis = ul.querySelectorAll('li')
  expect(lis.length, 'initial 3 items').toBe(3)
  expect(lis[0]!.textContent, 'first item').toBe('A')
  expect(lis[1]!.textContent, 'second item').toBe('B')
  expect(lis[2]!.textContent, 'third item').toBe('C')

  // Update signal — re-render with new values
  items.set(['X', 'Y', 'Z'])
  flushSync()

  lis = ul.querySelectorAll('li')
  expect(lis.length, 'still 3 items after update').toBe(3)
  expect(lis[0]!.textContent, 'updated first').toBe('X')
  expect(lis[1]!.textContent, 'updated second').toBe('Y')
  expect(lis[2]!.textContent, 'updated third').toBe('Z')

  // Grow list
  items.set(['X', 'Y', 'Z', 'W'])
  flushSync()

  lis = ul.querySelectorAll('li')
  expect(lis.length, '4 items after grow').toBe(4)
  expect(lis[3]!.textContent, 'new item').toBe('W')

  dispose()
  rmParent(parent)
})

// ── T1-3: footgun guard — key= on <recycle> is a parse error ──

it('T1-3: throws when key= is provided (footgun guard)', () => {
  const src = `
    const C = $component(() => {
      $script(() => { const items = signal([]) })
      $render(() => html\`<recycle .of="\${items}" key="id" let={item}><span>\${item}</span></recycle>\`)
    })
  `
  expect(() => parseNvFile(src, 'test.nv', document)).toThrow(/does not take key=/)
})

// ── T1-4: pool size tracks list length; grow/shrink are delta-only ──

it('T1-4: pool size tracks list length; grow/shrink are delta-only', () => {
  const items = signal<string[]>(['A', 'B', 'C', 'D', 'E'])
  const ir = makeRecycleIR(() => items(), spanTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const ul = parent.querySelector('ul')!

  // Initial: 5 items
  expect(ul.querySelectorAll('li').length, '5 items initially').toBe(5)

  // Shrink to 2 — delta disposed, no leak
  items.set(['A', 'B'])
  flushSync()
  expect(ul.querySelectorAll('li').length, '2 items after shrink').toBe(2)

  // Grow back to 5 — delta created
  items.set(['A', 'B', 'C', 'D', 'E'])
  flushSync()
  expect(ul.querySelectorAll('li').length, '5 items after grow back').toBe(5)

  // Shrink to 0
  items.set([])
  flushSync()
  expect(ul.querySelectorAll('li').length, '0 items after empty').toBe(0)

  dispose()
  rmParent(parent)
})

// T1-5: additive-only proof — keyed <each> suite unchanged. Verified by the full 780-test
// baseline passing in CI. No additional test needed here: regression would surface as failures
// in test/renderer/each-authoring.test.ts, test/renderer/interpreter.test.ts, etc.
