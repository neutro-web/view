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
 * Imports: only primitives referenced in $script (core) + mount (renderer/runtime).
 *          Uses @neutro/view/* published-surface aliases:
 *            @neutro/view/core          — reactive primitives
 *            @neutro/view/renderer/runtime — mount only; TS-compiler-free (split from fat barrel)
 *
 * Throws if any result has an error-level diagnostic (§7).
 */

import { signal } from '../core/core.js'
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
  SyncBinding,
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
          const slotThunkEntry = thunk.slots[idx]
          const slotHoleThunks = slotThunkEntry?.thunks ?? []
          // s.content is SlotContent (factory); call with empty props to get the raw IR for emission.
          // The emitted literal wraps it back as a factory: (slotProps) => <ir literal> when scoped,
          // or (_props) => <ir literal> when unscoped.
          const slotIR = s.content({})
          const letNames = slotThunkEntry?.letNames ?? []
          const factoryParam = letNames.length > 0 ? 'slotProps' : '_props'
          const irLiteral = emitIrLiteral(slotIR, slotHoleThunks, i2)
          return `{ name: ${JSON.stringify(s.name)}, content: (${factoryParam}) => ${irLiteral} }`
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
      if (sob.props !== undefined && sob.props.length > 0) {
        if (thunk.kind !== 'slot-outlet')
          throw new Error('[nv/emitter] SlotOutletBinding thunk kind mismatch')
        const propLiterals = sob.props
          .map((p, idx) => {
            const propThunk = thunk.props?.[idx]
            if (!propThunk)
              throw new Error(
                `[nv/emitter] Missing prop thunk for slot-outlet prop '${p.name}' at index ${idx}`,
              )
            return `{ name: ${JSON.stringify(p.name)}, expr: () => (${propThunk.exprSrc}) }`
          })
          .join(', ')
        parts.push(`props: [${propLiterals}]`)
      }
      if (sob.fallback !== undefined) {
        if (thunk.kind !== 'slot-outlet')
          throw new Error('[nv/emitter] SlotOutletBinding thunk kind mismatch')
        const fallbackThunks = thunk.fallbackThunks ?? []
        parts.push(`fallback: ${emitIrLiteral(sob.fallback, fallbackThunks, indent)}`)
      }
      return `{ ${parts.join(', ')} }`
    }
    case 'list': {
      if (thunk.kind !== 'list') throw new Error('[nv/emitter] ListBinding thunk kind mismatch')
      const lb = binding as ListBinding
      const i2 = `${indent}  `
      // Get body IR structure by calling itemTemplate with stub signals (structure only; thunks come from bodyThunks)
      const stubVs = signal<unknown>(null)
      const stubIs = signal<number>(0)
      const bodyIR = lb.itemTemplate(stubVs, stubIs)
      const bodyLiteral = emitIrLiteral(bodyIR, thunk.bodyThunks, i2)
      // letNames default to ['item', 'index'] if empty; first name maps to valueSig, second to indexSig
      const [itemName = 'item', indexName = 'index'] = thunk.letNames
      const readsIndex =
        process.env.NV_DISABLE_INDEX_ELISION === '1' ? true : thunk.itemReadsIndex !== false
      const slotPropsBody = readsIndex
        ? `{ ${itemName}: () => valueSig(), ${indexName}: () => indexSig() }`
        : `{ ${itemName}: () => valueSig() }`
      const factorySig = readsIndex ? '(valueSig, indexSig)' : '(valueSig)'
      return [
        `{ kind: 'list', ${pathEntry},`,
        `${i2}items: () => (${thunk.itemsSrc}),`,
        `${i2}key: ${thunk.keySrc},`,
        `${i2}itemReadsIndex: ${readsIndex},`,
        `${i2}itemTemplate: ${factorySig} => ((slotProps) => (${bodyLiteral}))(${slotPropsBody}) }`,
      ].join('\n')
    }
    case 'classlist': {
      if (thunk.kind !== 'classlist')
        throw new Error('[nv/emitter] ClassListBinding thunk kind mismatch')
      const clb = binding as ClassListBinding
      const entryLiterals = clb.entries
        .map((entry, idx) => {
          const thunkEntry = thunk.entries[idx]
          if (!thunkEntry)
            throw new Error(`[nv/emitter] Missing classlist entry thunk at index ${idx}`)
          if (entry.kind === 'static') {
            return `{ kind: 'static', token: ${JSON.stringify(entry.token)} }`
          }
          // toggle entry: emit expr as a thunk
          if (thunkEntry.kind !== 'toggle')
            throw new Error('[nv/emitter] ClassListBinding entry kind mismatch')
          return `{ kind: 'toggle', key: ${JSON.stringify(entry.key)}, expr: () => (${thunkEntry.boolSrc}) }`
        })
        .join(', ')
      return `{ kind: 'classlist', ${pathEntry}, entries: [${entryLiterals}] }`
    }
    case 'style-var': {
      if (thunk.kind !== 'style-var')
        throw new Error('[nv/emitter] StyleVarBinding thunk kind mismatch')
      const svb = binding as StyleVarBinding
      return `{ kind: 'style-var', ${pathEntry}, varName: ${JSON.stringify(svb.varName)}, expr: () => (${thunk.exprSrc}) }`
    }
    case 'sync': {
      if (thunk.kind !== 'sync') throw new Error('[nv/emitter] SyncBinding thunk kind mismatch')
      const sb = binding as SyncBinding
      const parts: string[] = [
        `kind: 'sync'`,
        pathEntry,
        `propName: ${JSON.stringify(sb.propName)}`,
        `readExpr: () => (${thunk.readExprSrc})`,
        `eventName: ${JSON.stringify(thunk.eventName)}`,
        // writeTarget: emit the BARE signal identifier (live accessor in scriptBody scope).
        // NOT a thunk-over-value — sync() needs the accessor object for nodeForFn lookup.
        `writeTarget: ${thunk.writeTargetSrc}`,
      ]
      if (thunk.transformSrc !== undefined) {
        parts.push(`transform: ${thunk.transformSrc}`)
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
  // Use a separate cursor for thunks: pure-static classlist bindings (from
  // liftStaticClassBindings) have no thunk and must not advance the cursor.
  let thunkIdx = 0
  const bindingsStr = ir.bindings
    .map((b) => {
      // Pure-static classlist — emit directly, no thunk slot consumed.
      if (
        b.kind === 'classlist' &&
        (b as ClassListBinding).entries.every((e) => e.kind === 'static')
      ) {
        const clb = b as ClassListBinding
        const entries = clb.entries
          .map(
            (e) =>
              `{ kind: 'static', token: ${JSON.stringify((e as { kind: 'static'; token: string }).token)} }`,
          )
          .join(', ')
        return `${i4}{ kind: 'classlist', pathIndex: ${clb.pathIndex}, entries: [${entries}] }`
      }
      const thunk = thunks[thunkIdx++]
      if (thunk === undefined)
        throw new Error(`[nv/emitter] Missing thunk for binding (thunk index ${thunkIdx - 1})`)
      return `${i4}${emitBindingLiteral(b, thunk, ir, i4)}`
    })
    .join(',\n')
  const bindingsBody = ir.bindings.length > 0 ? `\n${bindingsStr}\n${indent}  ` : ''
  const parts = [
    '{',
    `${indent}  id: ${JSON.stringify(ir.id)},`,
    `${indent}  shape: { html: ${JSON.stringify(ir.shape.html)}, bindingPaths: [${bindingPaths}] },`,
    `${indent}  bindings: [${bindingsBody}],`,
  ]
  if (ir.styleArtifact) {
    parts.push(
      `${indent}  styleArtifact: { staticCss: ${JSON.stringify(ir.styleArtifact.staticCss)}, scopeHash: ${JSON.stringify(ir.styleArtifact.scopeHash)} },`,
    )
  }
  if (ir.classRewrites && ir.classRewrites.size > 0) {
    const entries = [...ir.classRewrites.entries()]
      .map(([k, v]) => `[${JSON.stringify(k)}, ${JSON.stringify(v)}]`)
      .join(', ')
    parts.push(`${indent}  classRewrites: new Map([${entries}]),`)
  }
  parts.push(`${indent}}`)
  return parts.join('\n')
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
  lines.push(`import { mount } from '@neutro/view/renderer/runtime'`)
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
