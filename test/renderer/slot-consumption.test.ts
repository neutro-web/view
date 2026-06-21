/**
 * Slot Consumption — Acceptance Gate Tests
 * Gate: docs/gates/slot-consumption-gate.md
 * Covers: G3.1 (FE-equivalence), G4.1–G4.6 (differential), G5.x (anti-vacuous sweep)
 */
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emitMount } from '../../src/compiler/emitted-mount.js'
import { createRoot, flushSync, signal } from '../../src/core/core.js'
import { createHtmlTag } from '../../src/renderer/html-tag.js'
import { mount } from '../../src/renderer/interpreter.js'
import type { ComponentBinding, TemplateIR } from '../../src/renderer/ir.js'
import { parseNvFile } from '../../src/renderer/nv-parser.js'
import { irStructurallyEqual } from './ir-equivalence.js'

// ── Test infrastructure ────────────────────────────────────────────────────────

let dom: JSDOM
let doc: Document
let container: HTMLElement

beforeEach(() => {
  dom = new JSDOM('<!DOCTYPE html><body><div id="app"></div></body>')
  doc = dom.window.document
  container = doc.getElementById('app')!
})

afterEach(() => {
  dom.window.close()
})

// Mount via interpreter, return disposer.
function mountI(ir: TemplateIR): () => void {
  let dispose!: () => void
  createRoot((d) => {
    dispose = mount(ir, container, doc)
    return d
  })
  flushSync()
  return dispose
}

// Mount via compiler (emitMount), return disposer.
function mountC(ir: TemplateIR): () => void {
  let dispose!: () => void
  createRoot((d) => {
    const { mountFn } = emitMount(ir)
    dispose = mountFn(container, doc)
    return d
  })
  flushSync()
  return dispose
}

// ── G3.1 — FE-equivalence (TIGHTENED: structural-comparator oracle) ───────────
describe('G3.1 — FE-equivalence: html-tag vs nv-parser slot sub-IRs are structurally identical', () => {
  it('static default slot: slot sub-IRs structurally identical across front-ends', () => {
    const html = createHtmlTag(doc)
    const label = 'test'
    const htmlIR = html`<div><Card .title="${() => label}"><p>Hello world</p></Card></div>`
    const htmlComp = htmlIR.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    expect(htmlComp).toBeDefined()
    const htmlSlot = htmlComp!.slots.find((s) => s.name === 'default')
    expect(htmlSlot).toBeDefined()

    const nvSrc = [
      'export const Parent = $component(() => {',
      '  $script(() => { const label = signal("test") })',
      '  $render(() => html`<Card .title="${label}"><p>Hello world</p></Card>`)',
      '})',
    ].join('\n')
    const nvIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir
    expect(nvIR).toBeDefined()
    const nvComp = nvIR!.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    expect(nvComp).toBeDefined()
    const nvSlot = nvComp!.slots.find((s) => s.name === 'default')
    expect(nvSlot).toBeDefined()

    const r = irStructurallyEqual(doc, htmlSlot!.content, nvSlot!.content)
    expect(r.equal, `default-slot sub-IR divergence: ${r.reason}`).toBe(true)
  })

  it('named slot with reactive hole: slot sub-IRs structurally identical across front-ends', () => {
    const html = createHtmlTag(doc)
    const sig = signal(0)
    const htmlIR = html`<div><Card><slot name="header">${() => sig()}</slot></Card></div>`
    const htmlComp = htmlIR.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    expect(htmlComp).toBeDefined()
    const htmlHeader = htmlComp!.slots.find((s) => s.name === 'header')
    expect(htmlHeader).toBeDefined()

    const nvSrc = [
      'export const Parent = $component(() => {',
      '  $script(() => { const count = signal(0) })',
      '  $render(() => html`<Card><slot name="header">${count}</slot></Card>`)',
      '})',
    ].join('\n')
    const nvIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir
    expect(nvIR).toBeDefined()
    const nvComp = nvIR!.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    expect(nvComp).toBeDefined()
    const nvHeader = nvComp!.slots.find((s) => s.name === 'header')
    expect(nvHeader).toBeDefined()

    const r = irStructurallyEqual(doc, htmlHeader!.content, nvHeader!.content)
    expect(r.equal, `named-slot sub-IR divergence: ${r.reason}`).toBe(true)
    expect(nvHeader!.content.bindings.length).toBeGreaterThan(0)
    expect(nvHeader!.content.bindings[0]!.kind).toBe('text')
  })
})

