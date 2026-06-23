import { describe, expect, it } from 'vitest'
import { KNOWN_ELEMENT_TAGS, classifyStyleKey } from '../../src/renderer/style-classify.js'

describe('classifyStyleKey', () => {
  it('single class token', () => {
    expect(classifyStyleKey('card')).toEqual({ form: 'class', tokens: ['card'] })
  })

  it('multiple class tokens', () => {
    expect(classifyStyleKey('card active')).toEqual({ form: 'class', tokens: ['card', 'active'] })
  })

  it('tag name → selector', () => {
    expect(classifyStyleKey('button')).toEqual({ form: 'selector' })
  })

  it('sigil . → selector', () => {
    expect(classifyStyleKey('.x')).toEqual({ form: 'selector' })
  })

  it('attribute selector → selector', () => {
    expect(classifyStyleKey('[x]')).toEqual({ form: 'selector' })
  })

  it('& pseudo → selector', () => {
    expect(classifyStyleKey('&:hover')).toEqual({ form: 'selector' })
  })

  it('combinator > → selector', () => {
    expect(classifyStyleKey('a>b')).toEqual({ form: 'selector' })
  })

  it(':is() → selector', () => {
    expect(classifyStyleKey(':is(p)')).toEqual({ form: 'selector' })
  })

  it('tag token in multi-token key → selector', () => {
    expect(classifyStyleKey('button card')).toEqual({ form: 'selector' })
  })

  it('starts with digit → selector', () => {
    expect(classifyStyleKey('2col')).toEqual({ form: 'selector' })
  })

  it('leading hyphen valid CSS ident → class', () => {
    expect(classifyStyleKey('-x')).toEqual({ form: 'class', tokens: ['-x'] })
  })

  it('leading underscore → class', () => {
    expect(classifyStyleKey('_x')).toEqual({ form: 'class', tokens: ['_x'] })
  })

  it('hyphen within token → class (G1.7)', () => {
    expect(classifyStyleKey('card-item')).toEqual({ form: 'class', tokens: ['card-item'] })
  })
})

describe('KNOWN_ELEMENT_TAGS', () => {
  it('contains button', () => {
    expect(KNOWN_ELEMENT_TAGS.has('button')).toBe(true)
  })

  it('contains div', () => {
    expect(KNOWN_ELEMENT_TAGS.has('div')).toBe(true)
  })

  it('does not contain nvcustom', () => {
    expect(KNOWN_ELEMENT_TAGS.has('nvcustom')).toBe(false)
  })
})
