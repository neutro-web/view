/**
 * Unit tests for cx() pure class-string builder helper
 */

import { describe, expect, it } from 'vitest'
import { cx } from '../../src/renderer/html-tag.js'

describe('cx', () => {
  it('should return empty string for no args', () => {
    expect(cx()).toBe('')
  })

  it('should join multiple string args', () => {
    expect(cx('a', 'b')).toBe('a b')
  })

  it('should skip falsy args (null, undefined, false, 0, empty string)', () => {
    expect(cx('a', false, null, undefined, '', 0)).toBe('a')
  })

  it('should include object keys with truthy values', () => {
    expect(cx({ active: true, disabled: false })).toBe('active')
  })

  it('should combine strings and objects', () => {
    expect(cx('btn', { primary: true })).toBe('btn primary')
  })

  it('should flatten array args', () => {
    expect(cx(['a', 'b'])).toBe('a b')
  })

  it('should deeply flatten nested arrays and objects', () => {
    expect(cx('a', ['b', { c: true }])).toBe('a b c')
  })

  it('should skip falsy values in objects', () => {
    expect(cx({ a: 1, b: 0, c: '' })).toBe('a')
  })

  it('should handle mixed truthy/falsy strings', () => {
    expect(cx('a', '', 'b', null, 'c')).toBe('a b c')
  })

  it('should handle empty arrays', () => {
    expect(cx('a', [])).toBe('a')
  })

  it('should handle nested empty arrays', () => {
    expect(cx('a', [[], 'b'])).toBe('a b')
  })

  it('should handle object with all falsy values', () => {
    expect(cx({ a: false, b: 0, c: null })).toBe('')
  })

  it('should handle complex nested structure', () => {
    expect(cx('btn', ['base', { primary: true, disabled: false }], { size: 'lg' })).toBe(
      'btn base primary size',
    )
  })

  it('should skip numeric falsy values (0 and NaN/etc)', () => {
    expect(cx('a', 0, 'b')).toBe('a b')
  })

  it('should include numeric truthy values in object keys', () => {
    // Objects only have string keys, so this tests that truthy non-zero numbers work
    expect(cx({ active: 1, disabled: 2 })).toBe('active disabled')
  })
})
