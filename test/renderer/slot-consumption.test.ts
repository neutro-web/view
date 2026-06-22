/**
 * Slot Consumption — Acceptance Gate Tests
 * Gate: docs/gates/slot-consumption-gate.md
 * Covers: G3.1 (FE-equivalence), G4.1–G4.6 (differential), G5.x (anti-vacuous sweep)
 */
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emitMount } from '../../src/compiler/emitted-mount.js'
import { createRoot, flushSync, signal } from '../../src/core/core.js'
import { createHtmlTag, slots } from '../../src/renderer/html-tag.js'
import { mount } from '../../src/renderer/interpreter.js'
import type {
  ComponentBinding,
  ConditionalBinding,
  SlotOutletBinding,
  TemplateIR,
} from '../../src/renderer/ir.js'
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

// ── §8.2 corpus extension — Slot-builder defects B1/B2/B3 ─────────────────────

describe('§8.2-B1 — slot-with-prop-hole: sub-builder emits PropBinding, not TextBinding', () => {
  it('FE: html-tag slot sub-IR has PropBinding for .prop= hole', () => {
    const html = createHtmlTag(doc)
    const cls = signal('primary')
    const ir = html`<Card><slot name="body"><span .className="${() => cls()}">hi</span></slot></Card>`
    const comp = ir.bindings.find((b) => b.kind === 'component') as ComponentBinding | undefined
    expect(comp).toBeDefined()
    const body = comp!.slots.find((s) => s.name === 'body')
    expect(body).toBeDefined()
    expect(body!.content.bindings[0]?.kind).toBe('prop')
  })

  it('FE: nv-parser slot sub-IR has PropBinding for .prop= hole', () => {
    const nvSrc = [
      'export const P = $component(() => {',
      '  $script(() => { const cls = signal("primary") })',
      '  $render(() => html`<Card><slot name="body"><span .className="${cls}">hi</span></slot></Card>`)',
      '})',
    ].join('\n')
    const nvIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir
    expect(nvIR).toBeDefined()
    const nvComp = nvIR!.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    expect(nvComp).toBeDefined()
    const nvBody = nvComp!.slots.find((s) => s.name === 'body')
    expect(nvBody).toBeDefined()
    expect(nvBody!.content.bindings[0]?.kind).toBe('prop')
  })

  it('FE-equivalence: both front-ends produce identical prop-hole slot sub-IRs', () => {
    const html = createHtmlTag(doc)
    const cls = signal('primary')
    const htmlIR = html`<Card><slot name="body"><span .className="${() => cls()}">hi</span></slot></Card>`
    const htmlComp = htmlIR.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    const htmlBody = htmlComp!.slots.find((s) => s.name === 'body')!

    const nvSrc = [
      'export const P = $component(() => {',
      '  $script(() => { const cls = signal("primary") })',
      '  $render(() => html`<Card><slot name="body"><span .className="${cls}">hi</span></slot></Card>`)',
      '})',
    ].join('\n')
    const nvIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir!
    const nvComp = nvIR.bindings.find((b) => b.kind === 'component') as ComponentBinding | undefined
    const nvBody = nvComp!.slots.find((s) => s.name === 'body')!

    const r = irStructurallyEqual(doc, htmlBody.content, nvBody.content)
    expect(r.equal, `prop-slot sub-IR divergence: ${r.reason}`).toBe(true)
  })

  it('interpreter: prop hole in slot content sets and updates DOM property', () => {
    const cls = signal('initial')
    const slotIR: TemplateIR = {
      id: 'slot:b1prop:body',
      shape: { html: '<span>hi</span>', bindingPaths: [[0]] },
      bindings: [{ kind: 'prop', pathIndex: 0, name: 'className', expr: () => cls() }],
    }
    const childIR: TemplateIR = {
      id: 'child:b1prop',
      shape: { html: '<!--nv-0-->', bindingPaths: [[0]] },
      bindings: [{ kind: 'slot-outlet', pathIndex: 0, name: 'body' }],
    }
    const ir: TemplateIR = {
      id: 'parent:b1prop:i',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [{ name: 'body', content: slotIR }],
        },
      ],
    }
    mountI(ir)
    expect(container.querySelector('span')?.className).toBe('initial')
    cls.set('updated')
    flushSync()
    expect(container.querySelector('span')?.className).toBe('updated')
  })

  it('compiler: prop hole in slot content sets and updates DOM property', () => {
    const cls = signal('initial')
    const slotIR: TemplateIR = {
      id: 'slot:b1prop:body',
      shape: { html: '<span>hi</span>', bindingPaths: [[0]] },
      bindings: [{ kind: 'prop', pathIndex: 0, name: 'className', expr: () => cls() }],
    }
    const childIR: TemplateIR = {
      id: 'child:b1prop',
      shape: { html: '<!--nv-0-->', bindingPaths: [[0]] },
      bindings: [{ kind: 'slot-outlet', pathIndex: 0, name: 'body' }],
    }
    const ir: TemplateIR = {
      id: 'parent:b1prop:c',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [{ name: 'body', content: slotIR }],
        },
      ],
    }
    mountC(ir)
    expect(container.querySelector('span')?.className).toBe('initial')
    cls.set('updated')
    flushSync()
    expect(container.querySelector('span')?.className).toBe('updated')
  })
})

