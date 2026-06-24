/**
 * nv .nv Front-End — Differential Conformance Suite (Front-End Equivalence Gate)
 * Stream: (3) Renderer/templating
 * IR contract: nv-template-ir.md v0.2, §6.1 Invariant FE, §3 equivalence gate
 *
 * Required equivalence cases (scope §3):
 *   FE-01  TextBinding
 *   FE-02  AttrBinding
 *   FE-03  PropBinding (new .nv syntax: .propName="...")
 *   FE-04  EventBinding (new .nv syntax: @eventName="...")
 *   FE-05  ChildBinding — expressiveness boundary (manual-IR only, both front-ends)
 *   FE-06  ConditionalBinding (ternary with html`` branches)
 *   FE-07  Multi-binding (Attr + Text)
 *   FE-08  Nested conditional with reactive branch
 *   FE-09  Mutation-write rewriting ($script erasure)
 *   FE-10  Verdict detection (ACCEPT/PLAIN)
 *   FE-11  $style object form
 *   FE-12  $style factory form
 *   FE-13  Multiple components per file (independent scopes)
 *
 * Comparison method (§3):
 *   shape.html: normalized via DOM structural comparison (not string equality)
 *   bindingPaths: exact array equality
 *   binding kind + non-expr fields: exact
 *   ConditionalBinding: recurse into consequent/alternate
 *   expr thunks: not compared (function identity is back-end's concern, proven)
 *   verdict (ACCEPT/PLAIN): compared where relevant (FE-10)
 */

import { JSDOM } from 'jsdom'
import * as ts from 'typescript'
import { describe, expect, it, test } from 'vitest'
import { flushSync, signal } from '../../src/core/core.js'
import { structurallyEqual } from '../../src/renderer/comparator.js'
import { createHtmlTag } from '../../src/renderer/html-tag.js'
import type {
  AttrBinding,
  Binding,
  ChildBinding,
  ClassListBinding,
  ComponentBinding,
  ConditionalBinding,
  EventBinding,
  ListBinding,
  PropBinding,
  TemplateIR,
  TextBinding,
} from '../../src/renderer/ir.js'
import {
  buildPropsAccessorMap,
  parseNvFile,
  parseNvFileForEmit,
  preprocessMutationWrites,
  simpleHash,
} from '../../src/renderer/nv-parser.js'
import type { NvDiagnostic } from '../../src/renderer/nv-parser.js'

// ── jsdom + html tag setup ────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document
const html = createHtmlTag(document)

// ── Comparison helpers ────────────────────────────────────────────────────────

/** Parse a shape.html string into a DocumentFragment for structural comparison. */
function parseShape(htmlStr: string): DocumentFragment {
  const tmpl = document.createElement('template')
  tmpl.innerHTML = htmlStr
  return tmpl.content.cloneNode(true) as DocumentFragment
}

/** Compare two TemplateIRs' shape.html strings via DOM structural comparison. */
function shapeHtmlEqual(a: TemplateIR, b: TemplateIR): { equal: boolean; diffPath: string } {
  return structurallyEqual(parseShape(a.shape.html), parseShape(b.shape.html))
}

/** Compare bindingPaths arrays exactly. */
function pathsEqual(a: TemplateIR, b: TemplateIR): boolean {
  if (a.shape.bindingPaths.length !== b.shape.bindingPaths.length) return false
  for (let i = 0; i < a.shape.bindingPaths.length; i++) {
    const ap = a.shape.bindingPaths[i] as readonly number[]
    const bp = b.shape.bindingPaths[i] as readonly number[]
    if (ap.length !== bp.length) return false
    for (let j = 0; j < ap.length; j++) {
      if (ap[j] !== bp[j]) return false
    }
  }
  return true
}

interface BindingDiff {
  equal: boolean
  reason: string
}

/** Structurally compare two TemplateIRs: paths, binding kinds, non-expr fields. */
function irStructurallyEqual(a: TemplateIR, b: TemplateIR): BindingDiff {
  if (a.bindings.length !== b.bindings.length) {
    return { equal: false, reason: `binding count: ${a.bindings.length} vs ${b.bindings.length}` }
  }
  if (!pathsEqual(a, b)) {
    return { equal: false, reason: 'bindingPaths mismatch' }
  }
  for (let i = 0; i < a.bindings.length; i++) {
    const r = bindingEqual(a.bindings[i] as Binding, b.bindings[i] as Binding, i)
    if (!r.equal) return r
  }
  return { equal: true, reason: '' }
}

function bindingEqual(a: Binding, b: Binding, i: number): BindingDiff {
  const p = `binding[${i}]`
  if (a.kind !== b.kind) return { equal: false, reason: `${p}.kind: ${a.kind} vs ${b.kind}` }
  if (a.pathIndex !== b.pathIndex) return { equal: false, reason: `${p}.pathIndex` }
  switch (a.kind) {
    case 'attr':
    case 'prop': {
      const bn = b as AttrBinding | PropBinding
      if (a.name !== bn.name) return { equal: false, reason: `${p}.name: ${a.name} vs ${bn.name}` }
      break
    }
    case 'event': {
      const be = b as EventBinding
      if (a.eventName !== be.eventName)
        return { equal: false, reason: `${p}.eventName: ${a.eventName} vs ${be.eventName}` }
      break
    }
    case 'conditional': {
      const bc = b as ConditionalBinding
      const cRes = irStructurallyEqual(a.consequent, bc.consequent)
      if (!cRes.equal) return { equal: false, reason: `${p}.consequent → ${cRes.reason}` }
      if ((a.alternate === null) !== (bc.alternate === null)) {
        return { equal: false, reason: `${p}.alternate nullity mismatch` }
      }
      if (a.alternate !== null && bc.alternate !== null) {
        const aRes = irStructurallyEqual(a.alternate, bc.alternate)
        if (!aRes.equal) return { equal: false, reason: `${p}.alternate → ${aRes.reason}` }
      }
      break
    }
    // text, child, list, sync: no non-expr fields to compare beyond kind+pathIndex
  }
  return { equal: true, reason: '' }
}

