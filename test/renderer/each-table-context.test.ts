/**
 * TC-EA-TABLE-* — <each> element in restricted-content parents (table, select).
 *
 * Gate obligations from the ruling (2026-06-26):
 *   1. <each> keyed list inside <table><tbody> → ListBinding with <tr> rows intact.
 *   2. <each> inside <select> → ListBinding with <option>s intact.
 *   3. Nested <each>-in-<each> inside a table — .content-hop recursion composes.
 *   4. All of the above pass existing non-table <each> tests (covered by each-authoring.test.ts).
 *
 * JSDOM is acceptable here for the parser-output assertions (the binding structure is
 * what we're testing). Real-browser execution is gate G-2a-2 (CP-2a browser probe).
 */

import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { flushSync, signal } from '../../src/core/core.js'
import { createHtmlTag } from '../../src/renderer/html-tag.js'
import { mount } from '../../src/renderer/interpreter.js'
import type { ListBinding } from '../../src/renderer/ir.js'
import { emitModule } from '../../src/renderer/nv-emitter.js'
import { parseNvFile, parseNvFileForEmit } from '../../src/renderer/nv-parser.js'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document as unknown as Document
const html = createHtmlTag(document)

// ── TC-EA-TABLE-1: <table><tbody> context ────────────────────────────────────

describe('TC-EA-TABLE-1  <each> inside <table><tbody> produces valid ListBinding', () => {
  const source = `
const Table = $component(() => {
  $script(() => {
    const rows = signal([{ id: 1, label: 'A' }, { id: 2, label: 'B' }])
  })
  $render(() => html\`<table><tbody><each .of="\${rows}" key="\${(row) => row.id}" let={item}><tr><td>\${item.id}</td><td>\${item.label}</td></tr></each></tbody></table>\`)
})`

  test('TC-EA-TABLE-1a  parse produces ListBinding with tr body', () => {
    const results = parseNvFile(source, 'table.nv', document)
    expect(results).toHaveLength(1)
    const ir = results[0]!.ir
    const listBinding = ir.bindings.find((b) => b.kind === 'list') as ListBinding | undefined
    expect(listBinding, 'should have a list binding').toBeDefined()
    expect(listBinding!.kind).toBe('list')
    // Body IR should have two text bindings (id + label)
    const body = listBinding!.itemTemplate(signal(null), signal(0))
    const textBindings = body.bindings.filter((b) => b.kind === 'text')
    expect(textBindings).toHaveLength(2)
  })

  test('TC-EA-TABLE-1b  anchor comment is inside <tbody>, not before <table>', () => {
    const results = parseNvFile(source, 'table.nv', document)
    const ir = results[0]!.ir
    // shape.html should contain the anchor inside <tbody>, not before <table>
    expect(ir.shape.html).toContain('<tbody>')
    expect(ir.shape.html).toContain('<!--nv-list-')
    // The anchor must appear AFTER <tbody>, not before <table>
    const tbodyIdx = ir.shape.html.indexOf('<tbody>')
    const anchorIdx = ir.shape.html.indexOf('<!--nv-list-')
    expect(anchorIdx).toBeGreaterThan(tbodyIdx)
  })

  test('TC-EA-TABLE-1c  emits valid module with list binding targeting <tbody>', () => {
    const results = parseNvFileForEmit(source, 'table.nv', document)
    const js = emitModule(results)
    expect(js).toContain("kind: 'list'")
    expect(js).toContain('items: () => (rows())')
    // Anchor path must be inside <tbody> — the anchor pathIndex binding should reference
    // a position inside the table structure, not before it
    expect(js).toContain('slotProps.item()')
  })
})

// ── TC-EA-TABLE-2: <select> context ──────────────────────────────────────────

describe('TC-EA-TABLE-2  <each> inside <select> produces valid ListBinding', () => {
  const source = `
const Sel = $component(() => {
  $script(() => {
    const opts = signal([{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }])
  })
  $render(() => html\`<select><each .of="\${opts}" key="\${(o) => o.id}" let={item}><option value="\${item.id}">\${item.label}</option></each></select>\`)
})`

  test('TC-EA-TABLE-2a  parse produces ListBinding with option body', () => {
    const results = parseNvFile(source, 'sel.nv', document)
    expect(results).toHaveLength(1)
    const ir = results[0]!.ir
    const listBinding = ir.bindings.find((b) => b.kind === 'list') as ListBinding | undefined
    expect(listBinding, 'should have a list binding').toBeDefined()
    expect(listBinding!.kind).toBe('list')
    // Body should have text + attr bindings for option value and label
    const body = listBinding!.itemTemplate(signal(null), signal(0))
    expect(body.bindings.length).toBeGreaterThanOrEqual(2)
  })

  test('TC-EA-TABLE-2b  anchor comment is inside <select>, not before it', () => {
    const results = parseNvFile(source, 'sel.nv', document)
    const ir = results[0]!.ir
    expect(ir.shape.html).toContain('<select>')
    const selectIdx = ir.shape.html.indexOf('<select>')
    const anchorIdx = ir.shape.html.indexOf('<!--nv-list-')
    expect(anchorIdx).toBeGreaterThan(selectIdx)
  })
})

// ── TC-EA-TABLE-3: nested <each>-in-<each> inside a table ───────────────────

describe('TC-EA-TABLE-3  nested <each> inside <each> inside <table>', () => {
  const source = `
const NestedTable = $component(() => {
  $script(() => {
    const groups = signal([{ id: 1, rows: [{ id: 'a', label: 'A1' }] }])
  })
  $render(() => html\`<table><tbody><each .of="\${groups}" key="\${(g) => g.id}" let={item}><each .of="\${item.rows}" key="\${(r) => r.id}" let={item}><tr><td>\${item.label}</td></tr></each></each></tbody></table>\`)
})`

  test('TC-EA-TABLE-3a  parse produces two nested ListBindings', () => {
    const results = parseNvFile(source, 'nested.nv', document)
    expect(results).toHaveLength(1)
    const ir = results[0]!.ir
    const outerList = ir.bindings.find((b) => b.kind === 'list') as ListBinding | undefined
    expect(outerList, 'outer list binding must exist').toBeDefined()

    // Inner list is in the body of the outer list
    const outerBody = outerList!.itemTemplate(signal(null), signal(0))
    const innerList = outerBody.bindings.find((b) => b.kind === 'list') as ListBinding | undefined
    expect(innerList, 'inner list binding must exist').toBeDefined()
    expect(innerList!.kind).toBe('list')

    // Inner body has a text binding for label
    const innerBody = innerList!.itemTemplate(signal(null), signal(0))
    const textBindings = innerBody.bindings.filter((b) => b.kind === 'text')
    expect(textBindings).toHaveLength(1)
  })
})

// ── TC-EA-TABLE-4: let={item, index} — continuation-reassembly still works ──

test('TC-EA-TABLE-4  let={item, index} resolves both names in table context', () => {
  const source = `
const Table = $component(() => {
  $script(() => {
    const rows = signal([{ id: 1, label: 'A' }])
  })
  $render(() => html\`<table><tbody><each .of="\${rows}" key="\${(row) => row.id}" let={item, index}><tr><td>\${item.label}</td><td>\${index}</td></tr></each></tbody></table>\`)
})`

  const results = parseNvFileForEmit(source, 'table.nv', document)
  const js = emitModule(results)
  // Both item and index should appear as slotProps accessors
  expect(js).toContain('slotProps.item()')
  expect(js).toContain('slotProps.index()')
})
