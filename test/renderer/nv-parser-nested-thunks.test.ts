import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { signal } from '../../src/core/core.js'
import type { ListBinding } from '../../src/renderer/ir.js'
import { emitModule } from '../../src/renderer/nv-emitter.js'
import { parseNvFile, parseNvFileForEmit } from '../../src/renderer/nv-parser.js'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document

describe('P2C-NEST-01  buildNvSlotContentIR nested-pending plumbing does not regress flat bodies', () => {
  test('a plain (non-nested) <each> body still parses and emits with one bodyThunk per hole', () => {
    const source = `
const List = $component(() => {
  $script(() => {
    const items = signal([{ id: 1, label: 'A' }])
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(i) => i.id}" let={item}><li>\${item.label}</li></each></ul>\`)
})`
    const results = parseNvFileForEmit(source, 'list.nv', document)
    const listThunk = results[0]!.emit!.bindingThunks.find((t) => t.kind === 'list')
    expect(listThunk).toBeDefined()
    expect(listThunk!.kind === 'list' && listThunk!.bodyThunks.length).toBe(1)
  })
})

describe('P2C-NEST-02  each-in-each thunk assembly (Mode-A emit path)', () => {
  test('nested <each> inside an <each> body produces a nested list ThunkSource, not a throw', () => {
    const source = `
const Grid = $component(() => {
  $script(() => {
    const rows = signal([{ id: 1, cells: [{ id: 10, v: 'a' }] }])
  })
  $render(() => html\`<div><each .of="\${rows}" key="\${(r) => r.id}" let={row}>
    <div><each .of="\${row.cells}" key="\${(c) => c.id}" let={cell}><span>\${cell.v}</span></each></div>
  </each></div>\`)
})`
    const results = parseNvFileForEmit(source, 'grid.nv', document)
    const outerList = results[0]!.emit!.bindingThunks.find((t) => t.kind === 'list')
    expect(outerList).toBeDefined()
    expect(outerList!.kind === 'list' && outerList!.bodyListThunks.length).toBe(1)
    const innerList = outerList!.kind === 'list' ? outerList!.bodyListThunks[0] : undefined
    expect(innerList?.kind).toBe('list')
  })
})

describe('P2C-NEST-03  <recycle> nested inside <each> body remains a loud parse-time error', () => {
  test('throws "[nv] <recycle> cannot be nested inside an <each> body"', () => {
    const source = `
const Grid = $component(() => {
  $script(() => {
    const rows = signal([{ id: 1, cells: [{ id: 10, v: 'a' }] }])
  })
  $render(() => html\`<div><each .of="\${rows}" key="\${(r) => r.id}" let={row}>
    <div><recycle .of="\${row.cells}" let={cell, i}><span>\${cell.v}</span></recycle></div>
  </each></div>\`)
})`
    expect(() => parseNvFileForEmit(source, 'grid.nv', document)).toThrow(
      '[nv] <recycle> cannot be nested inside an <each> body',
    )
  })
})

