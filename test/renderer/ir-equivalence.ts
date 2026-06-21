/**
 * Shared structural-equivalence oracle for IR comparison in tests.
 * Extracted from nv-parser.test.ts so the FE-equivalence suite AND the slot
 * G3.1 gate assert against the IDENTICAL comparator (the gate's single-oracle
 * requirement). shape.html is compared via the real DOM structural comparator
 * (comparator.ts structurallyEqual), NOT string equality.
 */

import { structurallyEqual } from '../../src/renderer/comparator.js'
import type {
  AttrBinding,
  Binding,
  ConditionalBinding,
  EventBinding,
  PropBinding,
  TemplateIR,
} from '../../src/renderer/ir.js'

export interface IrDiff {
  equal: boolean
  reason: string
}

/** Parse a shape.html string into a DocumentFragment for structural comparison. */
export function parseShape(doc: Document, htmlStr: string): DocumentFragment {
  const tmpl = doc.createElement('template')
  tmpl.innerHTML = htmlStr
  return tmpl.content.cloneNode(true) as DocumentFragment
}

/** Compare two IRs' shape.html via DOM structural comparison (normalized, not bytes). */
export function shapeHtmlEqual(
  doc: Document,
  a: TemplateIR,
  b: TemplateIR,
): { equal: boolean; diffPath: string } {
  return structurallyEqual(parseShape(doc, a.shape.html), parseShape(doc, b.shape.html))
}

/** Compare bindingPaths arrays exactly. */
export function pathsEqual(a: TemplateIR, b: TemplateIR): boolean {
  if (a.shape.bindingPaths.length !== b.shape.bindingPaths.length) return false
  for (let i = 0; i < a.shape.bindingPaths.length; i++) {
    const ap = a.shape.bindingPaths[i] as readonly number[]
    const bp = b.shape.bindingPaths[i] as readonly number[]
    if (ap.length !== bp.length) return false
    for (let j = 0; j < ap.length; j++) if (ap[j] !== bp[j]) return false
  }
  return true
}

function bindingEqual(a: Binding, b: Binding, i: number): IrDiff {
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
    case 'slot-outlet': {
      const bs = b as Extract<Binding, { kind: 'slot-outlet' }>
      if (a.name !== bs.name) return { equal: false, reason: `${p}.name: ${a.name} vs ${bs.name}` }
      break
    }
    case 'conditional': {
      const bc = b as ConditionalBinding
      const cRes = irStructurallyEqual(undefined, a.consequent, bc.consequent)
      if (!cRes.equal) return { equal: false, reason: `${p}.consequent → ${cRes.reason}` }
      if ((a.alternate === null) !== (bc.alternate === null))
        return { equal: false, reason: `${p}.alternate nullity mismatch` }
      if (a.alternate !== null && bc.alternate !== null) {
        const aRes = irStructurallyEqual(undefined, a.alternate, bc.alternate)
        if (!aRes.equal) return { equal: false, reason: `${p}.alternate → ${aRes.reason}` }
      }
      break
    }
  }
  return { equal: true, reason: '' }
}

/**
 * Structurally compare two IRs: bindingPaths, binding kinds, non-expr fields,
 * recursing into conditional branches. If `doc` is provided, shape.html is also
 * compared via the DOM structural comparator. (Pass `undefined` for `doc` when
 * recursing — outer caller compares shape once.)
 */
export function irStructurallyEqual(
  doc: Document | undefined,
  a: TemplateIR,
  b: TemplateIR,
): IrDiff {
  if (doc !== undefined) {
    const s = shapeHtmlEqual(doc, a, b)
    if (!s.equal) return { equal: false, reason: `shape.html → ${s.diffPath}` }
  }
  if (a.bindings.length !== b.bindings.length)
    return { equal: false, reason: `binding count: ${a.bindings.length} vs ${b.bindings.length}` }
  if (!pathsEqual(a, b)) return { equal: false, reason: 'bindingPaths mismatch' }
  for (let i = 0; i < a.bindings.length; i++) {
    const r = bindingEqual(a.bindings[i] as Binding, b.bindings[i] as Binding, i)
    if (!r.equal) return r
  }
  return { equal: true, reason: '' }
}
