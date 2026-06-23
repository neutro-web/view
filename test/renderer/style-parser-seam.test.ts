import { JSDOM } from 'jsdom'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import { parseNvFile } from '../../src/renderer/nv-parser.js'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const sharedDoc = dom.window.document as unknown as Document

// ── G1.B1: objExpr is a real ObjectLiteralExpression for both forms ───────────

describe('G1.B1  NvStyleInfo.objExpr is a real ObjectLiteralExpression', () => {
  test('object form: objExpr present', () => {
    const source = `
const C = $component(() => {
  $style({ color: 'red', fontSize: '12px' })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const style = results[0]?.style
    expect(style).not.toBeNull()
    expect(style?.form).toBe('object')
    expect(style?.objExpr).toBeDefined()
    expect(ts.isObjectLiteralExpression(style!.objExpr)).toBe(true)
    expect(style?.factory).toBeUndefined()
  })

  test('factory form: objExpr and factory both present', () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const x = signal(0)
  })
  $style(() => ({ color: 'red' }))
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const style = results[0]?.style
    expect(style).not.toBeNull()
    expect(style?.form).toBe('factory')
    expect(style?.objExpr).toBeDefined()
    expect(ts.isObjectLiteralExpression(style!.objExpr)).toBe(true)
    expect(style?.factory).toBeDefined()
    expect(ts.isArrowFunction(style!.factory!) || ts.isFunctionExpression(style!.factory!)).toBe(
      true,
    )
  })
})

// ── G1.B2: factory form parse wire intact ────────────────────────────────────

describe('G1.B2  factory form with signal: parse succeeds and objExpr is wired', () => {
  test('factory reading a signal: no throw, objExpr has one property with key "opacity"', () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const x = signal(0)
  })
  $style(() => ({ opacity: x }))
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const style = results[0]?.style
    expect(style).not.toBeNull()
    expect(style?.form).toBe('factory')
    expect(style?.objExpr).toBeDefined()
    expect(ts.isObjectLiteralExpression(style!.objExpr)).toBe(true)
    const props = style!.objExpr.properties.filter(ts.isPropertyAssignment)
    expect(props).toHaveLength(1)
    expect(ts.isIdentifier(props[0]!.name) && props[0]!.name.text).toBe('opacity')
    // eraseSignalReadsInNode is internal; S0 proof-of-wire is that parse completes
    // without throw and objExpr is a real node S1/S2 can erase against.
  })
})

// ── G1.B3: object form is not erased; still yields valid objExpr + keys ───────

describe('G1.B3  object form: not erased; objExpr and keys intact', () => {
  test('object form keys are extracted correctly', () => {
    const source = `
const C = $component(() => {
  $style({ color: 'red', 'font-size': '12px' })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const style = results[0]?.style
    expect(style?.form).toBe('object')
    expect(style?.keys).toContain('color')
    expect(style?.keys).toContain('font-size')
    expect(style?.objExpr).toBeDefined()
  })
})

// ── factory with non-bare-object body: extractStyleInfo returns null ──────────

describe('S0 safety: non-extractable factory body returns null style', () => {
  test('factory with block body (not bare object) → style is null', () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const x = signal(0)
  })
  $style(() => { return { color: 'red' } })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    // Block body is neither bare object nor parenthesized object — should return null
    expect(results[0]?.style).toBeNull()
  })
})