// ── G4.1 — Named slot renders at its outlet ────────────────────────────────────

describe('G4.1 — Named slot renders at outlet', () => {
  function buildIR(): TemplateIR {
    const headerSlotIR: TemplateIR = {
      id: 'slot:g41:header',
      shape: { html: 'My Header', bindingPaths: [] },
      bindings: [],
    }
    const footerSlotIR: TemplateIR = {
      id: 'slot:g41:footer',
      shape: { html: 'My Footer', bindingPaths: [] },
      bindings: [],
    }
    const childIR: TemplateIR = {
      id: 'child:g41',
      shape: {
        html: '<div class="child"><header><!--nv-0--></header><footer><!--nv-1--></footer></div>',
        bindingPaths: [
          [0, 0, 0],
          [0, 1, 0],
        ],
      },
      bindings: [
        { kind: 'slot-outlet', pathIndex: 0, name: 'header' },
        { kind: 'slot-outlet', pathIndex: 1, name: 'footer' },
      ],
    }
    return {
      id: 'parent:g41',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [
            { name: 'header', content: headerSlotIR },
            { name: 'footer', content: footerSlotIR },
          ],
        },
      ],
    }
  }

  it('interpreter: named slot content placed at correct outlet', () => {
    mountI(buildIR())
    expect(container.querySelector('header')?.textContent).toBe('My Header')
    expect(container.querySelector('footer')?.textContent).toBe('My Footer')
  })

  it('compiler: named slot content placed at correct outlet', () => {
    mountC(buildIR())
    expect(container.querySelector('header')?.textContent).toBe('My Header')
    expect(container.querySelector('footer')?.textContent).toBe('My Footer')
  })
})

// ── G4.2 — Default + named slots coexist ──────────────────────────────────────

describe('G4.2 — Default + named slots coexist', () => {
  function buildIR(): TemplateIR {
    const defaultSlotIR: TemplateIR = {
      id: 'slot:g42:default',
      shape: { html: 'Default content', bindingPaths: [] },
      bindings: [],
    }
    const headerSlotIR: TemplateIR = {
      id: 'slot:g42:header',
      shape: { html: 'Header content', bindingPaths: [] },
      bindings: [],
    }
    const childIR: TemplateIR = {
      id: 'child:g42',
      shape: {
        html: '<div><section class="default"><!--nv-0--></section><section class="named"><!--nv-1--></section></div>',
        bindingPaths: [
          [0, 0, 0],
          [0, 1, 0],
        ],
      },
      bindings: [
        { kind: 'slot-outlet', pathIndex: 0, name: 'default' },
        { kind: 'slot-outlet', pathIndex: 1, name: 'header' },
      ],
    }
    return {
      id: 'parent:g42',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [
            { name: 'default', content: defaultSlotIR },
            { name: 'header', content: headerSlotIR },
          ],
        },
      ],
    }
  }

  it('interpreter: both default and named slots filled correctly', () => {
    mountI(buildIR())
    expect(container.querySelector('.default')?.textContent).toBe('Default content')
    expect(container.querySelector('.named')?.textContent).toBe('Header content')
  })

  it('compiler: both default and named slots filled correctly', () => {
    mountC(buildIR())
    expect(container.querySelector('.default')?.textContent).toBe('Default content')
    expect(container.querySelector('.named')?.textContent).toBe('Header content')
  })
})

// ── G4.3 — Reactive hole inside a slot updates ────────────────────────────────

describe('G4.3 — Reactive hole inside a slot updates on parent signal write', () => {
  function buildIR(sig: ReturnType<typeof signal<string>>): TemplateIR {
    const slotContentIR: TemplateIR = {
      id: 'slot:g43',
      shape: { html: '<!--nv-0-->', bindingPaths: [[0]] },
      bindings: [{ kind: 'text', pathIndex: 0, expr: () => sig() }],
    }
    const childIR: TemplateIR = {
      id: 'child:g43',
      shape: { html: '<span><!--nv-0--></span>', bindingPaths: [[0, 0]] },
      bindings: [{ kind: 'slot-outlet', pathIndex: 0, name: 'default' }],
    }
    return {
      id: 'parent:g43',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [{ name: 'default', content: slotContentIR }],
        },
      ],
    }
  }

  it('interpreter: slot DOM updates when parent signal changes', () => {
    const sig = signal('initial')
    mountI(buildIR(sig))
    expect(container.querySelector('span')?.textContent).toBe('initial')
    sig.set('updated')
    flushSync()
    // G5.3: assert DOM value, not just "effect ran"
    expect(container.querySelector('span')?.textContent).toBe('updated')
  })

  it('compiler: slot DOM updates when parent signal changes', () => {
    const sig = signal('initial')
    mountC(buildIR(sig))
    expect(container.querySelector('span')?.textContent).toBe('initial')
    sig.set('updated')
    flushSync()
    expect(container.querySelector('span')?.textContent).toBe('updated')
  })
})