describe('§8.2-B1 — slot-with-event-hole: sub-builder emits EventBinding, not TextBinding', () => {
  it('FE: html-tag slot sub-IR has EventBinding for @event= hole', () => {
    const html = createHtmlTag(doc)
    let clicks = 0
    const ir = html`<Card><slot name="body"><button @click="${() => () => {
      clicks++
    }}">btn</button></slot></Card>`
    const comp = ir.bindings.find((b) => b.kind === 'component') as ComponentBinding | undefined
    expect(comp).toBeDefined()
    const body = comp!.slots.find((s) => s.name === 'body')
    expect(body).toBeDefined()
    expect(body!.content.bindings[0]?.kind).toBe('event')
    void clicks
  })

  it('FE: nv-parser slot sub-IR has EventBinding for @event= hole', () => {
    const nvSrc = [
      'export const P = $component(() => {',
      '  $script(() => { const handler = signal(() => {}) })',
      '  $render(() => html`<Card><slot name="body"><button @click="${handler}">btn</button></slot></Card>`)',
      '})',
    ].join('\n')
    const nvIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir
    expect(nvIR).toBeDefined()
    const nvComp = nvIR!.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    expect(nvComp).toBeDefined()
    const nvBody = nvComp!.slots.find((s) => s.name === 'body')
    expect(nvBody).toBeDefined()
    expect(nvBody!.content.bindings[0]?.kind).toBe('event')
  })

  it('FE-equivalence: both front-ends produce identical event-hole slot sub-IRs', () => {
    const html = createHtmlTag(doc)
    let clicks = 0
    const htmlIR = html`<Card><slot name="body"><button @click="${() => () => {
      clicks++
    }}">btn</button></slot></Card>`
    const htmlComp = htmlIR.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    const htmlBody = htmlComp!.slots.find((s) => s.name === 'body')!
    void clicks

    const nvSrc = [
      'export const P = $component(() => {',
      '  $script(() => { const handler = signal(() => {}) })',
      '  $render(() => html`<Card><slot name="body"><button @click="${handler}">btn</button></slot></Card>`)',
      '})',
    ].join('\n')
    const nvIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir!
    const nvComp = nvIR.bindings.find((b) => b.kind === 'component') as ComponentBinding | undefined
    const nvBody = nvComp!.slots.find((s) => s.name === 'body')!

    const r = irStructurallyEqual(doc, htmlBody.content, nvBody.content)
    expect(r.equal, `event-slot sub-IR divergence: ${r.reason}`).toBe(true)
  })

  it('interpreter: event hole in slot content fires handler on dispatch', () => {
    let clicks = 0
    const evtSlotIR: TemplateIR = {
      id: 'slot:b1evt:body',
      shape: { html: '<button>btn</button>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'event',
          pathIndex: 0,
          eventName: 'click',
          handler: () => () => {
            clicks++
          },
          handlerKind: 'reactive',
        },
      ],
    }
    const childIR: TemplateIR = {
      id: 'child:b1evt',
      shape: { html: '<!--nv-0-->', bindingPaths: [[0]] },
      bindings: [{ kind: 'slot-outlet', pathIndex: 0, name: 'body' }],
    }
    const ir: TemplateIR = {
      id: 'parent:b1evt:i',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [{ name: 'body', content: evtSlotIR }],
        },
      ],
    }
    mountI(ir)
    const btn = container.querySelector('button')
    expect(btn).toBeDefined()
    btn!.dispatchEvent(new dom.window.Event('click'))
    expect(clicks).toBe(1)
  })

  it('compiler: event hole in slot content fires handler on dispatch', () => {
    let clicks = 0
    const evtSlotIR: TemplateIR = {
      id: 'slot:b1evt:body',
      shape: { html: '<button>btn</button>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'event',
          pathIndex: 0,
          eventName: 'click',
          handler: () => () => {
            clicks++
          },
          handlerKind: 'reactive',
        },
      ],
    }
    const childIR: TemplateIR = {
      id: 'child:b1evt',
      shape: { html: '<!--nv-0-->', bindingPaths: [[0]] },
      bindings: [{ kind: 'slot-outlet', pathIndex: 0, name: 'body' }],
    }
    const ir: TemplateIR = {
      id: 'parent:b1evt:c',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [{ name: 'body', content: evtSlotIR }],
        },
      ],
    }
    mountC(ir)
    const btn = container.querySelector('button')
    expect(btn).toBeDefined()
    btn!.dispatchEvent(new dom.window.Event('click'))
    expect(clicks).toBe(1)
  })
})

