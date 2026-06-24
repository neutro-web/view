/**
 * nv-parser sync directive tests
 * Covers: classifyPosition ':' matching, ThunkSource 'sync' shape,
 * and error diagnostic for non-enumerable bind targets.
 */
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { parseNvFileForEmit } from '../../src/renderer/nv-parser.js'

const dom = new JSDOM('<!DOCTYPE html>')
const doc = dom.window.document as unknown as Document

describe('nv-parser :PROP sync directive', () => {
  it('produces sync ThunkSource for :value hole', () => {
    const src = [
      'export const Foo = $component(() => {',
      '  $script(() => {',
      '    const val = signal("")',
      '  })',
      '  $render(() => html`<input :value="${val}" />`)',
      '})',
    ].join('\n')
    const results = parseNvFileForEmit(src, 'Foo.nv', doc)
    const thunk = results[0]?.emit?.bindingThunks[0]
    expect(thunk).toMatchObject({
      kind: 'sync',
      writeTargetSrc: 'val',
      eventName: 'input',
    })
    // readExprSrc must contain the erased read (val())
    expect((thunk as { readExprSrc: string }).readExprSrc).toContain('val()')
  })

  it('uses change event and correct writeTargetSrc for :checked', () => {
    const src = [
      'export const Foo = $component(() => {',
      '  $script(() => {',
      '    const checked = signal(false)',
      '  })',
      '  $render(() => html`<input type="checkbox" :checked="${checked}" />`)',
      '})',
    ].join('\n')
    const results = parseNvFileForEmit(src, 'Foo.nv', doc)
    const thunk = results[0]?.emit?.bindingThunks[0]
    expect(thunk).toMatchObject({
      kind: 'sync',
      writeTargetSrc: 'checked',
      eventName: 'change',
    })
  })

  it('writeTargetSrc is the bare identifier, readExprSrc is erased (asymmetry)', () => {
    const src = [
      'export const Foo = $component(() => {',
      '  $script(() => {',
      '    const val = signal("")',
      '  })',
      '  $render(() => html`<input :value="${val}" />`)',
      '})',
    ].join('\n')
    const results = parseNvFileForEmit(src, 'Foo.nv', doc)
    const thunk = results[0]?.emit?.bindingThunks[0] as {
      kind: string; readExprSrc: string; writeTargetSrc: string
    }
    expect(thunk.writeTargetSrc).toBe('val')          // bare — NOT erased
    expect(thunk.readExprSrc).toContain('val()')      // erased read
    expect(thunk.writeTargetSrc).not.toContain('()')  // must not be val()
  })

  it('emits error diagnostic for non-identifier bind target (method call)', () => {
    const src = [
      'export const Foo = $component(() => {',
      '  $script(() => {',
      '    const m = signal(new Map())',
      '  })',
      '  $render(() => html`<input :value="${m().get(\'k\')}" />`)',
      '})',
    ].join('\n')
    const results = parseNvFileForEmit(src, 'Foo.nv', doc)
    const errorDiags = (results[0]?.diagnostics ?? []).filter((d) => d.kind === 'error')
    expect(errorDiags.length).toBeGreaterThan(0)
    expect(errorDiags[0]!.message).toMatch(/sync|bind|enumerable|accessor/i)
  })
})
