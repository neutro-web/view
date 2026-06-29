/**
 * Task 2 — itemReadsIndex predicate tests
 * Verifies that nv-parser correctly computes `itemReadsIndex` on ListBinding.
 */

import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import type { ListBinding } from '../../src/renderer/ir.js'
import { parseNvFile } from '../../src/renderer/nv-parser.js'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document

function parseList(renderBody: string): ListBinding {
  const source = `const C = $component(() => {
  $script(() => {
    const items = signal([])
  })
  $render(() => html\`${renderBody}\`)
})
`
  const results = parseNvFile(source, 'test.nv', document)
  expect(results.length).toBe(1)
  const listBinding = results[0]!.ir.bindings.find((b) => b.kind === 'list')
  expect(listBinding).toBeDefined()
  return listBinding as ListBinding
}

describe('itemReadsIndex predicate', () => {
  // TC-IRI-1: no index bound → false
  it('TC-IRI-1  <each let={item}> with no index binding → itemReadsIndex === false', () => {
    const lb = parseList(
      '<ul><each .of="${items}" key="${(item) => item.id}" let={item}><li>${item}</li></each></ul>',
    )
    expect(lb.itemReadsIndex).toBe(false)
  })

  // TC-IRI-2: index bound and read in body → true
  it('TC-IRI-2  <each let={item, index}> with ${index} in body → itemReadsIndex === true', () => {
    const lb = parseList(
      '<ul><each .of="${items}" key="${(item) => item.id}" let={item, index}><li>${index}</li></each></ul>',
    )
    expect(lb.itemReadsIndex).toBe(true)
  })

  // TC-IRI-3: index bound but not read in body → false
  it('TC-IRI-3  <each let={item, idx}> with idx unread in body → itemReadsIndex === false', () => {
    const lb = parseList(
      '<ul><each .of="${items}" key="${(item) => item.id}" let={item, idx}><li>${item}</li></each></ul>',
    )
    expect(lb.itemReadsIndex).toBe(false)
  })

  // TC-IRI-4: key uses index but body does not → false (key is not a body hole)
  it('TC-IRI-4  key="${(r,i)=>i}" with body not reading idx → itemReadsIndex === false', () => {
    const lb = parseList(
      '<ul><each .of="${items}" key="${(r, i) => i}" let={item, idx}><li>${item}</li></each></ul>',
    )
    expect(lb.itemReadsIndex).toBe(false)
  })

  // TC-IRI-5: body hole shadows idx but still references it → ACCEPT-biased → true
  it('TC-IRI-5  body hole with shadowed idx reference → itemReadsIndex === true (ACCEPT-biased)', () => {
    const lb = parseList(
      '<ul><each .of="${items}" key="${(item) => item.id}" let={item, idx}><li>${(() => { const idx = 5; return idx })()}</li></each></ul>',
    )
    expect(lb.itemReadsIndex).toBe(true)
  })
})
