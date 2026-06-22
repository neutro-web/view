/**
 * nv Build Pipeline — Module Emitter (Mode A)
 * Stream: (3) Renderer/templating
 * Spec: docs/design/build-pipeline-modeA-spec.md §5
 *
 * emitModule(results) → ES module source text.
 *
 * Per component, emits:
 *   1. moduleScope verbatim (top-level imports + non-$component statements)
 *   2. A named export factory function `export function Name() { ... }`
 *      Body: inlined erased $script, returns IR literal directly. No createRoot.
 *      Sugar: Name.mount = (parent, doc, props?, slots?) => mount(Name(...), parent, doc)
 *
 * Imports: only primitives referenced in $script (core) + mount (renderer).
 *          Uses @neutro/view/* published-surface aliases.
 *
 * Throws if any result has an error-level diagnostic (§7).
 */

import type {
  AttrBinding,
  Binding,
  ComponentBinding,
  ConditionalBinding,
  EventBinding,
  PropBinding,
  SlotOutletBinding,
  TemplateIR,
} from './ir.js'
import type { NvComponentResult, ThunkSource } from './nv-parser.js'

// ── Core primitives that may appear in $script ────────────────────────────────

const CORE_PRIMITIVES = new Set([
  'signal',
  'derived',
  'effect',
  'sync',
  'pubsub',
  'errorBoundary',
  'batch',
  'untrack',
  'flushSync',
])

// ── Thunk source emission ─────────────────────────────────────────────────────

type LeafThunkSource = Extract<ThunkSource, { kind: 'text' | 'attr' | 'prop' | 'event' }>

/** Emit a leaf thunk source (text/attr/prop/event). Structural kinds are handled by emitBindingLiteral directly. */
function emitThunkSource(thunk: LeafThunkSource, indent: string): string {
  void indent
  switch (thunk.kind) {
    case 'text':
    case 'attr':
    case 'prop':
      return `() => (${thunk.exprSrc})`
    case 'event':
      return `() => (${thunk.handlerSrc})`
  }
}

// ── IR literal emission ───────────────────────────────────────────────────────

function emitNodePath(path: readonly number[]): string {
  return `[${path.join(', ')}]`
}

function emitBindingLiteral(
  binding: Binding,
  thunk: ThunkSource,
  ir: TemplateIR,
  indent: string,
): string {
  void ir
  const pathEntry = `pathIndex: ${binding.pathIndex}`
  switch (binding.kind) {
    case 'text':
      return `{ kind: 'text', ${pathEntry}, expr: ${emitThunkSource(thunk as LeafThunkSource, indent)} }`
    case 'attr':
      return `{ kind: 'attr', ${pathEntry}, name: ${JSON.stringify((binding as AttrBinding).name)}, expr: ${emitThunkSource(thunk as LeafThunkSource, indent)} }`
    case 'prop':
      return `{ kind: 'prop', ${pathEntry}, name: ${JSON.stringify((binding as PropBinding).name)}, expr: ${emitThunkSource(thunk as LeafThunkSource, indent)} }`
    case 'event':
      return `{ kind: 'event', ${pathEntry}, eventName: ${JSON.stringify((binding as EventBinding).eventName)}, handlerKind: 'reactive', handler: ${emitThunkSource(thunk as LeafThunkSource, indent)} }`
    case 'conditional': {
      const cb = binding as ConditionalBinding
      if (thunk.kind !== 'conditional')
        throw new Error('[nv/emitter] ConditionalBinding thunk kind mismatch')
      const i2 = `${indent}  `
      const altLiteral =
        cb.alternate === null ? 'null' : emitIrLiteral(cb.alternate, thunk.alternate ?? [], i2)
      return [
        `{ kind: 'conditional', ${pathEntry},`,
        `${i2}condition: () => (${thunk.conditionSrc}),`,
        `${i2}consequent: ${emitIrLiteral(cb.consequent, thunk.consequent, i2)},`,
        `${i2}alternate: ${altLiteral} }`,
      ].join('\n')
    }
    case 'component': {
      if (thunk.kind !== 'component')
        throw new Error('[nv/emitter] ComponentBinding thunk kind mismatch')
      const cb = binding as ComponentBinding
      const i2 = `${indent}  `
      const propLiterals = cb.props
        .map((p, idx) => {
          const pSrc = thunk.propSrcs[idx]
          if (!pSrc)
            throw new Error(`[nv/emitter] Missing propSrc for prop '${p.name}' at index ${idx}`)
          return `{ name: ${JSON.stringify(p.name)}, expr: () => (${pSrc.exprSrc}) }`
        })
        .join(', ')
      const slotLiterals = cb.slots
        .map((s, idx) => {
          const slotThunks = thunk.slots[idx]?.thunks ?? []
          return `{ name: ${JSON.stringify(s.name)}, content: ${emitIrLiteral(s.content, slotThunks, i2)} }`
        })
        .join(', ')
      return [
        `{ kind: 'component', ${pathEntry},`,
        `${i2}component: ${thunk.componentSrc},`,
        `${i2}props: [${propLiterals}],`,
        `${i2}propNames: ${JSON.stringify(cb.propNames)},`,
        `${i2}slots: [${slotLiterals}] }`,
      ].join('\n')
    }
    case 'slot-outlet': {
      const sob = binding as SlotOutletBinding
      const parts = [`kind: 'slot-outlet'`, pathEntry, `name: ${JSON.stringify(sob.name)}`]
      if (sob.fallback !== undefined) {
        if (thunk.kind !== 'slot-outlet')
          throw new Error('[nv/emitter] SlotOutletBinding thunk kind mismatch')
        const fallbackThunks = thunk.fallbackThunks ?? []
        parts.push(`fallback: ${emitIrLiteral(sob.fallback, fallbackThunks, indent)}`)
      }
      return `{ ${parts.join(', ')} }`
    }
    default:
      throw new Error(
        `[nv/emitter] Unsupported binding kind for emit: ${(binding as Binding).kind}`,
      )
  }
}