describe('P2C-NEST-06  nested structural child + sibling content in <each> body (mixed multi-root)', () => {
  test('<Row> followed by sibling text inside <each> parses and emits without throwing, synthetic-root-wraps to one element', () => {
    // Note: <Row> uses an explicit closing tag rather than self-closing
    // (`<Row ... />`) here. That is deliberate: HTML parsing does not treat
    // unknown/custom elements as void, so a trailing "/" on a non-void tag is
    // ignored by the HTML parser and any following siblings are parsed as
    // CHILDREN of <Row>, not as its siblings. Since component elements are
    // walked with "don't recurse into component children" (they're replaced
    // wholesale by an anchor comment), self-closing a component tag with
    // trailing siblings silently swallows those siblings — a pre-existing,
    // unrelated HTML-parsing gotcha independent of needsSyntheticRoot. Using
    // an explicit closing tag avoids that confound so this test exercises
    // needsSyntheticRoot's mixed hole + sibling-content case cleanly.
    const source = `
const Row = $component((props) => {
  $script(() => {
    const { label } = props
  })
  $render(() => html\`<span>\${label}</span>\`)
})
const List = $component(() => {
  $script(() => {
    const items = signal([{ id: 1, label: 'Alpha' }])
  })
  $render(() => html\`<ul><each .of="\${items}" key="\${(i) => i.id}" let={item}><Row label="\${item.label}"></Row> some text</each></ul>\`)
})`
    // Emit-path assertion (catches emit-level regressions).
    const emitResults = parseNvFileForEmit(source, 'mixed.nv', document)
    const listResult = emitResults.find((r) => r.name === 'List')!
    const listThunk = listResult.emit!.bindingThunks.find((t) => t.kind === 'list')
    expect(listThunk).toBeDefined()
    expect(() => emitModule(emitResults)).not.toThrow()

    // Parse-path structural assertion: needsSyntheticRoot must have kicked in
    // because the body has 2 top-level nodes (the <Row/> anchor comment + the
    // sibling text node) — so the per-item shape.html must be wrapped in
    // exactly one synthetic root element containing both children.
    const parseResults = parseNvFile(source, 'mixed.nv', document)
    const list = parseResults.find((r) => r.name === 'List')!
    const listBinding = list.ir.bindings.find((b) => b.kind === 'list') as ListBinding
    expect(listBinding).toBeDefined()
    const itemIR = listBinding.itemTemplate(signal<unknown>(null), signal<number>(0))
    const frag = dom.window.document.createElement('template')
    frag.innerHTML = itemIR.shape.html
    // Exactly one top-level root DOM node (the synthetic wrapper), which
    // itself contains at least two children: the component anchor comment
    // and the sibling text.
    expect(frag.content.childNodes.length).toBe(1)
    const root = frag.content.firstChild as Element
    expect(root.nodeType).toBe(1) // ELEMENT_NODE — the synthetic root
    expect(root.childNodes.length).toBeGreaterThanOrEqual(2)
    const hasAnchorComment = Array.from(root.childNodes).some(
      (n) => n.nodeType === 8 && (n.textContent ?? '').includes('nv-comp'),
    )
    const hasSiblingText = Array.from(root.childNodes).some(
      (n) => n.nodeType === 3 && (n.textContent ?? '').includes('some text'),
    )
    expect(hasAnchorComment).toBe(true)
    expect(hasSiblingText).toBe(true)
  })

  test('text followed by nested <each> as sibling inside outer <each> body parses and emits without throwing', () => {
    const source = `
const Grid = $component(() => {
  $script(() => {
    const rows = signal([{ id: 1, cells: [{ id: 10, v: 'a' }] }])
  })
  $render(() => html\`<div><each .of="\${rows}" key="\${(r) => r.id}" let={row}>label: <each .of="\${row.cells}" key="\${(c) => c.id}" let={cell}><span>\${cell.v}</span></each></each></div>\`)
})`
    const results = parseNvFileForEmit(source, 'grid-mixed.nv', document)
    const outerList = results[0]!.emit!.bindingThunks.find((t) => t.kind === 'list')
    expect(outerList).toBeDefined()
    expect(outerList!.kind === 'list' && outerList!.bodyListThunks.length).toBe(1)
    expect(() => emitModule(results)).not.toThrow()
  })
})

describe('P2C-NEST-04  all nesting-matrix fixtures parse and emit without throwing', () => {
  const fixturesDir = join(__dirname, '../browser/fixtures/nested-structural')
  test.each([
    'component-in-each',
    'each-in-each',
    'switch-in-each',
    'each-in-switch-branch',
    'component-in-switch-fallback',
    'switch-in-each-in-switch',
    'each-in-recycle',
  ])('%s', (name) => {
    const source = readFileSync(join(fixturesDir, `${name}.nv`), 'utf8')
    expect(() => parseNvFileForEmit(source, `${name}.nv`, document)).not.toThrow()
  })
})

describe('P2C-NEST-05  all nesting-matrix fixtures emit real Mode-A module source (emitModule, not just parse)', () => {
  const fixturesDir = join(__dirname, '../browser/fixtures/nested-structural')
  test.each([
    'component-in-each',
    'each-in-each',
    'switch-in-each',
    'each-in-switch-branch',
    'component-in-switch-fallback',
    'switch-in-each-in-switch',
    'each-in-recycle',
  ])('%s', (name) => {
    const source = readFileSync(join(fixturesDir, `${name}.nv`), 'utf8')
    const results = parseNvFileForEmit(source, `${name}.nv`, document)
    expect(() => emitModule(results)).not.toThrow()
  })
})
