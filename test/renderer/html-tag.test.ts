import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { signal } from '../../src/core/core.js'
import { createHtmlTag, iff } from '../../src/renderer/html-tag.js'
import type {
  ConditionalBinding,
  EventBinding,
  PropBinding,
  SyncBinding,
} from '../../src/renderer/ir.js'
import { parseNvFile } from '../../src/renderer/nv-parser.js'
import { irStructurallyEqual } from './ir-equivalence.js'

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>')
  const doc = dom.window.document
  const html = createHtmlTag(doc)
  return { doc, html }
}

describe('html-tag — text hole', () => {
  it('text-position hole produces TextBinding', () => {
    const { html } = setup()
    const ir = html`<div>${() => 42}</div>`
    expect(ir.bindings[0]?.kind).toBe('text')
  })
})

describe('html-tag — attr hole', () => {
  it('attr hole produces AttrBinding', () => {
    const { html } = setup()
    const ir = html`<span class="${() => 'foo'}"></span>`
    expect(ir.bindings[0]?.kind).toBe('attr')
    expect((ir.bindings[0] as { kind: string; name: string }).name).toBe('class')
  })
})

describe('html-tag — event hole (@eventName syntax)', () => {
  it('produces EventBinding for @click hole', () => {
    const { html } = setup()
    const handler = () => {}
    const ir = html`<button @click="${() => handler}">x</button>`
    expect(ir.bindings[0]?.kind).toBe('event')
    expect((ir.bindings[0] as EventBinding).eventName).toBe('click')
  })
})

describe('html-tag — prop hole (.propName syntax)', () => {
  it('produces PropBinding for .value hole', () => {
    const { html } = setup()
    const ir = html`<input .value="${() => 'hello'}" />`
    expect(ir.bindings[0]?.kind).toBe('prop')
    expect((ir.bindings[0] as PropBinding).name).toBe('value')
  })
})

describe('html-tag — component element detection (TC-C01-html)', () => {
  it('TC-C01-html: <Counter count="${() => n}"/> → ComponentBinding with propNames', () => {
    const { html } = setup()
    const n = 42
    const ir = html`<Counter count="${() => n}"></Counter>`
    const compBinding = ir.bindings.find((b) => b.kind === 'component')
    expect(compBinding).toBeDefined()
    expect(compBinding?.kind).toBe('component')
    // biome-ignore lint/suspicious/noExplicitAny: test cast
    const cb = compBinding as any
    expect(cb.propNames).toContain('count')
    expect(cb.props[0]?.name).toBe('count')
  })

  it('TC-C01-html: static-only component element → ComponentBinding with static prop', () => {
    const { html } = setup()
    const ir = html`<Counter label="Hits"></Counter>`
    const compBinding = ir.bindings.find((b) => b.kind === 'component')
    expect(compBinding).toBeDefined()
    // biome-ignore lint/suspicious/noExplicitAny: test cast
    const cb = compBinding as any
    expect(cb.propNames).toContain('label')
  })
})

// ── Sync directive ─────────────────────────────────────────────────────────────

describe('html tag :PROP sync directive', () => {
  it('classifyHole: :value= hole is classified as sync', () => {
    const { html } = setup()
    const val = signal('')
    const ir = html`<input :value="${val}" />`
    expect(ir.bindings[0]?.kind).toBe('sync')
  })

  it('buildHtmlHoleBinding sync: propName from sigil', () => {
    const { html } = setup()
    const val = signal('hello')
    const ir = html`<input :value="${val}" />`
    const b = ir.bindings[0] as SyncBinding
    expect(b.propName).toBe('value')
    expect(b.eventName).toBe('input')
  })

  it('buildHtmlHoleBinding sync: readExpr reads accessor, writeTarget IS accessor', () => {
    const { html } = setup()
    const val = signal('hello')
    const ir = html`<input :value="${val}" />`
    const b = ir.bindings[0] as SyncBinding
    // readExpr() reads the current signal value
    expect(b.readExpr()).toBe('hello')
    // writeTarget is the accessor itself — set() must work
    ;(b.writeTarget as typeof val).set('world')
    expect(val()).toBe('world')
  })

  it('classifyHole: :checked= uses change event', () => {
    const { html } = setup()
    const checked = signal(false)
    const ir = html`<input type="checkbox" :checked="${checked}" />`
    const b = ir.bindings[0] as SyncBinding
    expect(b.propName).toBe('checked')
    expect(b.eventName).toBe('change')
  })

  it('classifyHole: :value is not classified as attr (sigil priority)', () => {
    const { html } = setup()
    const val = signal('')
    const ir = html`<input :value="${val}" />`
    // Must NOT fall through to attr binding
    expect(ir.bindings[0]?.kind).not.toBe('attr')
  })
})

describe('html-tag — iff() conditional sentinel', () => {
  it('iff() produces a ConditionalBinding (kind check)', () => {
    const { html } = setup()
    const show = signal(true)
    const ir = html`<div>${iff(
      () => show(),
      () => html`<span>A</span>`,
      () => html`<span>B</span>`,
    )}</div>`
    expect(ir.bindings.length).toBe(1)
    expect(ir.bindings[0]!.kind).toBe('conditional')
    const b = ir.bindings[0] as ConditionalBinding
    expect(b.consequent.shape.html).toBe('<span>A</span>')
    expect(b.alternate?.shape.html).toBe('<span>B</span>')
  })

  it('iff() with omitted alternate sets alternate: null', () => {
    const { html } = setup()
    const show = signal(true)
    const ir = html`<div>${iff(
      () => show(),
      () => html`<span>A</span>`,
    )}</div>`
    const b = ir.bindings[0] as ConditionalBinding
    expect(b.alternate).toBe(null)
  })

  // G1 gate: iff() and the equivalent .nv ternary must produce bindingEqual-identical
  // ConditionalBindings (via the shared irStructurallyEqual oracle).
  it('G1  FE-equivalence: iff() and .nv ternary produce irStructurallyEqual ConditionalBinding', () => {
    const { doc, html } = setup()

    // Tagged-template version
    const show = signal(true)
    const ttIr = html`<div>${iff(
      () => show(),
      () => html`<span>A</span>`,
      () => html`<span>B</span>`,
    )}</div>`

    // .nv version (parse path)
    const source =
      'const C = $component(() => {\n' +
      '  $script(() => { const show = signal(true) })\n' +
      '  $render(() => html`<div>${show ? html`<span>A</span>` : html`<span>B</span>`}</div>`)\n' +
      '})\n'
    const results = parseNvFile(source, 'cond.nv', doc)
    const nvIr = results[0]!.ir

    const result = irStructurallyEqual(doc, ttIr, nvIr)
    expect(result.equal, result.reason).toBe(true)
  })
})
