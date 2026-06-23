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
  ClassListBinding,
  ComponentBinding,
  ConditionalBinding,
  EventBinding,
  ListBinding,
  PropBinding,
  SlotOutletBinding,
  StyleVarBinding,
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

function bindingEqual(
  a: Binding,
  b: Binding,
  i: number,
  aIr: TemplateIR,
  bIr: TemplateIR,
  slotDoc: Document | undefined,
): IrDiff {
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
    case 'classlist': {
      const bcl = b as ClassListBinding
      const aEntries = (a as ClassListBinding).entries
      const bEntries = bcl.entries
      if (aEntries.length !== bEntries.length)
        return {
          equal: false,
          reason: `${p}.entries.length: ${aEntries.length} vs ${bEntries.length}`,
        }
      for (let j = 0; j < aEntries.length; j++) {
        const ae = aEntries[j]!
        const be = bEntries[j]!
        if (ae.kind !== be.kind)
          return { equal: false, reason: `${p}.entries[${j}].kind: ${ae.kind} vs ${be.kind}` }
        if (ae.kind === 'static' && be.kind === 'static') {
          if (ae.token !== be.token)
            return { equal: false, reason: `${p}.entries[${j}].token: ${ae.token} vs ${be.token}` }
        } else if (ae.kind === 'toggle' && be.kind === 'toggle') {
          if (ae.key !== be.key)
            return { equal: false, reason: `${p}.entries[${j}].key: ${ae.key} vs ${be.key}` }
          // expr thunks are not compared (same policy as other expr fields)
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
    case 'component': {
      // Slot content was previously UNCOMPARED — a ComponentBinding matched on
      // kind+path alone, so <each>-in-slot and static-class rewrites in slot
      // content went unchecked across FEs/back-ends. Recurse into slots (same
      // stub-call pattern as `list`: empty stub props, matching production
      // patchClasslistTokens and the G3.1/G5 tests).
      const ac = a as ComponentBinding
      const bc = b as ComponentBinding
      if (ac.propNames.length !== bc.propNames.length)
        return {
          equal: false,
          reason: `${p}.propNames.length: ${ac.propNames.length} vs ${bc.propNames.length}`,
        }
      for (let j = 0; j < ac.propNames.length; j++) {
        if (ac.propNames[j] !== bc.propNames[j])
          return {
            equal: false,
            reason: `${p}.propNames[${j}]: ${ac.propNames[j]} vs ${bc.propNames[j]}`,
          }
      }
      if (ac.slots.length !== bc.slots.length)
        return {
          equal: false,
          reason: `${p}.slots.length: ${ac.slots.length} vs ${bc.slots.length}`,
        }
      for (let j = 0; j < ac.slots.length; j++) {
        const aSlot = ac.slots[j]!
        const bSlot = bc.slots[j]!
        if (aSlot.name !== bSlot.name)
          return {
            equal: false,
            reason: `${p}.slots[${j}].name: ${aSlot.name} vs ${bSlot.name}`,
          }
        // Stub-call the slot content factory (empty props) and recurse. shape.html
        // IS compared here (pass `doc` through) so slot-content static-class rewrites
        // are caught — the D-slot-style-1 surface. doc is threaded via closure below.
        const aSlotIR = aSlot.content({})
        const bSlotIR = bSlot.content({})
        const slotRes = irStructurallyEqual(slotDoc, aSlotIR, bSlotIR)
        if (!slotRes.equal) return { equal: false, reason: `${p}.slots[${j}] → ${slotRes.reason}` }
      }
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
    case 'style-var': {
      if (b.kind !== 'style-var')
        return { equal: false, reason: `${p}.kind: ${a.kind} vs ${b.kind}` }
      const bsv = b as StyleVarBinding
      if (a.varName !== bsv.varName)
        return { equal: false, reason: `${p}.varName: ${a.varName} vs ${bsv.varName}` }
      break
    }
  }
  return { equal: true, reason: '' }
}

/**
 * Compare the IR-root $style outputs (`styleArtifact` + `classRewrites`).
 * Both are `.nv`-FE-only and optional: both-absent is equal (the FE-vs-FE case);
 * presence-mismatch is unequal; both-present compares scopeHash, staticCss,
 * varBindingDescs (varName + propertyName + exprSrc), and the classRewrites map.
 * This is the surface the FE-equivalence + style differential were previously blind to.
 */
export function styleArtifactEqual(a: TemplateIR, b: TemplateIR): IrDiff {
  const aSa = a.styleArtifact
  const bSa = b.styleArtifact
  if ((aSa === undefined) !== (bSa === undefined))
    return {
      equal: false,
      reason: `styleArtifact presence: ${aSa === undefined ? 'absent' : 'present'} vs ${bSa === undefined ? 'absent' : 'present'}`,
    }
  if (aSa !== undefined && bSa !== undefined) {
    if (aSa.scopeHash !== bSa.scopeHash)
      return {
        equal: false,
        reason: `styleArtifact.scopeHash: ${aSa.scopeHash} vs ${bSa.scopeHash}`,
      }
    if (aSa.staticCss !== bSa.staticCss)
      return { equal: false, reason: 'styleArtifact.staticCss mismatch' }
    const aVb = aSa.varBindingDescs ?? []
    const bVb = bSa.varBindingDescs ?? []
    if (aVb.length !== bVb.length)
      return {
        equal: false,
        reason: `styleArtifact.varBindingDescs.length: ${aVb.length} vs ${bVb.length}`,
      }
    for (let i = 0; i < aVb.length; i++) {
      const av = aVb[i]!
      const bv = bVb[i]!
      if (av.varName !== bv.varName)
        return {
          equal: false,
          reason: `varBindingDescs[${i}].varName: ${av.varName} vs ${bv.varName}`,
        }
      if (av.propertyName !== bv.propertyName)
        return {
          equal: false,
          reason: `varBindingDescs[${i}].propertyName: ${av.propertyName} vs ${bv.propertyName}`,
        }
      if (av.exprSrc !== bv.exprSrc)
        return { equal: false, reason: `varBindingDescs[${i}].exprSrc mismatch` }
    }
  }
  const aCr = a.classRewrites
  const bCr = b.classRewrites
  if ((aCr === undefined) !== (bCr === undefined))
    return {
      equal: false,
      reason: `classRewrites presence: ${aCr === undefined ? 'absent' : 'present'} vs ${bCr === undefined ? 'absent' : 'present'}`,
    }
  if (aCr !== undefined && bCr !== undefined) {
    if (aCr.size !== bCr.size)
      return { equal: false, reason: `classRewrites.size: ${aCr.size} vs ${bCr.size}` }
    for (const [k, v] of aCr) {
      if (bCr.get(k) !== v)
        return { equal: false, reason: `classRewrites[${k}]: ${v} vs ${bCr.get(k)}` }
    }
  }
  return { equal: true, reason: '' }
}

/**
 * Structurally compare two IRs: bindingPaths, binding kinds, non-expr fields,
 * recursing into conditional branches AND component slots. If `doc` is provided,
 * shape.html is also compared via the DOM structural comparator, AND the IR-root
 * $style outputs (styleArtifact/classRewrites) are compared. (Pass `undefined`
 * for `doc` when recursing — outer caller compares shape + style once at the root.)
 */
export function irStructurallyEqual(
  doc: Document | undefined,
  a: TemplateIR,
  b: TemplateIR,
): IrDiff {
  if (doc !== undefined) {
    const s = shapeHtmlEqual(doc, a, b)
    if (!s.equal) return { equal: false, reason: `shape.html → ${s.diffPath}` }
    const st = styleArtifactEqual(a, b)
    if (!st.equal) return st
  }
  if (a.bindings.length !== b.bindings.length)
    return { equal: false, reason: `binding count: ${a.bindings.length} vs ${b.bindings.length}` }
  if (!pathsEqual(a, b)) return { equal: false, reason: 'bindingPaths mismatch' }
  for (let i = 0; i < a.bindings.length; i++) {
    const r = bindingEqual(a.bindings[i] as Binding, b.bindings[i] as Binding, i, a, b, doc)
    if (!r.equal) return r
  }
  return { equal: true, reason: '' }
}