// ── G4.4 — Unfilled slot renders nothing ──────────────────────────────────────

describe('G4.4 — Unfilled named slot renders nothing', () => {
  function buildIR(): TemplateIR {
    const childIR: TemplateIR = {
      id: 'child:g44',
      shape: { html: '<div class="wrapper"><!--nv-0--></div>', bindingPaths: [[0, 0]] },
      bindings: [{ kind: 'slot-outlet', pathIndex: 0, name: 'optional' }],
    }
    return {
      id: 'parent:g44',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [], // no slot provided — unfilled
        },
      ],
    }
  }

  it('interpreter: unfilled slot leaves wrapper with no element children and no text', () => {
    mountI(buildIR())
    const wrapper = container.querySelector('.wrapper')
    expect(wrapper).not.toBeNull()
    const childNodes = Array.from(wrapper!.childNodes)
    const elementChildren = childNodes.filter((n) => n.nodeType === 1)
    expect(elementChildren.length).toBe(0)
    const meaningfulText = childNodes.filter(
      (n) => n.nodeType === 3 && (n as Text).data.trim() !== '',
    )
    expect(meaningfulText.length).toBe(0)
  })

  it('compiler: unfilled slot leaves wrapper with no element children and no text', () => {
    mountC(buildIR())
    const wrapper = container.querySelector('.wrapper')
    expect(wrapper).not.toBeNull()
    const childNodes = Array.from(wrapper!.childNodes)
    const elementChildren = childNodes.filter((n) => n.nodeType === 1)
    expect(elementChildren.length).toBe(0)
    const meaningfulText = childNodes.filter(
      (n) => n.nodeType === 3 && (n as Text).data.trim() !== '',
    )
    expect(meaningfulText.length).toBe(0)
  })
})

// ── G4.5 — Parent-dispose tears down slot effects and DOM ─────────────────────

describe('G4.5 — Parent dispose: slot effects and DOM torn down', () => {
  function buildIR(sig: ReturnType<typeof signal<string>>): TemplateIR {
    const slotContentIR: TemplateIR = {
      id: 'slot:g45',
      shape: { html: '<!--nv-0-->', bindingPaths: [[0]] },
      bindings: [{ kind: 'text', pathIndex: 0, expr: () => sig() }],
    }
    const childIR: TemplateIR = {
      id: 'child:g45',
      shape: { html: '<p class="slotted"><!--nv-0--></p>', bindingPaths: [[0, 0]] },
      bindings: [{ kind: 'slot-outlet', pathIndex: 0, name: 'default' }],
    }
    return {
      id: 'parent:g45',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [{ name: 'default', content: slotContentIR }],
        },
      ],
    }
  }

  it('interpreter: after parent dispose, slot DOM removed and signal write does not throw', () => {
    const sig = signal('hello')
    const dispose = mountI(buildIR(sig))
    expect(container.querySelector('.slotted')?.textContent).toBe('hello')

    dispose()
    flushSync()

    // DOM removed
    expect(container.querySelector('.slotted')).toBeNull()
    // POSITIVE: signal is not the thing that was disposed — effects are; sig.set must not throw
    expect(() => sig.set('after-dispose')).not.toThrow()
    // NEGATIVE: no DOM mutation (element gone)
    expect(container.querySelector('.slotted')).toBeNull()
  })

  it('compiler: after parent dispose, slot DOM removed and signal write does not throw', () => {
    const sig = signal('hello')
    const dispose = mountC(buildIR(sig))
    expect(container.querySelector('.slotted')?.textContent).toBe('hello')

    dispose()
    flushSync()

    expect(container.querySelector('.slotted')).toBeNull()
    expect(() => sig.set('after-dispose')).not.toThrow()
    expect(container.querySelector('.slotted')).toBeNull()
  })
})

