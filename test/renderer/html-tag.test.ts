import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createHtmlTag } from '../../src/renderer/html-tag.js'
import type { EventBinding, PropBinding } from '../../src/renderer/ir.js'

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