describe('§8.2-B2 — outlet-via-slots-sentinel: slots("name") produces SlotOutletBinding', () => {
  it('FE: html-tag ${slots("name")} in child template produces SlotOutletBinding', () => {
    const html = createHtmlTag(doc)
    const childIR = html`<div>${slots('header')}</div>`
    expect(childIR.bindings[0]?.kind).toBe('slot-outlet')
    expect((childIR.bindings[0] as SlotOutletBinding).name).toBe('header')
  })

  it('FE: nv-parser ${slots.header} in child template produces SlotOutletBinding', () => {
    const nvSrc = [
      'export const Child = $component(() => {',
      '  $render(() => html`<div>${slots.header}</div>`)',
      '})',
    ].join('\n')
    const nvIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir
    expect(nvIR).toBeDefined()
    expect(nvIR!.bindings[0]?.kind).toBe('slot-outlet')
    expect((nvIR!.bindings[0] as SlotOutletBinding).name).toBe('header')
  })

  it('FE-equivalence: html-tag slots() and nv-parser slots.x produce identical child IRs', () => {
    const html = createHtmlTag(doc)
    const htmlChildIR = html`<div>${slots('header')}</div>`

    const nvSrc = [
      'export const Child = $component(() => {',
      '  $render(() => html`<div>${slots.header}</div>`)',
      '})',
    ].join('\n')
    const nvChildIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir!

    const r = irStructurallyEqual(doc, htmlChildIR, nvChildIR)
    expect(r.equal, `outlet-sentinel IR divergence: ${r.reason}`).toBe(true)
  })

  it('interpreter: slots() outlet renders filled slot content in child', () => {
    const headerContentIR: TemplateIR = {
      id: 'slot:b2:header',
      shape: { html: '<strong>Title</strong>', bindingPaths: [] },
      bindings: [],
    }
    const childIR: TemplateIR = {
      id: 'child:b2',
      shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
      bindings: [{ kind: 'slot-outlet', pathIndex: 0, name: 'header' }],
    }
    const ir: TemplateIR = {
      id: 'parent:b2:i',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [{ name: 'header', content: headerContentIR }],
        },
      ],
    }
    mountI(ir)
    expect(container.querySelector('strong')?.textContent).toBe('Title')
  })

  it('compiler: slots() outlet renders filled slot content in child', () => {
    const headerContentIR: TemplateIR = {
      id: 'slot:b2:header',
      shape: { html: '<strong>Title</strong>', bindingPaths: [] },
      bindings: [],
    }
    const childIR: TemplateIR = {
      id: 'child:b2',
      shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
      bindings: [{ kind: 'slot-outlet', pathIndex: 0, name: 'header' }],
    }
    const ir: TemplateIR = {
      id: 'parent:b2:c',
      shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'component',
          pathIndex: 0,
          component: () => childIR,
          props: [],
          propNames: [],
          slots: [{ name: 'header', content: headerContentIR }],
        },
      ],
    }
    mountC(ir)
    expect(container.querySelector('strong')?.textContent).toBe('Title')
  })
})