// ── G4.6 — Child-dispose: parent signal stays live, disposed region doesn't mutate ──

describe('G4.6 — Child-dispose: parent signal live, disposed region does NOT mutate', () => {
  /**
   * Structure: a parent reactive root owns the signal and the slot content.
   * A child reactive root owns the component mount (slot-outlet wiring).
   * Disposing ONLY the child root must:
   *   POSITIVE — parent signal still writable (no throw on .set()).
   *   NEGATIVE — writing the signal does NOT mutate the disposed slot DOM.
   *
   * We simulate this by wrapping the component mount in a nested createRoot
   * that we can dispose independently of the parent scope.
   */
  function buildSlotIR(sig: ReturnType<typeof signal<string>>) {
    return {
      slotContentIR: {
        id: 'slot:g46',
        shape: { html: '<!--nv-0-->', bindingPaths: [[0]] } as const,
        bindings: [{ kind: 'text' as const, pathIndex: 0, expr: () => sig() }],
      } satisfies TemplateIR,
      childIR: {
        id: 'child:g46',
        shape: {
          html: '<section data-testid="child-g46"><!--nv-0--></section>',
          bindingPaths: [[0, 0]] as const,
        },
        bindings: [{ kind: 'slot-outlet' as const, pathIndex: 0, name: 'default' }],
      } satisfies TemplateIR,
    }
  }

  it('interpreter: parent signal live after child dispose, disposed region does NOT mutate', () => {
    const sig = signal('before')
    const { slotContentIR, childIR } = buildSlotIR(sig)

    const wrapperIR: TemplateIR = {
      id: 'wrapper:g46:i',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [{ name: 'default', content: slotContentIR }],
        },
      ],
    }

    const disposes = { parent: (() => {}) as () => void, child: (() => {}) as () => void }

    disposes.parent = createRoot((parentD) => {
      // Child root is nested inside parent — simulates child component lifecycle
      disposes.child = createRoot((childD) => {
        mount(wrapperIR, container, doc)
        return childD
      })
      return parentD
    })

    flushSync()
    expect(container.querySelector('[data-testid="child-g46"]')?.textContent).toBe('before')

    // Dispose ONLY the child root
    disposes.child()
    flushSync()

    // Snapshot the disposed region's text
    const childEl = container.querySelector('[data-testid="child-g46"]')
    const textBefore = childEl?.textContent ?? ''

    // POSITIVE: parent signal is still live and writable — must not throw
    expect(() => sig.set('after-child-dispose')).not.toThrow()
    flushSync()

    // NEGATIVE: the disposed slot region must NOT reflect the new value
    const textAfter = childEl?.textContent ?? ''
    expect(textAfter).toBe(textBefore)
    expect(textAfter).not.toBe('after-child-dispose')

    disposes.parent()
  })

  it('compiler: parent signal live after child dispose, disposed region does NOT mutate', () => {
    const sig = signal('before')
    const { slotContentIR, childIR } = buildSlotIR(sig)

    const wrapperIR: TemplateIR = {
      id: 'wrapper:g46:c',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [{ name: 'default', content: slotContentIR }],
        },
      ],
    }

    const disposes = { parent: (() => {}) as () => void, child: (() => {}) as () => void }

    disposes.parent = createRoot((parentD) => {
      disposes.child = createRoot((childD) => {
        const { mountFn } = emitMount(wrapperIR)
        mountFn(container, doc)
        return childD
      })
      return parentD
    })

    flushSync()
    expect(container.querySelector('[data-testid="child-g46"]')?.textContent).toBe('before')

    // Dispose ONLY the child root
    disposes.child()
    flushSync()

    const childEl = container.querySelector('[data-testid="child-g46"]')
    const textBefore = childEl?.textContent ?? ''

    // POSITIVE: parent signal still writable — must not throw
    expect(() => sig.set('after-child-dispose')).not.toThrow()
    flushSync()

    // NEGATIVE: disposed slot region must NOT reflect the new value
    const textAfter = childEl?.textContent ?? ''
    expect(textAfter).toBe(textBefore)
    expect(textAfter).not.toBe('after-child-dispose')

    disposes.parent()
  })
})