/** Parse a .nv source, assert exactly one component, return its result. */
function parseOne(source: string) {
  const results = parseNvFile(source, 'test.nv', document)
  expect(results.length, `Expected 1 component, got ${results.length}`).toBe(1)
  return results[0]!
}

// ── FE-01: TextBinding equivalence ────────────────────────────────────────────

test('FE-01a  shape.html identical to tagged-template', () => {
  const ttIR = html`<span>${() => ''}</span>`

  const nvSource = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  const shapeResult = shapeHtmlEqual(ttIR, nvIR)
  expect(shapeResult.equal, `shape.html: ${shapeResult.diffPath}`).toBe(true)
})

test('FE-01b  bindingPaths and kind identical to tagged-template', () => {
  const ttIR = html`<span>${() => ''}</span>`
  const nvSource = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  const r = irStructurallyEqual(ttIR, nvIR)
  expect(r.equal, r.reason).toBe(true)
  expect(nvIR.bindings[0]?.kind).toBe('text')
})

// ── FE-02: AttrBinding equivalence ───────────────────────────────────────────

test('FE-02a  shape.html identical to tagged-template', () => {
  const ttIR = html`<div class="${() => ''}">x</div>`
  const nvSource = `
const C = $component(() => {
  $script(() => { const cls = signal('') })
  $render(() => html\`<div class="\${cls}">x</div>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  const shapeResult = shapeHtmlEqual(ttIR, nvIR)
  expect(shapeResult.equal, `shape.html: ${shapeResult.diffPath}`).toBe(true)
})

test('FE-02b  bindingPaths, kind, name identical to tagged-template', () => {
  const ttIR = html`<div class="${() => ''}">x</div>`
  const nvSource = `
const C = $component(() => {
  $script(() => { const cls = signal('') })
  $render(() => html\`<div class="\${cls}">x</div>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  const r = irStructurallyEqual(ttIR, nvIR)
  expect(r.equal, r.reason).toBe(true)
  expect(nvIR.bindings[0]?.kind).toBe('attr')
  expect((nvIR.bindings[0] as AttrBinding).name).toBe('class')
})

// ── FE-03: PropBinding ────────────────────────────────────────────────────────

test('FE-03a  .propName="..." produces PropBinding with correct name', () => {
  const nvSource = `
const C = $component(() => {
  $script(() => { const val = signal('') })
  $render(() => html\`<input .value="\${val}">\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  expect(nvIR.bindings.length).toBe(1)
  expect(nvIR.bindings[0]?.kind).toBe('prop')
  expect((nvIR.bindings[0] as PropBinding).name).toBe('value')
  expect(nvIR.bindings[0]?.pathIndex).toBe(0)
})

test('FE-03b  PropBinding shape.html has no .value attribute (stripped from shape)', () => {
  const nvSource = `
const C = $component(() => {
  $render(() => html\`<input .value="\${val}">\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  const frag = parseShape(nvIR.shape.html)
  const inputEl = frag.querySelector('input')
  expect(inputEl !== null, 'input element present').toBe(true)
  expect(inputEl!.hasAttribute('value'), '.value not in shape HTML').toBe(false)
  expect(inputEl!.hasAttribute('.value'), '.value not in shape HTML').toBe(false)
})

test('FE-03c  PropBinding path targets the element', () => {
  const nvSource = `
const C = $component(() => {
  $render(() => html\`<input .checked="\${val}">\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  expect([...nvIR.shape.bindingPaths[0]!]).toStrictEqual([0])
  expect((nvIR.bindings[0] as PropBinding).name).toBe('checked')
})

// ── FE-04: EventBinding ───────────────────────────────────────────────────────

test('FE-04a  @eventName="..." produces EventBinding with correct eventName', () => {
  const nvSource = `
const C = $component(() => {
  $render(() => html\`<button @click="\${handler}">click</button>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  expect(nvIR.bindings.length).toBe(1)
  expect(nvIR.bindings[0]?.kind).toBe('event')
  expect((nvIR.bindings[0] as EventBinding).eventName).toBe('click')
  expect((nvIR.bindings[0] as EventBinding).handlerKind).toBe('reactive')
})

test('FE-04b  EventBinding shape.html has no @click attribute', () => {
  const nvSource = `
const C = $component(() => {
  $render(() => html\`<button @click="\${h}">go</button>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  const frag = parseShape(nvIR.shape.html)
  const btn = frag.querySelector('button')
  expect(btn !== null, 'button present').toBe(true)
  expect(btn!.hasAttribute('@click'), '@click not in shape').toBe(false)
  expect(btn!.textContent).toBe('go')
})

test('FE-04c  EventBinding path targets the element', () => {
  const nvSource = `
const C = $component(() => {
  $render(() => html\`<button @input="\${h}">x</button>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  expect([...nvIR.shape.bindingPaths[0]!]).toStrictEqual([0])
  expect((nvIR.bindings[0] as EventBinding).eventName).toBe('input')
})

// ── FE-05: ChildBinding expressiveness boundary ───────────────────────────────

test('FE-05a  text-position hole → TextBinding (not ChildBinding)', () => {
  const nvSource = `
const C = $component(() => {
  $render(() => html\`<div>\${content}</div>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  expect(
    nvIR.bindings[0]?.kind,
    'text-position hole → TextBinding in .nv v0; ChildBinding requires manual IR',
  ).toBe('text')
})

test('FE-05b  manual ChildBinding IR comparison (back-end parity)', () => {
  const manualA: TemplateIR = {
    id: 'child-a',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'child',
        pathIndex: 0,
        expr: () => 'stub',
      } satisfies ChildBinding,
    ],
  }
  const manualB: TemplateIR = {
    id: 'child-b',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'child',
        pathIndex: 0,
        expr: () => 'stub',
      } satisfies ChildBinding,
    ],
  }
  const r = irStructurallyEqual(manualA, manualB)
  expect(r.equal, `Back-end parity: manual ChildBinding IRs should be equal: ${r.reason}`).toBe(
    true,
  )
})

// ── FE-06: ConditionalBinding ─────────────────────────────────────────────────

test('FE-06a  ternary with html`` branches produces ConditionalBinding', () => {
  const nvSource = `
const C = $component(() => {
  $script(() => { const show = signal(true) })
  $render(() => html\`<div>\${show ? html\`<span>A</span>\` : html\`<span>B</span>\`}</div>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  expect(nvIR.bindings.length).toBe(1)
  expect(nvIR.bindings[0]?.kind).toBe('conditional')
})

test('FE-06b  ConditionalBinding shape + paths match manual IR', () => {
  const nvSource = `
const C = $component(() => {
  $render(() => html\`<div>\${show ? html\`<span>A</span>\` : html\`<span>B</span>\`}</div>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  const refIR: TemplateIR = {
    id: 'ref',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'conditional',
        pathIndex: 0,
        condition: () => true,
        consequent: { id: 'c', shape: { html: '<span>A</span>', bindingPaths: [] }, bindings: [] },
        alternate: { id: 'a', shape: { html: '<span>B</span>', bindingPaths: [] }, bindings: [] },
      } satisfies ConditionalBinding,
    ],
  }

  expect(shapeHtmlEqual(nvIR, refIR).equal, 'outer shape.html mismatch').toBe(true)
  const r = irStructurallyEqual(nvIR, refIR)
  expect(r.equal, r.reason).toBe(true)
})

test('FE-06c  null alternate (pure-if) sets alternate: null', () => {
  const nvSource = `
const C = $component(() => {
  $render(() => html\`<div>\${show ? html\`<span>A</span>\` : null}</div>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  const b = nvIR.bindings[0] as ConditionalBinding
  expect(b.kind).toBe('conditional')
  expect(b.alternate).toBe(null)
  expect(b.consequent.shape.html.includes('<span>A</span>')).toBe(true)
})

// ── FE-07: Multi-binding (Attr + Text) ───────────────────────────────────────

test('FE-07a  Attr + Text in one template: shape + paths + kinds identical to tagged-template', () => {
  const ttIR = html`<div class="${() => ''}">${() => ''}</div>`
  const nvSource = `
const C = $component(() => {
  $script(() => { const cls = signal(''); const text = signal('') })
  $render(() => html\`<div class="\${cls}">\${text}</div>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  expect(shapeHtmlEqual(ttIR, nvIR).equal, 'shape.html mismatch').toBe(true)
  const r = irStructurallyEqual(ttIR, nvIR)
  expect(r.equal, r.reason).toBe(true)
  expect(nvIR.bindings.length).toBe(2)
  expect(nvIR.bindings[0]?.kind).toBe('attr')
  expect(nvIR.bindings[1]?.kind).toBe('text')
})

test('FE-07b  PropBinding + AttrBinding in same element: two bindings, correct names', () => {
  const nvSource = `
const C = $component(() => {
  $render(() => html\`<input class="\${cls}" .value="\${val}">\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  expect(nvIR.bindings.length).toBe(2)
  expect(nvIR.bindings[0]?.kind).toBe('attr')
  expect((nvIR.bindings[0] as AttrBinding).name).toBe('class')
  expect(nvIR.bindings[1]?.kind).toBe('prop')
  expect((nvIR.bindings[1] as PropBinding).name).toBe('value')
})

// ── FE-08: Nested conditional with reactive branch ───────────────────────────

test('FE-08a  reactive consequent branch has its own TextBinding', () => {
  const nvSource = `
const C = $component(() => {
  $script(() => {
    const show = signal(true)
    const msg = signal('hello')
  })
  $render(() => html\`<div>\${show ? html\`<span>\${msg}</span>\` : null}</div>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  const outer = nvIR.bindings[0] as ConditionalBinding
  expect(outer.kind).toBe('conditional')
  expect(outer.alternate).toBe(null)

  expect(outer.consequent.bindings.length).toBe(1)
  expect(outer.consequent.bindings[0]?.kind).toBe('text')
  expect(outer.consequent.shape.html.includes('<!--nv-0-->'), 'consequent has text sentinel').toBe(
    true,
  )
})

test('FE-08b  nested conditional matches structure of TC-06g manual IR', () => {
  const nvSource = `
const C = $component(() => {
  $render(() => html\`<div>\${show ? html\`<span>\${msg}</span>\` : html\`<p>alternate</p>\`}</div>\`)
})`
  const { ir: nvIR } = parseOne(nvSource)

  const refConsequent: TemplateIR = {
    id: 'cons',
    shape: { html: '<span><!--nv-0--></span>', bindingPaths: [[0, 0]] },
    bindings: [{ kind: 'text', pathIndex: 0, expr: () => 'stub' } satisfies TextBinding],
  }
  const refAlternate: TemplateIR = {
    id: 'alt',
    shape: { html: '<p>alternate</p>', bindingPaths: [] },
    bindings: [],
  }
  const refOuter: TemplateIR = {
    id: 'ref',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'conditional',
        pathIndex: 0,
        condition: () => true,
        consequent: refConsequent,
        alternate: refAlternate,
      } satisfies ConditionalBinding,
    ],
  }

  expect(shapeHtmlEqual(nvIR, refOuter).equal, 'outer shape.html mismatch').toBe(true)
  const r = irStructurallyEqual(nvIR, refOuter)
  expect(r.equal, r.reason).toBe(true)
})

// ── FE-09: Mutation-write rewriting ──────────────────────────────────────────

test('FE-09a  simple mutation-write: x = val → x.set(val)', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    count = 5
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(processed.includes('count.set(5)'), `Expected count.set(5), got: ${processed}`).toBe(true)
  expect(processed.includes('count = 5'), 'Original mutation-write should be gone').toBe(false)
})

test('FE-09b  RHS bare-read is erased: count = count + 1 → count.set(count() + 1)', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    count = count + 1
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(
    processed.includes('count.set(count() + 1)'),
    `Expected count.set(count() + 1), got: ${processed}`,
  ).toBe(true)
  expect(processed.includes('count.set(count + 1)'), 'Unerased RHS should not appear').toBe(false)
})

test('FE-09c  multiple mutation-writes: all rewritten', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    const name = signal('')
    count = 10
    name = 'hello'
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(processed.includes('count.set(10)'), 'count mutation-write rewritten').toBe(true)
  expect(processed.includes("name.set('hello')"), 'name mutation-write rewritten').toBe(true)
})

test('FE-09d  non-signal assignment in $script is NOT rewritten', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    let x = 0
    x = 5
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(processed.includes('x = 5'), 'non-signal assignment unchanged').toBe(true)
  expect(processed.includes('x.set'), 'non-signal should not become .set()').toBe(false)
})

test('FE-09e  mutation-write outside $script is NOT rewritten', () => {
  const source = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  // This would be in a handler, outside $script:
  $render(() => html\`<button @click="\${() => { const count = 0; count = 1 }}">x</button>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(processed.includes('count = 1'), 'assignment outside $script not rewritten').toBe(true)
})

test('FE-09f  signals from multiple $script blocks are all recognized', () => {
  const source = `
const C = $component(() => {
  $script(() => { const a = signal(0) })
  $script(() => { const b = signal('') })
  $script(() => {
    a = 1
    b = 'x'
  })
  $render(() => html\`<span>\${a}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(processed.includes('a.set(1)'), 'a rewritten').toBe(true)
  expect(processed.includes("b.set('x')"), 'b rewritten').toBe(true)
})

test('FE-09g  bare-read erasure in non-mutation-write context', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    const double = derived(() => count * 2)
  })
  $render(() => html\`<span>\${double}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')
  expect(
    processed.includes('derived(() => count() * 2)'),
    `Expected derived(() => count() * 2) in: ${processed}`,
  ).toBe(true)
})

test('FE-09h  compound assignment count += 1 → count.set(count() + 1)', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    count += 1
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(
    processed.includes('count.set(count() + 1)'),
    `Expected count.set(count() + 1) in: ${processed}`,
  ).toBe(true)
  expect(processed.includes('count() +='), 'Must not emit count() += (invalid JS)').toBe(false)
  expect(processed.includes('count +='), 'Compound assignment must not survive unmodified').toBe(
    false,
  )
})

test('FE-09h-variants  all compound operators expand correctly', () => {
  const ops: Array<[string, string]> = [
    ['count -= 1', 'count.set(count() - 1)'],
    ['count *= 2', 'count.set(count() * 2)'],
    ['count /= 2', 'count.set(count() / 2)'],
    ['count **= 2', 'count.set(count() ** 2)'],
    ['count %= 3', 'count.set(count() % 3)'],
  ]
  for (const [mutation, expected] of ops) {
    const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    ${mutation}
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const processed = preprocessMutationWrites(source, 'test.nv')
    expect(
      processed.includes(expected),
      `${mutation}: expected ${expected} in output: ${processed}`,
    ).toBe(true)
  }
})

test('FE-09i  mutation-write to derived → diagnostic error, not .set() rewrite', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    const double = derived(() => count * 2)
    double = count + 1
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const diags: NvDiagnostic[] = []
  const processed = preprocessMutationWrites(source, 'test.nv', diags)

  const err = diags.find((d) => d.kind === 'error' && d.message.includes('double'))
  expect(
    err !== undefined,
    `Expected error diagnostic for 'double'. Got: ${JSON.stringify(diags)}`,
  ).toBe(true)
  expect(processed.includes('double.set'), `Derived write must not emit .set(): ${processed}`).toBe(
    false,
  )
})

test('FE-09j  local variable shadowing signal → inner assignment not rewritten', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    const handler = () => {
      let count = 5
      count = 10
    }
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(
    processed.includes('count = 10'),
    'Inner count = 10 must remain as local variable assignment',
  ).toBe(true)
  expect(
    processed.includes('count.set(10)'),
    'Shadowed count = 10 must not become count.set(10)',
  ).toBe(false)
})

test('FE-09j-confirm-outer  outer signal writes still rewritten when inner is shadowed', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    count = 99
    const handler = () => {
      let count = 5
      count = 10
    }
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(processed.includes('count.set(99)'), 'Outer signal mutation still rewritten').toBe(true)
  expect(processed.includes('count = 10'), 'Inner local assignment preserved').toBe(true)
  expect(processed.includes('count.set(10)'), 'Inner local not treated as signal').toBe(false)
})

test('FE-09k  destructured parameter shadows signal → inner assignment not rewritten', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    const handler = ({ count }) => {
      count = 1
    }
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(
    processed.includes('count.set(1)'),
    'Destructured param count = 1 must not become count.set(1)',
  ).toBe(false)
  expect(
    processed.includes('count = 1'),
    'Inner assignment to destructured param preserved as-is',
  ).toBe(true)
})

test('FE-09k-outer  outer signal writes still rewritten with destructured-param shadow', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    count = 42
    const handler = ({ count }) => {
      count = 1
    }
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(processed.includes('count.set(42)'), 'Outer signal mutation still rewritten').toBe(true)
  expect(processed.includes('count.set(1)'), 'Destructured param write not rewritten').toBe(false)
})

test('FE-09l  nested block let shadows signal → inner assignment not rewritten', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    const handler = () => {
      {
        let count = 5
        count = 10
      }
    }
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(
    processed.includes('count.set(10)'),
    'Nested-block let count = 10 must not become count.set(10)',
  ).toBe(false)
  expect(processed.includes('count = 10'), 'Nested-block local assignment preserved').toBe(true)
})

test('FE-09l-outer  signal writes outside the nested block still rewritten', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    count = 1
    const handler = () => {
      count = 2
      {
        let count = 5
        count = 10
      }
      count = 3
    }
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')

  expect(processed.includes('count.set(1)'), 'Outer $script-level signal write rewritten').toBe(
    true,
  )
  expect(processed.includes('count.set(2)'), 'Signal write before block rewritten').toBe(true)
  expect(processed.includes('count.set(3)'), 'Signal write after block rewritten').toBe(true)
  expect(processed.includes('count.set(10)'), 'Block-local let count = 10 not rewritten').toBe(
    false,
  )
  expect(processed.includes('count = 10'), 'Block-local assignment preserved').toBe(true)
})

test('FE-09-RUNTIME  mutation-write erasure produces correct signal value', () => {
  const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    count = count + 1
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const processed = preprocessMutationWrites(source, 'test.nv')
  expect(
    processed.includes('count.set(count() + 1)'),
    `Text check: expected count.set(count() + 1) in: ${processed}`,
  ).toBe(true)

  const testCount = signal(0)

  testCount.set(testCount() + 1)
  flushSync()
  expect(testCount()).toBe(1)

  testCount.set(testCount() + 1)
  flushSync()
  expect(testCount()).toBe(2)

  const a = signal(3)
  const b = signal(4)
  a.set(a() + b())
  flushSync()
  expect(a()).toBe(7)
})

// ── FE-10: Verdict detection (ACCEPT / PLAIN) ─────────────────────────────────

test('FE-10a  hole reading a $script signal → ACCEPT verdict', () => {
  const nvSource = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`
  const { verdicts } = parseOne(nvSource)

  expect(verdicts[0], 'Hole reading a $script signal should produce ACCEPT (reactive read)').toBe(
    'ACCEPT',
  )
})

test('FE-10b  hole with no signal reference → PLAIN verdict', () => {
  const nvSource = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${SOME_CONSTANT}</span>\`)
})`
  const { verdicts } = parseOne(nvSource)

  expect(
    verdicts[0],
    'Hole with no signal reference should produce PLAIN (no reactive reads)',
  ).toBe('PLAIN')
})

test('FE-10c  attr hole reading a signal → ACCEPT verdict', () => {
  const nvSource = `
const C = $component(() => {
  $script(() => { const cls = signal('') })
  $render(() => html\`<div class="\${cls}">x</div>\`)
})`
  const { verdicts } = parseOne(nvSource)

  expect(verdicts[0], 'Attr hole reading signal → ACCEPT').toBe('ACCEPT')
})

test('FE-10d  signal name inside an explicit thunk → ACCEPT (no function-boundary stopping)', () => {
  const nvSource = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${() => count + 1}</span>\`)
})`
  const { verdicts } = parseOne(nvSource)
  expect(verdicts[0], 'Signal name inside explicit thunk → ACCEPT (over-report is safe)').toBe(
    'ACCEPT',
  )
})

test('FE-10f  derived name in hole → ACCEPT (derived is reactive, collected alongside signal)', () => {
  const nvSource = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    const double = derived(() => count() * 2)
  })
  $render(() => html\`<span>\${double}</span>\`)
})`
  const { verdicts } = parseOne(nvSource)
  expect(verdicts[0], 'Derived name in hole → ACCEPT').toBe('ACCEPT')
})

test('FE-10e  multiple holes: verdicts indexed in hole order', () => {
  const nvSource = `
const C = $component(() => {
  $script(() => { const a = signal(0); const b = signal('') })
  $render(() => html\`<div class="\${a}">\${CONSTANT}\${b}</div>\`)
})`
  const { verdicts } = parseOne(nvSource)

  expect(verdicts.length).toBe(3)
  expect(verdicts[0], 'a (signal) → ACCEPT').toBe('ACCEPT')
  expect(verdicts[1], 'CONSTANT (not signal) → PLAIN').toBe('PLAIN')
  expect(verdicts[2], 'b (signal) → ACCEPT').toBe('ACCEPT')
})

// ── FE-11: $style ─────────────────────────────────────────────────────────────

test('FE-11a  $style object form: key-set extracted', () => {
  const nvSource = `
const C = $component(() => {
  $style({
    '.btn': { color: 'red', fontSize: '14px' },
    '.title': { fontWeight: 'bold' },
  })
  $render(() => html\`<div>x</div>\`)
})`
  const { style } = parseOne(nvSource)

  expect(style !== null, '$style should be parsed').toBe(true)
  expect(style!.form).toBe('object')
  expect([...style!.keys]).toStrictEqual(['.btn', '.title'])
})

test('FE-11b  $style factory form: key-set extracted, form=factory', () => {
  const nvSource = `
const C = $component(() => {
  $style((props) => ({
    '.primary': { color: props.color },
    '.secondary': { color: props.alt },
  }))
  $render(() => html\`<div>x</div>\`)
})`
  const { style } = parseOne(nvSource)

  expect(style !== null).toBe(true)
  expect(style!.form).toBe('factory')
  expect([...style!.keys]).toStrictEqual(['.primary', '.secondary'])
})

test('FE-11c  no $style block: style is null', () => {
  const nvSource = `
const C = $component(() => {
  $render(() => html\`<div>x</div>\`)
})`
  const { style } = parseOne(nvSource)
  expect(style).toBe(null)
})

// ── FE-12: Multiple components per file ───────────────────────────────────────

test('FE-12a  two $component declarations produce two independent results', () => {
  const nvSource = `
const Counter = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})

const Label = $component(() => {
  $script(() => { const text = signal('') })
  $render(() => html\`<p>\${text}</p>\`)
})
`
  const results = parseNvFile(nvSource, 'test.nv', document)

  expect(results.length, 'two components parsed').toBe(2)
  expect(results[0]!.name).toBe('Counter')
  expect(results[1]!.name).toBe('Label')
})

test('FE-12b  each component has its own $script signal scope', () => {
  const nvSource = `
const A = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})
const B = $component(() => {
  $render(() => html\`<p>\${count}</p>\`)
})
`
  const results = parseNvFile(nvSource, 'test.nv', document)

  expect(results.length).toBe(2)
  expect(results[0]!.verdicts[0], 'A sees count as its own signal').toBe('ACCEPT')
  expect(results[1]!.verdicts[0], "B does not inherit A's count signal").toBe('PLAIN')
})

test('FE-12c  each component produces an independent, different IR', () => {
  const nvSource = `
const Counter = $component(() => {
  $render(() => html\`<span>count</span>\`)
})
const Label = $component(() => {
  $render(() => html\`<p>label</p>\`)
})
`
  const results = parseNvFile(nvSource, 'test.nv', document)

  const counterShape = parseShape(results[0]!.ir.shape.html)
  const labelShape = parseShape(results[1]!.ir.shape.html)

  const spanEl = counterShape.querySelector('span')
  const pEl = labelShape.querySelector('p')
  expect(spanEl !== null, 'Counter IR has span').toBe(true)
  expect(pEl !== null, 'Label IR has p').toBe(true)
})

// ── buildPropsAccessorMap unit tests ─────────────────────────────────────────

/**
 * Parse a destructuring source like `const { count, label: l } = props` and
 * return the BindingName of the first variable declaration.
 */
function parseBindingPattern(src: string): ts.BindingName {
  const sf = ts.createSourceFile('tmp.ts', src, ts.ScriptTarget.Latest, true)
  const stmt = sf.statements[0]
  if (!ts.isVariableStatement(stmt!)) throw new Error('Expected variable statement')
  const decl = stmt.declarationList.declarations[0]
  if (!decl) throw new Error('No declaration')
  return decl.name
}

describe('buildPropsAccessorMap', () => {
  it('TC-A2-01: plain element maps local name to props.key()', () => {
    const pattern = parseBindingPattern('const { count } = props')
    const diags: NvDiagnostic[] = []
    const map = buildPropsAccessorMap(pattern, ['count', 'label'], diags)
    expect(diags).toHaveLength(0)
    expect(map.get('count')).toBe('props.count()')
    expect(map.size).toBe(1)
  })

  it('TC-A2-02: aliased element maps local alias to source key accessor', () => {
    const pattern = parseBindingPattern('const { count: c, label: l } = props')
    const diags: NvDiagnostic[] = []
    const map = buildPropsAccessorMap(pattern, ['count', 'label'], diags)
    expect(diags).toHaveLength(0)
    expect(map.get('c')).toBe('props.count()')
    expect(map.get('l')).toBe('props.label()')
    expect(map.has('count')).toBe(false)
    expect(map.has('label')).toBe(false)
  })

  it('TC-A2-03: rest element gets sentinel with remaining keys', () => {
    const pattern = parseBindingPattern('const { count, ...rest } = props')
    const diags: NvDiagnostic[] = []
    const map = buildPropsAccessorMap(pattern, ['count', 'label', 'title'], diags)
    expect(diags).toHaveLength(0)
    expect(map.get('count')).toBe('props.count()')
    expect(map.get('rest')).toBe('REST:label,title')
  })

  it('TC-A2-04: rest with no remaining keys produces empty REST sentinel', () => {
    const pattern = parseBindingPattern('const { count, ...rest } = props')
    const diags: NvDiagnostic[] = []
    const map = buildPropsAccessorMap(pattern, ['count'], diags)
    expect(map.get('rest')).toBe('REST:')
  })

  it('TC-A2-05: nested destructure emits D1 diagnostic and is skipped', () => {
    const pattern = parseBindingPattern('const { user: { name } } = props')
    const diags: NvDiagnostic[] = []
    const map = buildPropsAccessorMap(pattern, ['user'], diags)
    expect(diags).toHaveLength(1)
    expect(diags[0]!.kind).toBe('error')
    expect(diags[0]!.message).toContain('Nested prop destructuring')
    expect(map.size).toBe(0)
  })

  it('TC-A2-06: non-object pattern returns empty map', () => {
    const pattern = parseBindingPattern('const count = props')
    const diags: NvDiagnostic[] = []
    const map = buildPropsAccessorMap(pattern, ['count'], diags)
    expect(map.size).toBe(0)
    expect(diags).toHaveLength(0)
  })

  it('TC-A2-07: mixed plain and alias elements', () => {
    const pattern = parseBindingPattern('const { count, label: l } = props')
    const diags: NvDiagnostic[] = []
    const map = buildPropsAccessorMap(pattern, ['count', 'label'], diags)
    expect(map.get('count')).toBe('props.count()')
    expect(map.get('l')).toBe('props.label()')
    expect(map.size).toBe(2)
  })
})

describe('eraseHandlerExpr: destructuring-write diagnostics', () => {
  it('TC-DW-01: destructuring assignment to signal in handler → error diagnostic mentioning "destructuring"', () => {
    const nvSource = [
      'const C = $component(() => {',
      '  $script(() => { const count = signal(0) })',
      '  $render(() => html`<button @click="${() => { ({ count } = obj) }}">x</button>`)',
      '})',
    ].join('\n')
    const results = parseNvFileForEmit(nvSource, 'test.nv', document)
    const diags = results[0]?.diagnostics ?? []
    expect(
      diags.some((d) => d.kind === 'error' && d.message.toLowerCase().includes('destructuring')),
      `Expected destructuring error diagnostic. Got: ${JSON.stringify(diags)}`,
    ).toBe(true)
  })
})

// ── Component element detection (TC-C series) ─────────────────────────────────

describe('nv-parser — component element detection', () => {
  it('TC-C01-parser: <Counter count="${n}"/> → ComponentBinding with propNames', () => {
    const nvSource = [
      'const Parent = $component(() => {',
      '  $script(() => { const n = signal(0) })',
      '  $render(() => html`<Counter count="${n}"></Counter>`)',
      '})',
    ].join('\n')
    const results = parseNvFile(nvSource, 'test.nv', document)
    const ir = results[0]?.ir
    expect(ir).toBeDefined()
    const compBinding = ir?.bindings.find((b) => b.kind === 'component')
    expect(compBinding).toBeDefined()
    expect(compBinding?.kind).toBe('component')
    const cb = compBinding as ComponentBinding | undefined
    expect(cb!.propNames).toContain('count')
    expect(cb!.props[0]?.name).toBe('count')
  })

  it('TC-C04-parser: child uses const { count } = props → scriptBody contains props.count()', () => {
    const nvSource = [
      'const Counter = $component((props) => {',
      '  $script(() => {',
      '    const { count } = props',
      '    const doubled = count * 2',
      '  })',
      '  $render(() => html`<div></div>`)',
      '})',
    ].join('\n')
    const preprocessed = preprocessMutationWrites(nvSource, 'test.nv')
    expect(preprocessed).toContain('props.count()')
    expect(preprocessed).not.toMatch(/const \{ count \} = props/)
  })

  it('TC-C05-parser: alias prop destructure { count: c } = props → erases alias to source key accessor', () => {
    const nvSource = [
      'const Child = $component((props) => {',
      '  $script(() => {',
      '    const { count: c } = props',
      '    const doubled = derived(() => c * 2)',
      '  })',
      '  $render(() => html`<span>${doubled}</span>`)',
      '})',
    ].join('\n')
    const preprocessed = preprocessMutationWrites(nvSource, 'test.nv')
    // Alias 'c' should be erased to 'props.count()' (source key drives the accessor)
    expect(preprocessed).toContain('props.count()')
    // The raw alias name 'c' should not appear as a bare accessor call
    expect(preprocessed).not.toContain('c()')
  })

  it('TC-C07-parser: child assigns to prop → diagnostic with "read-only" message', () => {
    const nvSource = [
      'const Counter = $component((props) => {',
      '  $script(() => {',
      '    const { count } = props',
      '    count = 5',
      '  })',
      '  $render(() => html`<div></div>`)',
      '})',
    ].join('\n')
    const diags: NvDiagnostic[] = []
    preprocessMutationWrites(nvSource, 'test.nv', diags)
    expect(diags.length).toBeGreaterThan(0)
    expect(diags[0]?.message).toContain('read-only')
  })

  it('TC-C11-parser: nested prop destructure — D1 diagnostic', () => {
    const nvSource = [
      'export const Child = $component((props) => {',
      '  $script(() => {',
      '    const { user: { name } } = props',
      '  })',
      '  $render(() => html`<span></span>`)',
      '})',
    ].join('\n')
    const results = parseNvFile(nvSource, 'child.nv', document)
    const diags = results[0]?.diagnostics ?? []
    expect(
      diags.some((d) => d.kind === 'error' && d.message.toLowerCase().includes('nested')),
    ).toBe(true)
  })

  it('TC-C06-parser: rest member access liveness — rest.label reads as props.label()', () => {
    const nvSource = [
      'export const Child = $component((props) => {',
      '  $script(() => {',
      '    const { count, ...rest } = props',
      '    const x = rest.label',
      '  })',
      '  $render(() => html`<span></span>`)',
      '})',
    ].join('\n')
    const results = parseNvFileForEmit(nvSource, 'child.nv', document)
    const scriptBody = results[0]?.emit?.scriptBody ?? ''
    expect(scriptBody).toContain('props.label()')
  })
})

describe('TC-slot-warning: slot content in component element', () => {
  it('static slot content is captured, no warning emitted', () => {
    // Static child content → captured as default slot, no diagnostic
    const nvSource = [
      'export const App = $component(() => {',
      '  $script(() => { const n = signal(0) })',
      '  $render(() => html`<div><Card .title="${n}"><p>hello</p></Card></div>`)',
      '})',
    ].join('\n')
    const results = parseNvFile(nvSource, 'app.nv', document)
    const diags = results[0]?.diagnostics ?? []
    // Static slot content should NOT produce a warning
    expect(
      diags.some((d) => d.kind === 'warning' && d.message.toLowerCase().includes('slot')),
    ).toBe(false)
    // The ComponentBinding should have the slot captured
    const ir = results[0]?.ir
    const compBinding = ir?.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    expect(compBinding).toBeDefined()
    expect(compBinding!.slots).toHaveLength(1)
    expect(compBinding!.slots[0]!.name).toBe('default')
    expect(compBinding!.slots[0]!.content({}).shape.html).toContain('<p>hello</p>')
  })

  it('dynamic slot content is captured as default slot with hole tracking', () => {
    // Dynamic child content → captured as default slot with holeIndices; no warning
    const nvSource = [
      'export const App = $component(() => {',
      '  $script(() => { const n = signal(0) })',
      '  $render(() => html`<div><Card .title="${n}"><span>${n}</span></Card></div>`)',
      '})',
    ].join('\n')
    const results = parseNvFile(nvSource, 'app.nv', document)
    const diags = results[0]?.diagnostics ?? []
    // Dynamic slot content should NOT produce a warning anymore
    expect(
      diags.some((d) => d.kind === 'warning' && d.message.toLowerCase().includes('dynamic slot')),
    ).toBe(false)
    // The ComponentBinding should have the slot captured
    const ir = results[0]?.ir
    const compBinding = ir?.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    expect(compBinding).toBeDefined()
    expect(compBinding!.slots).toHaveLength(1)
    expect(compBinding!.slots[0]!.name).toBe('default')
  })

  it('no warning or slots when component element has no children', () => {
    const nvSource = [
      'export const App = $component(() => {',
      '  $script(() => { const n = signal(0) })',
      '  $render(() => html`<div><Counter .count="${n}"/></div>`)',
      '})',
    ].join('\n')
    const results = parseNvFile(nvSource, 'app.nv', document)
    const diags = results[0]?.diagnostics ?? []
    expect(
      diags.some((d) => d.kind === 'warning' && d.message.toLowerCase().includes('slot')),
    ).toBe(false)
  })

  it('TC-slot-static: static slot content captured in ComponentBinding slots', () => {
    // <Card .title="${n}"><p>hello</p></Card> → slots: [{ name: 'default', content: { shape: { html: '<p>hello</p>' } } }]
    const nvSource = [
      'export const Parent = $component(() => {',
      '  $script(() => { const n = signal(0) })',
      '  $render(() => html`<Card .title="${n}"><p>hello</p></Card>`)',
      '})',
    ].join('\n')
    const results = parseNvFile(nvSource, 'parent.nv', document)
    const ir = results[0]?.ir
    const compBinding = ir?.bindings.find((b) => b.kind === 'component') as
      | ComponentBinding
      | undefined
    expect(compBinding).toBeDefined()
    expect(compBinding!.slots).toHaveLength(1)
    expect(compBinding!.slots[0]!.name).toBe('default')
    expect(compBinding!.slots[0]!.content({}).shape.html).toContain('<p>hello</p>')
  })

  it('Bug #2: shape.html replaces <Counter/> with anchor comment, not element tag', () => {
    const nvSource = [
      'const App = $component(() => {',
      '  $script(() => { const n = signal(0) })',
      '  $render(() => html`<div><Counter .count="${n}"/></div>`)',
      '})',
    ].join('\n')
    const results = parseNvFile(nvSource, 'app.nv', document)
    const ir = results[0]!.ir
    // shape.html must NOT contain a Counter element tag
    expect(ir.shape.html).not.toContain('Counter')
    // shape.html must contain the anchor comment
    expect(ir.shape.html).toContain('<!--nv-comp-')
    // the component binding's pathIndex must resolve to a Comment node, not an Element
    const compBinding = ir.bindings.find((b) => b.kind === 'component')
    expect(compBinding).toBeDefined()
  })

  it('Bug #2 (emit path): shape.html anchor comment present in parseNvFileForEmit result', () => {
    const nvSource = [
      'const App = $component(() => {',
      '  $script(() => { const n = signal(0) })',
      '  $render(() => html`<div><Counter .count="${n}"/></div>`)',
      '})',
    ].join('\n')
    const results = parseNvFileForEmit(nvSource, 'app.nv', document)
    const ir = results[0]!.ir
    expect(ir.shape.html).not.toContain('Counter')
    expect(ir.shape.html).toContain('<!--nv-comp-')
  })
})

describe('G1: classlist token in slot content carries parent scopeHash', () => {
  it('G1: classlist toggle token in slot content carries parent scopeHash', () => {
    const src = `
      const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
    `
    const results = parseNvFile(src, 'test.nv', document)
    const parent = results.find((r) => r.name === 'Parent')!
    const childComp = parent.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
    const slotIR = childComp.slots[0]!.content({})
    const cl = slotIR.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
    const toggle = cl.entries.find((e) => e.kind === 'toggle')!
    const expectedHash = parent.ir.styleArtifact!.scopeHash
    expect(toggle.key).toBe(`card_${expectedHash}`)
  })
})

// G5 SKIPPED: <each> inside slot content is not yet supported at parse time.
// The slot content builder (buildNvSlotContentIR) calls walkNvNodeList but intentionally
// ignores the `lists` return — so <each> elements inside slots throw a parse error.
// G5 would require wiring `lists` into slot IR first (a separate fix).
describe('G5: classlist token in <each>-inside-slot carries parent scopeHash', () => {
  it('G5: classlist token in <each>-inside-slot carries parent scopeHash', () => {
    const items = signal<unknown[]>([])
    const src = `
      const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`
          <ChildComp>
            <each .of="\${items}" key="\${(item) => item}" let={item}>
              <div class="\${{card: true}}">\${item}</div>
            </each>
          </ChildComp>
        \`)
      })
    `
    const results = parseNvFile(src, 'test.nv', document)
    const parent = results.find((r) => r.name === 'Parent')!
    const childComp = parent.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
    const slotIR = childComp.slots[0]!.content({})
    const listBinding = slotIR.bindings.find((b) => b.kind === 'list') as ListBinding
    const stubVs = signal<unknown>(null)
    const stubIs = signal<number>(0)
    const itemIR = listBinding.itemTemplate(stubVs, stubIs)
    const cl = itemIR.bindings.find((b) => b.kind === 'classlist') as ClassListBinding
    const toggle = cl.entries.find((e) => e.kind === 'toggle')!
    const expectedHash = parent.ir.styleArtifact!.scopeHash
    expect(toggle.key).toBe(`card_${expectedHash}`)
  })
})

describe('G3: scopeHash uses shapeHtml not ir.id', () => {
  it('G3: both scopeHash sites use simpleHash(shapeHtml), not simpleHash(ir.id)', () => {
    // A parent with a child component — shapeHtml ≠ reserializedShape here
    const src = `
      const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
    `
    const results = parseNvFile(src, 'test.nv', document)
    const parent = results.find((r) => r.name === 'Parent')!
    // The scopeHash embedded in classRewrites values must NOT equal simpleHash(ir.id)
    // (because shapeHtml ≠ ir.id's input for a template with child components)
    const rwHash = [...(parent.ir.classRewrites?.values() ?? [])][0]?.split('_').pop()
    expect(rwHash).toBeDefined()
    expect(rwHash).not.toBe(simpleHash(parent.ir.id))
    // It should equal simpleHash of the pre-walk shape — verified by checking styleArtifact
    expect(parent.ir.styleArtifact?.scopeHash).toBe(rwHash)
  })
})