describe('§8.2-B3 — outlet-inside-slot-content: slot sub-builder detects slots() outlet', () => {
  it('FE: html-tag slot sub-IR has SlotOutletBinding when slot content contains slots() sentinel', () => {
    const html = createHtmlTag(doc)
    const ir = html`<Outer><slot name="body">${slots('inner')}</slot></Outer>`
    const comp = ir.bindings.find((b) => b.kind === 'component') as ComponentBinding | undefined
    expect(comp).toBeDefined()
    const body = comp!.slots.find((s) => s.name === 'body')
    expect(body).toBeDefined()
    expect(body!.content.bindings[0]?.kind).toBe('slot-outlet')
    expect((body!.content.bindings[0] as SlotOutletBinding).name).toBe('inner')
  })

  it('FE: nv-parser slot sub-IR has SlotOutletBinding when slot content contains slots.x outlet', () => {
    const nvSrc = [
      'export const P = $component(() => {',
      '  $render(() => html`<Outer><slot name="body">${slots.inner}</slot></Outer>`)',
      '})',
    ].join('\n')
    const nvIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir
    expect(nvIR).toBeDefined()
    const nvComp = nvIR!.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    expect(nvComp).toBeDefined()
    const nvBody = nvComp!.slots.find((s) => s.name === 'body')
    expect(nvBody).toBeDefined()
    expect(nvBody!.content.bindings[0]?.kind).toBe('slot-outlet')
    expect((nvBody!.content.bindings[0] as SlotOutletBinding).name).toBe('inner')
  })

  it('FE-equivalence: both front-ends agree on outlet-inside-slot-content sub-IR', () => {
    const html = createHtmlTag(doc)
    const htmlIR = html`<Outer><slot name="body">${slots('inner')}</slot></Outer>`
    const htmlComp = htmlIR.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    const htmlBody = htmlComp!.slots.find((s) => s.name === 'body')!

    const nvSrc = [
      'export const P = $component(() => {',
      '  $render(() => html`<Outer><slot name="body">${slots.inner}</slot></Outer>`)',
      '})',
    ].join('\n')
    const nvIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir!
    const nvComp = nvIR.bindings.find((b) => b.kind === 'component') as ComponentBinding | undefined
    const nvBody = nvComp!.slots.find((s) => s.name === 'body')!

    const r = irStructurallyEqual(doc, htmlBody.content, nvBody.content)
    expect(r.equal, `outlet-in-slot-content sub-IR divergence: ${r.reason}`).toBe(true)
  })
})

describe('§8.2-B3 — conditional-inside-slot-content: nv-parser slot sub-builder detects ternary conditional', () => {
  it('FE: nv-parser slot sub-IR has ConditionalBinding when slot content contains conditional', () => {
    const nvSrc = [
      'export const P = $component(() => {',
      '  $script(() => { const show = signal(true) })',
      '  $render(() => html`<Outer><slot name="body">${show ? html`<p>Yes</p>` : html`<p>No</p>`}</slot></Outer>`)',
      '})',
    ].join('\n')
    const nvIR = parseNvFile(nvSrc, 'test.nv', doc)[0]?.ir
    expect(nvIR).toBeDefined()
    const nvComp = nvIR!.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    expect(nvComp).toBeDefined()
    const nvBody = nvComp!.slots.find((s) => s.name === 'body')
    expect(nvBody).toBeDefined()
    expect(nvBody!.content.bindings[0]?.kind).toBe('conditional')
    const cond = nvBody!.content.bindings[0] as ConditionalBinding
    expect(cond.consequent.shape.html).toBe('<p>Yes</p>')
    expect(cond.alternate?.shape.html).toBe('<p>No</p>')
  })

  it('FE: html-tag slot content with expression hole produces TextBinding (html-tag has no conditional support)', () => {
    // html-tag does not support conditional in slot sub-IR — text binding is expected here.
    const html = createHtmlTag(doc)
    const show = true
    const ir = html`<Outer><slot name="body">${() => show}</slot></Outer>`
    void show
    const comp = ir.bindings.find((b) => b.kind === 'component') as ComponentBinding | undefined
    expect(comp).toBeDefined()
    const body = comp!.slots.find((s) => s.name === 'body')
    expect(body).toBeDefined()
    expect(body!.content.bindings[0]?.kind).toBe('text')
  })
})
