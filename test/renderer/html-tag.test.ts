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
