import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { emitModule } from '../../src/renderer/nv-emitter.js'
import { parseNvFileForEmit } from '../../src/renderer/nv-parser.js'

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

describe('P2C-NEST-04  all nesting-matrix fixtures parse and emit without throwing', () => {
  const fixturesDir = join(__dirname, '../browser/fixtures/nested-structural')
  test.each([
    'component-in-each',
    'each-in-each',
    'switch-in-each',
    'each-in-switch-branch',
    'component-in-switch-fallback',
    'switch-in-each-in-switch',
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
  ])('%s', (name) => {
    const source = readFileSync(join(fixturesDir, `${name}.nv`), 'utf8')
    const results = parseNvFileForEmit(source, `${name}.nv`, document)
    expect(() => emitModule(results)).not.toThrow()
  })
})
