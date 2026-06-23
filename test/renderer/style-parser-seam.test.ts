/**
 * style-parser-seam.test.ts
 * F1 / S0 parser-seam: NvStyleInfo node retention + factory erasure gate.
 * Tests: G1.B1, G1.B2, G1.B3
 * Parse/structural only — no mount, no emission.
 */

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

// ── G1.B2: factory-form property reading a $script signal yields erased text ──

describe('G1.B2  factory form: signal reads in property initializers are erased', () => {
  test('initializer "x" (bare read of signal) — objExpr is wired, no throw', () => {
    // The factory reads signal `x`; after extractStyleInfo, the objExpr property
    // initializer is present. eraseSignalReadsInNode returns erased text without
    // mutating the AST, so S0's proof-of-wire is that parseNvFile does NOT throw
    // and yields a valid objExpr with the expected property.
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
    // Confirm the property initializer is present in objExpr
    const props = style!.objExpr.properties.filter(ts.isPropertyAssignment)
    expect(props).toHaveLength(1)
    expect(ts.isIdentifier(props[0]!.initializer)).toBe(true)
    // source field is captured
    expect(style?.source).toMatch(/opacity/)
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