function emitIrLiteral(ir: TemplateIR, thunks: ThunkSource[], indent: string): string {
  const bindingPaths = ir.shape.bindingPaths.map((p) => emitNodePath(p)).join(', ')
  const i4 = `${indent}    `
  const bindingsStr = ir.bindings
    .map((b, i) => {
      const thunk = thunks[i]
      if (thunk === undefined) throw new Error(`[nv/emitter] Missing thunk for binding ${i}`)
      return `${i4}${emitBindingLiteral(b, thunk, ir, i4)}`
    })
    .join(',\n')
  const bindingsBody = ir.bindings.length > 0 ? `\n${bindingsStr}\n${indent}  ` : ''
  return [
    '{',
    `${indent}  id: ${JSON.stringify(ir.id)},`,
    `${indent}  shape: { html: ${JSON.stringify(ir.shape.html)}, bindingPaths: [${bindingPaths}] },`,
    `${indent}  bindings: [${bindingsBody}],`,
    `${indent}}`,
  ].join('\n')
}

// ── Primitive detection ───────────────────────────────────────────────────────

function detectUsedPrimitives(scriptBody: string): string[] {
  return [...CORE_PRIMITIVES].filter((prim) => {
    // Match as word boundary — avoid false positives like 'signalSomething'
    const re = new RegExp(`\\b${prim}\\b`)
    return re.test(scriptBody)
  })
}

// ── Component factory emission ────────────────────────────────────────────────

function emitComponentFactory(result: NvComponentResult): string {
  const emit = result.emit
  if (!emit) throw new Error(`[nv/emitter] Component '${result.name}' has no emit payload`)

  const scriptLines = emit.scriptBody
    ? emit.scriptBody
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n')
    : ''

  const irLiteral = emitIrLiteral(result.ir, emit.bindingThunks, '  ')
  const scriptSection = scriptLines ? `${scriptLines}\n` : ''
  const name = result.name

  return [
    `export function ${name}(props, slots) {`,
    `${scriptSection}  return ${irLiteral}`,
    '}',
    `${name}.mount = (parent, doc, props = {}, slots = {}) =>`,
    `  mount(${name}(props, slots), parent, doc)`,
    '',
  ].join('\n')
}

// ── Module imports emission ───────────────────────────────────────────────────

function emitImports(results: NvComponentResult[]): string {
  const allScriptBodies = results.map((r) => r.emit?.scriptBody ?? '').join('\n')
  const usedPrimitives = detectUsedPrimitives(allScriptBodies)

  const coreImports = [...usedPrimitives].sort()
  const lines: string[] = []
  if (coreImports.length > 0) {
    lines.push(`import { ${coreImports.join(', ')} } from '@neutro/view/core'`)
  }
  lines.push(`import { mount } from '@neutro/view/renderer'`)
  return lines.join('\n')
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Emit an ES module from parsed .nv component results.
 *
 * @param results  Output of parseNvFileForEmit (must have emit payload)
 * @returns        ES module source text
 * @throws         If any result has an error-level diagnostic
 */
export function emitModule(results: NvComponentResult[]): string {
  // §7: fail on error diagnostics
  for (const result of results) {
    for (const diag of result.diagnostics) {
      if (diag.kind === 'error') {
        throw new Error(`[nv/emitter] Build error: ${diag.message}`)
      }
    }
    if (!result.emit) {
      throw new Error(
        `[nv/emitter] Component '${result.name}' has no emit payload — use parseNvFileForEmit, not parseNvFile`,
      )
    }
  }

  if (results.length === 0) return ''

  const parts: string[] = []

  // Imports
  parts.push(emitImports(results))

  // Module scope (from first result — same source file)
  const moduleScope = results[0]?.emit?.moduleScope ?? ''
  if (moduleScope.trim()) {
    parts.push('')
    parts.push(moduleScope)
  }

  // One factory per component
  for (const result of results) {
    parts.push('')
    parts.push(emitComponentFactory(result))
  }

  return parts.join('\n')
}
