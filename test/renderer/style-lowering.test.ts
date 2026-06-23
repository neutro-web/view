import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { flushSync, signal } from '../../src/core/core.js'
import { mount } from '../../src/renderer/interpreter.js'
import type { StyleVarBinding, TemplateIR } from '../../src/renderer/ir.js'
import { parseNvFile } from '../../src/renderer/nv-parser.js'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const sharedDoc = dom.window.document as unknown as Document

// ── G3.static: static values remain in staticCss, no varBindingDescs ─────────

describe('G3.static  static style values stay in CSS, not lowered to CSS vars', () => {
  test('object form: static string value → staticCss only, varBindingDescs empty', () => {
    const source = `
const C = $component(() => {
  $style({ card: { color: 'red' } })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const ir = results[0]?.ir
    expect(ir?.styleArtifact?.staticCss).toContain('color: red')
    expect(ir?.styleArtifact?.varBindingDescs?.length ?? 0).toBe(0)
    // no StyleVarBinding in bindings
    const svbs = ir?.bindings.filter((b) => b.kind === 'style-var') ?? []
    expect(svbs).toHaveLength(0)
  })

  test('selector form: static declaration stays in staticCss', () => {
    const source = `
const C = $component(() => {
  $style({ button: { fontSize: '14px' } })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const ir = results[0]?.ir
    expect(ir?.styleArtifact?.staticCss).toContain('font-size: 14px')
    expect(ir?.styleArtifact?.varBindingDescs?.length ?? 0).toBe(0)
  })
})

// ── G3.dynamic: reactive values lowered to CSS vars ──────────────────────────

describe('G3.dynamic  reactive style values are lowered to CSS custom properties', () => {
  test('single reactive value: varBindingDescs has one entry', () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const color = signal('red')
  })
  $style({ card: { color: color } })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const ir = results[0]?.ir
    const descs = ir?.styleArtifact?.varBindingDescs ?? []
    expect(descs).toHaveLength(1)
    expect(descs[0]?.varName).toMatch(/^--nv-[0-9a-f]+$/)
    expect(descs[0]?.propertyName).toBe('color')
    expect(descs[0]?.exprSrc).toContain('color()')
  })

  test('reactive value: staticCss contains var() reference instead of raw expression', () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const bg = signal('blue')
  })
  $style({ card: { backgroundColor: bg } })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const ir = results[0]?.ir
    const varName = ir?.styleArtifact?.varBindingDescs?.[0]?.varName
    expect(varName).toBeDefined()
    expect(ir?.styleArtifact?.staticCss).toContain(`var(${varName})`)
    // raw signal name must not appear in staticCss
    expect(ir?.styleArtifact?.staticCss).not.toContain('bg')
  })

  test('StyleVarBinding entry added to ir.bindings', () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const color = signal('red')
  })
  $style({ card: { color: color } })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const ir = results[0]?.ir
    const svbs = (ir?.bindings ?? []).filter((b): b is StyleVarBinding => b.kind === 'style-var')
    expect(svbs).toHaveLength(1)
    expect(svbs[0]?.varName).toMatch(/^--nv-[0-9a-f]+$/)
  })

  test('two reactive properties on same selector → two varBindingDescs with distinct varNames', () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const fg = signal('red')
    const bg = signal('blue')
  })
  $style({ card: { color: fg, backgroundColor: bg } })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const ir = results[0]?.ir
    const descs = ir?.styleArtifact?.varBindingDescs ?? []
    expect(descs).toHaveLength(2)
    expect(descs[0]?.varName).not.toBe(descs[1]?.varName)
    const svbs = (ir?.bindings ?? []).filter((b) => b.kind === 'style-var')
    expect(svbs).toHaveLength(2)
  })

  test('mixed static/reactive: static stays in CSS, reactive gets var()', () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const color = signal('red')
  })
  $style({ card: { color: color, fontWeight: 'bold' } })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const ir = results[0]?.ir
    const descs = ir?.styleArtifact?.varBindingDescs ?? []
    expect(descs).toHaveLength(1)
    expect(descs[0]?.propertyName).toBe('color')
    expect(ir?.styleArtifact?.staticCss).toContain('font-weight: bold')
  })
})

