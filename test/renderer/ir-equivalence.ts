/**
 * Shared structural-equivalence oracle for IR comparison in tests.
 * Extracted from nv-parser.test.ts so the FE-equivalence suite AND the slot
 * G3.1 gate assert against the IDENTICAL comparator (the gate's single-oracle
 * requirement). shape.html is compared via the real DOM structural comparator
 * (comparator.ts structurallyEqual), NOT string equality.
 */

import { signal } from '../../src/core/core.js'
import { structurallyEqual } from '../../src/renderer/comparator.js'
import type {
  AttrBinding,
  Binding,
  ConditionalBinding,
  EventBinding,
  ListBinding,
  PropBinding,
  SlotOutletBinding,
  TemplateIR,
} from '../../src/renderer/ir.js'

export interface IrDiff {
  equal: boolean
  reason: string
}

/** Parse a shape.html string into a DocumentFragment for structural comparison.
 * Normalizes nv-* anchor comment text (e.g. "nv-0", "nv-list-0", "nv-comp-0")
 * so that different front-ends' placeholder comments compare as structurally equal.
 */
export function parseShape(doc: Document, htmlStr: string): DocumentFragment {
  const tmpl = doc.createElement('template')
  // Normalize: <!--nv-anything--> → <!--nv-->
  tmpl.innerHTML = htmlStr.replace(/<!--nv-[^>]*-->/g, '<!--nv-->')
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

/** Compare bindingPaths arrays, ignoring null entries (consumed sentinel holes).
 * Different front-ends may produce null placeholders for consumed EachSentinel holes
 * — the non-null paths must match in order and value.
 */
export function pathsEqual(a: TemplateIR, b: TemplateIR): boolean {
  const aPaths = a.shape.bindingPaths.filter((p) => p !== null) as readonly (readonly number[])[]
  const bPaths = b.shape.bindingPaths.filter((p) => p !== null) as readonly (readonly number[])[]
  if (aPaths.length !== bPaths.length) return false
  for (let i = 0; i < aPaths.length; i++) {
    const ap = aPaths[i]!
    const bp = bPaths[i]!
    if (ap.length !== bp.length) return false
    for (let j = 0; j < ap.length; j++) if (ap[j] !== bp[j]) return false
  }
  return true
}

function bindingEqual(a: Binding, b: Binding, i: number, aIr: TemplateIR, bIr: TemplateIR): IrDiff {
  const p = `binding[${i}]`
  if (a.kind !== b.kind) return { equal: false, reason: `${p}.kind: ${a.kind} vs ${b.kind}` }
  // Compare actual DOM paths rather than raw pathIndex — different front-ends may assign
  // different indices due to null sentinel placeholders in bindingPaths.
  const aPath = aIr.shape.bindingPaths[a.pathIndex]
  const bPath = bIr.shape.bindingPaths[b.pathIndex]
  if (JSON.stringify(aPath) !== JSON.stringify(bPath))
    return {
      equal: false,
      reason: `${p}.path: ${JSON.stringify(aPath)} vs ${JSON.stringify(bPath)}`,
    }
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
      const bs = b as SlotOutletBinding
      if (a.name !== bs.name) return { equal: false, reason: `${p}.name: ${a.name} vs ${bs.name}` }
      // Compare props names (closes inc-2 D2 debt)
      const aProps = (a as SlotOutletBinding).props ?? []
      const bProps = bs.props ?? []
      if (aProps.length !== bProps.length)
        return { equal: false, reason: `${p}.props.length: ${aProps.length} vs ${bProps.length}` }
      for (let j = 0; j < aProps.length; j++) {
        if (aProps[j]!.name !== bProps[j]!.name)
          return {
            equal: false,
            reason: `${p}.props[${j}].name: ${aProps[j]!.name} vs ${bProps[j]!.name}`,
          }
      }
      break
    }
    case 'list': {
      const bl = b as ListBinding
      // key function identity is not comparable — skip (same as expr thunks).
      // Recurse into item body: call both itemTemplate with shared stub signals.
      const stubVs = signal<unknown>(null)
      const stubIs = signal<number>(0)
      const aBody = (a as ListBinding).itemTemplate(stubVs, stubIs)
      const bBody = bl.itemTemplate(stubVs, stubIs)
      const bodyRes = irStructurallyEqual(undefined, aBody, bBody)
      if (!bodyRes.equal) return { equal: false, reason: `${p}.itemBody → ${bodyRes.reason}` }
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
    const r = bindingEqual(a.bindings[i] as Binding, b.bindings[i] as Binding, i, a, b)
    if (!r.equal) return r
  }
  return { equal: true, reason: '' }
}
