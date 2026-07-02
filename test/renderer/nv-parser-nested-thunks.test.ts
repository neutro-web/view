import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
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