// ── G3.wire: wireStyleVar updates element.style ───────────────────────────────

describe('G3.wire  StyleVarBinding wires setProperty / removeProperty reactively', () => {
  test('initial value set on element style', () => {
    const colorSig = signal('red')
    const ir: TemplateIR = {
      id: 'test-style-var-initial',
      shape: { html: '<div></div>', bindingPaths: [[0]] },
      bindings: [
        { kind: 'style-var', pathIndex: 0, varName: '--nv-color', expr: () => colorSig() },
      ],
    }
    const parent = sharedDoc.createElement('div')
    sharedDoc.body.appendChild(parent)
    const dispose = mount(ir, parent, sharedDoc)
    flushSync()
    const el = parent.querySelector('div') as HTMLElement
    expect(el.style.getPropertyValue('--nv-color')).toBe('red')
    dispose()
    sharedDoc.body.removeChild(parent)
  })

  test('signal update propagates to style property', () => {
    const colorSig = signal('red')
    const ir: TemplateIR = {
      id: 'test-style-var-update',
      shape: { html: '<div></div>', bindingPaths: [[0]] },
      bindings: [
        { kind: 'style-var', pathIndex: 0, varName: '--nv-color', expr: () => colorSig() },
      ],
    }
    const parent = sharedDoc.createElement('div')
    sharedDoc.body.appendChild(parent)
    const dispose = mount(ir, parent, sharedDoc)
    flushSync()
    colorSig.set('blue')
    flushSync()
    const el = parent.querySelector('div') as HTMLElement
    expect(el.style.getPropertyValue('--nv-color')).toBe('blue')
    dispose()
    sharedDoc.body.removeChild(parent)
  })

  test('null value removes the property', () => {
    const colorSig = signal<string | null>('red')
    const ir: TemplateIR = {
      id: 'test-style-var-null',
      shape: { html: '<div></div>', bindingPaths: [[0]] },
      bindings: [
        { kind: 'style-var', pathIndex: 0, varName: '--nv-color', expr: () => colorSig() },
      ],
    }
    const parent = sharedDoc.createElement('div')
    sharedDoc.body.appendChild(parent)
    const dispose = mount(ir, parent, sharedDoc)
    flushSync()
    colorSig.set(null)
    flushSync()
    const el = parent.querySelector('div') as HTMLElement
    expect(el.style.getPropertyValue('--nv-color')).toBe('')
    dispose()
    sharedDoc.body.removeChild(parent)
  })

  test('dispose stops updates — setProperty not called after disposal', () => {
    const colorSig = signal('red')
    const calls: string[] = []
    const ir: TemplateIR = {
      id: 'test-style-var-dispose',
      shape: { html: '<div></div>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'style-var',
          pathIndex: 0,
          varName: '--nv-color',
          expr: () => {
            calls.push(colorSig())
            return colorSig()
          },
        },
      ],
    }
    const parent = sharedDoc.createElement('div')
    sharedDoc.body.appendChild(parent)
    const dispose = mount(ir, parent, sharedDoc)
    flushSync()
    const countBefore = calls.length
    dispose()
    colorSig.set('blue')
    flushSync()
    expect(calls.length).toBe(countBefore) // no additional calls after dispose
    sharedDoc.body.removeChild(parent)
  })
})

// ── G4.unit: classRewrites map ────────────────────────────────────────────────

describe('G4.unit  classRewrites built from buildStyleArtifact via parseNvFile', () => {
  test('class-form key populates classRewrites', () => {
    const source = `
const C = $component(() => {
  $style({ card: 'color: red' })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const ir = results[0]?.ir
    expect(ir?.classRewrites).toBeDefined()
    const hash = ir?.styleArtifact?.scopeHash
    expect(ir?.classRewrites?.get('card')).toBe(`card_${hash}`)
  })

  test('selector-form key does NOT populate classRewrites', () => {
    const source = `
const C = $component(() => {
  $style({ button: 'padding: 0' })
  $render(() => html\`<div></div>\`)
})`
    const results = parseNvFile(source, 'c.nv', sharedDoc)
    const ir = results[0]?.ir
    expect(ir?.classRewrites?.size ?? 0).toBe(0)
  })
})
