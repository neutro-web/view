/**
 * nv .nv File Front-End
 * Stream: (3) Renderer/templating
 * IR contract: nv-template-ir.md v0.2
 *
 * ── $script erasure — complete spec ─────────────────────────────────────────
 *
 * $script performs FULL bare-read erasure everywhere in the block:
 *   bare-read `count`  →  `count()`      (everywhere, no function-boundary stop)
 *   simple assignment  `x = expr`  →  `x.set(erasedExpr)`  (signal only)
 *   compound assignment `x op= expr` → `x.set(x() op erasedExpr)` (signal only)
 *   assignment to derived → DIAGNOSTIC ERROR (deriveds are read-only)
 *
 * Write safety: signal set ≠ derived set.
 *   Signals (signal()): writable — mutation-writes are rewritten.
 *   Deriveds (derived()): read-only — mutation-writes produce a diagnostic, not .set().
 *   BOTH produce reactive bare reads, BOTH produce ACCEPT verdicts in holes.
 *   Read false-positives (ACCEPT on a non-reactive hole) are safe — an unnecessary
 *   effect wastes CPU but produces correct output. Write false-positives (rewriting
 *   a non-signal assignment) are bugs — never acceptable.
 *
 * Shadowing: scope-aware walk. A local variable declaration with the same name as
 * a signal (in a nested function scope) shadows the signal. Within that scope:
 *   - Assignments to the local name are NOT rewritten (would be a write false-positive).
 *   - Reads of the local name are NOT bare-read erased.
 *   The signal's bare reads and mutation-writes outside the shadowing scope proceed
 *   normally. Read false-positives on shadowed locals are acceptable; write false-
 *   positives are not, so shadowing detection is required for writes.
 *
 * v0 limitations:
 *   - Compound assignment operators other than `op=` forms are not detected.
 *   - Shorthand property names `{ count }` are not bare-read erased (complex
 *     transformation required; write `{ count: count() }` explicitly).
 *   - Block-scoped shadowing is tracked for `let`/`const` at the top level of
 *     each block. `for (const x of ...)` loop variables are NOT tracked.
 *     `var` hoisting is tracked at function scope.
 *
 * ── exprReadsSignal direction ────────────────────────────────────────────────
 *
 * ACCEPT-biased (over-report); never under-reports.
 *   PLAIN on a reactive hole → stale DOM (correctness bug).
 *   ACCEPT on a static hole → unnecessary effect (CPU waste, correctness fine).
 * Does not stop at nested function boundaries. Both signal() and derived() names
 * produce ACCEPT — both are reactive reads, even though only signals are writable.
 *
 * ── Expressiveness boundary — ChildBinding v0 ────────────────────────────────
 *
 * Text-position holes → TextBinding. ChildBinding requires manual IR (both FEs).
 */

import * as ts from 'typescript'
import { signal } from '../core/core.js'
import type {
  AttrBinding,
  Binding,
  ClassListBinding,
  ClassListEntry,
  ComponentBinding,
  ConditionalBinding,
  DeferredSwapBinding,
  EventBinding,
  HandlerExpr,
  ListBinding,
  NodePath,
  PropBinding,
  PropEntry,
  ReactiveExpr,
  RecycledListBinding,
  SlotContent,
  SlotEntry,
  SlotOutletBinding,
  StyleVarBinding,
  SwitchBinding,
  SyncBinding,
  TemplateIR,
  TemplateShape,
  TextBinding,
  WritableSignal,
} from './ir.js'
import { classifyStyleKey } from './style-classify.js'

// ── Public types ──────────────────────────────────────────────────────────────

export interface NvDiagnostic {
  kind: 'error' | 'warning'
  message: string
  /** Absolute source positions in the .nv source text. */
  start: number
  end: number
}

// ── Emit types (build pipeline §6) ───────────────────────────────────────────

/**
 * Per-binding erased thunk source for the build pipeline.
 * Index-aligned with ir.bindings.
 */
export type ThunkSource =
  | { kind: 'text' | 'attr' | 'prop'; exprSrc: string }
  | { kind: 'event'; handlerSrc: string }
  | {
      kind: 'sync'
      readExprSrc: string // read-erased expression: val()
      writeTargetSrc: string // bare identifier: val (NOT erased)
      eventName: string // defaultEventForProp(propName)
      transformSrc?: string // optional transform source (for future explicit transform support)
    }
  | {
      kind: 'slot-outlet'
      name: string
      props?: Array<{ name: string; exprSrc: string }>
      fallbackThunks?: ThunkSource[]
    }
  | {
      kind: 'conditional'
      conditionSrc: string
      consequent: ThunkSource[]
      alternate: ThunkSource[] | null
    }
  | {
      kind: 'component'
      componentSrc: string
      propSrcs: Array<{ name: string; exprSrc: string }>
      propNames: readonly string[]
      slots: Array<{
        name: string
        holeIndices: number[]
        thunks: ThunkSource[]
        letNames?: readonly string[]
      }>
    }
  | {
      kind: 'list'
      itemsSrc: string
      keySrc: string
      bodyThunks: ThunkSource[]
      bodyComponentThunks: ThunkSource[]
      bodyListThunks: ThunkSource[]
      bodyRecycledListThunks: ThunkSource[]
      bodySwitchThunks: ThunkSource[]
      letNames: string[]
      itemReadsIndex: boolean
    }
  | {
      kind: 'recycled-list'
      itemsSrc: string // erased source text for the items expression
      bodyThunks: ThunkSource[] // thunks for the item body template holes
      bodyComponentThunks: ThunkSource[]
      bodyListThunks: ThunkSource[]
      bodyRecycledListThunks: ThunkSource[]
      bodySwitchThunks: ThunkSource[]
      letNames: [string, string] // [itemName, indexName] — both always present
    }
  | {
      kind: 'switch'
      branches: Array<{
        whenSrc: string
        bodyThunks: ThunkSource[]
        bodyComponentThunks: ThunkSource[]
        bodyListThunks: ThunkSource[]
        bodyRecycledListThunks: ThunkSource[]
        bodySwitchThunks: ThunkSource[]
      }>
      fallbackThunks: ThunkSource[] | null
      fallbackComponentThunks: ThunkSource[]
      fallbackListThunks: ThunkSource[]
      fallbackRecycledListThunks: ThunkSource[]
      fallbackSwitchThunks: ThunkSource[]
    }
  | {
      kind: 'classlist'
      entries: Array<
        { kind: 'static'; token: string } | { kind: 'toggle'; key: string; boolSrc: string }
      >
    }
  | { kind: 'style-var'; exprSrc: string }

/** Emit payload attached to NvComponentResult when using parseNvFileForEmit. */
export interface NvEmitPayload {
  /** Erased $script body — all $script block statements concatenated, in order. */
  scriptBody: string
  /** Per-binding erased thunk source, index-aligned with ir.bindings. */
  bindingThunks: ThunkSource[]
  /** Top-level imports and non-$component statements, verbatim from source. */
  moduleScope: string
}

export interface NvComponentResult {
  name: string
  ir: TemplateIR
  /** Combined list of signal() and derived() names from $script blocks. */
  scriptSignals: readonly string[]
  style: NvStyleInfo | null
  verdicts: ReadonlyArray<'ACCEPT' | 'PLAIN'>
  diagnostics: ReadonlyArray<NvDiagnostic>
  /** Present only when produced by parseNvFileForEmit. */
  emit?: NvEmitPayload
}

export interface NvStyleInfo {
  form: 'object' | 'factory'
  /** Static property keys only. Computed keys ([expr]: ...) are excluded — check hasComputedKeys. */
  keys: readonly string[]
  /** True if any property key was computed ([expr]: ...) — those keys are absent from `keys`. */
  hasComputedKeys: boolean
  /** Raw source text of the $style argument. For factory form, signal reads are NOT erased — use objExpr + eraseSignalReadsInNode for erased output. */
  source: string
  objExpr: ts.ObjectLiteralExpression
  factory?: ts.ArrowFunction | ts.FunctionExpression
}

// ── Internal types ────────────────────────────────────────────────────────────

interface Rewrite {
  start: number
  end: number
  replacement: string
}

/** Separated reactive variable sets for a $component's $script blocks. */
interface ScriptSymbols {
  /** signal() declarations — writable, mutation-writes are rewritten. */
  writable: ReadonlySet<string>
  /** derived() declarations — read-only, mutation-writes emit a diagnostic. */
  readonly: ReadonlySet<string>
  /** writable ∪ readonly — for bare-read erasure and ACCEPT/PLAIN verdicts. */
  all: ReadonlySet<string>
}

// ── Sentinel kind alternation ─────────────────────────────────────────────────

/** Complete set of nv sentinel attribute kinds — used in sentinel-strip regexes. */
const NV_SENTINEL_KINDS = '(?:attr|prop|sync|event|component)'

// ── Compound assignment operator map ─────────────────────────────────────────

/**
 * Maps compound assignment SyntaxKind tokens to their binary operator string.
 * `x op= e` expands to `x.set(x() op erasedExpr)`.
 */
const compoundOpMap = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.PlusEqualsToken, '+'],
  [ts.SyntaxKind.MinusEqualsToken, '-'],
  [ts.SyntaxKind.AsteriskEqualsToken, '*'],
  [ts.SyntaxKind.SlashEqualsToken, '/'],
  [ts.SyntaxKind.PercentEqualsToken, '%'],
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken, '**'],
  [ts.SyntaxKind.AmpersandEqualsToken, '&'],
  [ts.SyntaxKind.BarEqualsToken, '|'],
  [ts.SyntaxKind.CaretEqualsToken, '^'],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, '<<'],
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, '>>'],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, '>>>'],
  [ts.SyntaxKind.AmpersandAmpersandEqualsToken, '&&'],
  [ts.SyntaxKind.BarBarEqualsToken, '||'],
  [ts.SyntaxKind.QuestionQuestionEqualsToken, '??'],
])

// ── Position-level hole classification ───────────────────────────────────────

type PosKind =
  | { kind: 'text' }
  | { kind: 'attr'; name: string }
  | { kind: 'prop'; name: string }
  | { kind: 'event'; eventName: string }
  | { kind: 'sync'; propName: string }

function classifyPosition(prevString: string, nextString: string): PosKind {
  const isClosingQuote = nextString.startsWith('"') || nextString.startsWith("'")
  const em = prevString.match(/\s@([\w:-]+)=["']$/)
  if (em !== null && isClosingQuote) return { kind: 'event', eventName: em[1] as string }
  const pm = prevString.match(/\s\.([\w-]+)=["']$/)
  if (pm !== null && isClosingQuote) return { kind: 'prop', name: pm[1] as string }
  // SYNC: must come before bare-attr — /\s([\w:-]+)=["']$/ tolerates colons
  const sm = prevString.match(/\s:([\w-]+)=["']$/)
  if (sm !== null && isClosingQuote) return { kind: 'sync', propName: sm[1] as string }
  const am = prevString.match(/\s([\w:-]+)=["']$/)
  if (am !== null && isClosingQuote) return { kind: 'attr', name: am[1] as string }
  return { kind: 'text' }
}

// ── NodePath computation ──────────────────────────────────────────────────────

function computePath(node: Node, root: Node): NodePath {
  const path: number[] = []
  let current: Node = node
  while (current !== root) {
    const parent = current.parentNode
    if (parent === null) throw new Error('[nv/nv-parser] Node not descendant of root')
    let index = 0
    let sib: ChildNode | null = parent.firstChild
    while (sib !== null && sib !== current) {
      index++
      sib = sib.nextSibling
    }
    path.unshift(index)
    current = parent
  }
  return path
}

/** Slot-walk hole info for the .nv front-end — kind + origIdx (name for non-text). */
type NvSlotHoleInfo =
  | { kind: 'text'; origIdx: number }
  | { kind: 'attr'; origIdx: number; name: string }
  | { kind: 'prop'; origIdx: number; name: string }
  | { kind: 'event'; origIdx: number; name: string }
  | { kind: 'sync'; origIdx: number; propName: string }

/** Per-prop default event name for sync directives. */
function defaultEventForProp(prop: string): string {
  if (prop === 'checked') return 'change'
  return 'input'
}

/**
 * Shared per-hole binding constructor for the .nv front-end.
 * Used by BOTH the top-level and slot-content walks so the two cannot diverge.
 */
function buildNvHoleBinding(
  info: NvSlotHoleInfo,
  pathIndex: number,
  holeExpr: ts.Expression,
  doc: Document,
  signals: ReadonlySet<string>,
  stubExpr: ReactiveExpr<unknown>,
  stubHandler: HandlerExpr,
): Binding {
  if (info.kind === 'text') {
    // Check scoped slot outlet: expression is `slots.name({ item: expr, index: expr })` — CallExpression form.
    if (
      ts.isCallExpression(holeExpr) &&
      ts.isPropertyAccessExpression(holeExpr.expression) &&
      ts.isIdentifier(holeExpr.expression.expression) &&
      holeExpr.expression.expression.text === 'slots' &&
      ts.isIdentifier(holeExpr.expression.name)
    ) {
      const slotName = (holeExpr.expression.name as ts.Identifier).text
      const props: PropEntry[] = []
      const arg = holeExpr.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
            props.push({ name: (prop.name as ts.Identifier).text, expr: stubExpr })
          }
        }
      }
      const b: SlotOutletBinding = {
        kind: 'slot-outlet',
        pathIndex,
        name: slotName,
        ...(props.length > 0 && { props }),
      }
      return b
    }
    // Check slot outlet: expression is `slots.name` property access.
    const isSlotOutlet =
      ts.isPropertyAccessExpression(holeExpr) &&
      ts.isIdentifier(holeExpr.expression) &&
      holeExpr.expression.text === 'slots' &&
      ts.isIdentifier(holeExpr.name)
    if (isSlotOutlet) {
      const slotName = (holeExpr.name as ts.Identifier).text
      const b: SlotOutletBinding = { kind: 'slot-outlet', pathIndex, name: slotName }
      return b
    }
    // Check slot outlet with fallback: `slots.name ?? html\`...\``.
    if (
      ts.isBinaryExpression(holeExpr) &&
      holeExpr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const left = holeExpr.left
      const right = holeExpr.right
      const isHtmlTTE = (e: ts.Expression): e is ts.TaggedTemplateExpression =>
        ts.isTaggedTemplateExpression(e) && ts.isIdentifier(e.tag) && e.tag.text === 'html'
      if (
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.expression) &&
        left.expression.text === 'slots' &&
        ts.isIdentifier(left.name) &&
        isHtmlTTE(right)
      ) {
        const b: SlotOutletBinding = {
          kind: 'slot-outlet',
          pathIndex,
          name: (left.name as ts.Identifier).text,
          fallback: processHtmlTemplate(right, doc, signals).ir,
        }
        return b
      }
    }
    // Check conditional: ternary with html`` branches.
    if (ts.isConditionalExpression(holeExpr)) {
      const { whenTrue, whenFalse } = holeExpr
      const isHtmlTTE = (e: ts.Expression): e is ts.TaggedTemplateExpression =>
        ts.isTaggedTemplateExpression(e) && ts.isIdentifier(e.tag) && e.tag.text === 'html'
      const isNullish = (e: ts.Expression): boolean =>
        e.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(e) && (e.text === 'null' || e.text === 'undefined'))
      if (isHtmlTTE(whenTrue) && (isHtmlTTE(whenFalse) || isNullish(whenFalse))) {
        const b: ConditionalBinding = {
          kind: 'conditional',
          pathIndex,
          condition: stubExpr as ReactiveExpr<boolean>,
          consequent: processHtmlTemplate(whenTrue, doc, signals).ir,
          alternate: isHtmlTTE(whenFalse) ? processHtmlTemplate(whenFalse, doc, signals).ir : null,
        }
        return b
      }
    }
    return {
      kind: 'text',
      pathIndex,
      expr: stubExpr as ReactiveExpr<string | number | boolean | null | undefined>,
    }
  }
  if (info.kind === 'attr') {
    // ClassListBinding: class attr with object or array literal → structured class binding
    if (info.name === 'class') {
      if (ts.isObjectLiteralExpression(holeExpr)) {
        const entries: ClassListEntry[] = []
        let hasComputed = false
        for (const prop of holeExpr.properties) {
          if (
            ts.isComputedPropertyName(prop.name ?? (undefined as never)) ||
            ts.isShorthandPropertyAssignment(prop)
          ) {
            hasComputed = true
            break
          }
          if (ts.isPropertyAssignment(prop)) {
            const key = propertyKeyText(prop.name)
            if (key === null) {
              hasComputed = true
              break
            }
            for (const token of key.split(/\s+/).filter(Boolean)) {
              entries.push({ kind: 'toggle', key: token, expr: stubExpr as () => unknown })
            }
          }
        }
        if (!hasComputed) {
          const b: ClassListBinding = { kind: 'classlist', pathIndex, entries }
          return b
        }
      } else if (ts.isArrayLiteralExpression(holeExpr)) {
        const entries: ClassListEntry[] = []
        let hasComputed = false
        for (const element of holeExpr.elements) {
          if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
            for (const token of element.text.split(/\s+/).filter(Boolean)) {
              entries.push({ kind: 'static', token })
            }
          } else if (ts.isObjectLiteralExpression(element)) {
            for (const prop of element.properties) {
              if (
                ts.isComputedPropertyName(prop.name ?? (undefined as never)) ||
                ts.isShorthandPropertyAssignment(prop)
              ) {
                hasComputed = true
                break
              }
              if (ts.isPropertyAssignment(prop)) {
                const key = propertyKeyText(prop.name)
                if (key === null) {
                  hasComputed = true
                  break
                }
                for (const token of key.split(/\s+/).filter(Boolean)) {
                  entries.push({ kind: 'toggle', key: token, expr: stubExpr as () => unknown })
                }
              }
            }
            if (hasComputed) break
          } else {
            // Non-literal element in array → fall back to AttrBinding
            hasComputed = true
            break
          }
        }
        if (!hasComputed) {
          const b: ClassListBinding = { kind: 'classlist', pathIndex, entries }
          return b
        }
      }
    }
    return {
      kind: 'attr',
      pathIndex,
      name: info.name,
      expr: stubExpr as ReactiveExpr<string | number | boolean | null | undefined>,
    }
  }
  if (info.kind === 'prop') {
    return { kind: 'prop', pathIndex, name: info.name, expr: stubExpr }
  }
  if (info.kind === 'sync') {
    const b: SyncBinding = {
      kind: 'sync',
      pathIndex,
      propName: info.propName,
      readExpr: stubExpr as ReactiveExpr<unknown>,
      eventName: defaultEventForProp(info.propName),
      writeTarget: stubExpr as unknown as WritableSignal<unknown>,
    }
    return b
  }
  // event
  return {
    kind: 'event',
    pathIndex,
    eventName: info.name,
    handler: stubHandler,
    handlerKind: 'reactive',
  }
}

// ── Shared node-list walk (GATE-2 collapse, nv-parser) ─────────────────────────

/** A component element discovered during the walk (anchor path + captured slots). */
interface NvWalkedComponent {
  anchorPath: NodePath
  tagName: string
  propEntries: PropEntry[]
  propNames: string[]
  reactiveHoles: Array<{ name: string; holeIndex: number }>
  slots: SlotEntry[]
  slotHoleGroups: number[][]
  /** For each slot entry (index-aligned with slots), the let-bound names from `let={...}` attr. */
  slotLetNames: string[][]
}

/** Nested structural pendings discovered one level below a body/slot walk. */
interface NestedStructuralPending {
  components: PendingNvComponentInfo[]
  lists: PendingNvEachInfo[]
  recycles: PendingNvRecycleInfo[]
  switches: PendingNvSwitchInfo[]
}

interface NvWalkedEach {
  anchorPath: NodePath
  itemsHoleIdx: number
  keyHoleIdx: number
  letNames: string[]
  bodyIR: TemplateIR
  bodyHoleIndices: number[]
  /** Leaf-only subset of bodyHoleIndices — real hole bindings, excluding holes
   * consumed solely by a nested structural child's prop/.of/key/when. Used to
   * build bodyThunks (one per real hole binding), not the full consumed union. */
  bodyLeafHoleIndices: number[]
  itemReadsIndex: boolean
  nested: NestedStructuralPending
}

interface NvWalkedRecycle {
  anchorPath: NodePath
  itemsHoleIdx: number
  letNames: string[]
  bodyIR: TemplateIR
  bodyHoleIndices: number[]
  bodyLeafHoleIndices: number[]
  nested: NestedStructuralPending
}

interface NvWalkedMatchBranch {
  /** Hole index for the `when=` attribute, or -1 for the fallback (no `when=`). */
  whenHoleIdx: number
  bodyIR: TemplateIR
  bodyHoleIndices: number[]
  bodyLeafHoleIndices: number[]
  nested: NestedStructuralPending
}

interface NvWalkedSwitch {
  anchorPath: NodePath
  branches: NvWalkedMatchBranch[]
  /** True if the last branch has no `when=` (is the fallback). */
  hasFallback: boolean
  /** Hole index for the `pending=` attribute on <switch> itself, or -1 if absent
   * (plain `<switch>`, produces a SwitchBinding — unchanged path). */
  pendingHoleIdx: number
}

interface NvWalkResult {
  holeInfos: NvSlotHoleInfo[]
  holePaths: NodePath[]
  components: NvWalkedComponent[]
  consumed: Set<number>
  lists: NvWalkedEach[]
  recycledLists: NvWalkedRecycle[]
  switches: NvWalkedSwitch[]
}

/**
 * Walk a list of DOM nodes for sentinels (relative to `root`). Detects text holes,
 * attr/prop/event sentinels, AND component elements (capturing props + slot content
 * recursively via the same walk). This is the single walk shared by the top-level
 * template and slot content — the GATE-2 collapse (component-as-slot-child for free).
 */
function walkNvNodeList(
  nodes: Node[],
  holeExprs: ts.Expression[],
  doc: Document,
  root: Node,
  signals: ReadonlySet<string>,
  diagnostics: NvDiagnostic[] = [],
): NvWalkResult {
  const stubExpr = (() => undefined) as ReactiveExpr<unknown>
  const holeInfos: NvSlotHoleInfo[] = []
  const holePaths: NodePath[] = []
  const components: NvWalkedComponent[] = []
  const consumed = new Set<number>()
  const lists: NvWalkedEach[] = []
  const recycledLists: NvWalkedRecycle[] = []
  const switches: NvWalkedSwitch[] = []

  function walk(node: Node): void {
    if (node.nodeType === 8) {
      const m = (node as Comment).data.match(/^nv-(\d+)$/)
      if (m !== null) {
        const idx = Number.parseInt(m[1] as string, 10)
        holeInfos.push({ kind: 'text', origIdx: idx })
        holePaths.push(computePath(node, root))
      }
    } else if (node.nodeType === 1) {
      const el = node as Element

      // <each> element detection — before component detection.
      // After sentinelHtml rewrite, <each> appears as <template data-nv-each> in the DOM.
      // <template> survives in all restricted-content parents (table/select etc.); body is in .content.
      if (el.tagName.toLowerCase() === 'template' && el.hasAttribute('data-nv-each')) {
        const eachEl = el as HTMLTemplateElement
        // Find .of and key hole indices from data sentinels
        let itemsHoleIdx = -1
        let keyHoleIdx = -1
        for (let k = 0; k < holeExprs.length; k++) {
          if (eachEl.getAttribute(`data-nv-prop-${k}`) === 'of') {
            itemsHoleIdx = k
            eachEl.removeAttribute(`data-nv-prop-${k}`)
            consumed.add(k)
          }
          if (eachEl.getAttribute(`data-nv-attr-${k}`) === 'key') {
            keyHoleIdx = k
            eachEl.removeAttribute(`data-nv-attr-${k}`)
            consumed.add(k)
          }
        }
        if (itemsHoleIdx === -1 || keyHoleIdx === -1) {
          throw new Error('[nv] <each> requires .of="${...}" and key="${...}" attributes')
        }

        // Extract let-bound names from let={item, index}.
        // JSDOM still splits unquoted `let={item, index}` into broken `let="{item,"` + `index}=""`
        // even inside a <template> element. To handle both quoted and unquoted forms, reassemble
        // the full value by collecting broken continuation attributes (attr names ending with '}').
        const rawLet = eachEl.getAttribute('let') ?? ''
        const brokenParts: string[] = []
        for (const attr of Array.from(eachEl.attributes)) {
          if (attr.name !== 'let' && attr.name.endsWith('}') && attr.value === '') {
            brokenParts.push(attr.name.slice(0, -1).trim())
          }
        }
        const fullLetValue =
          brokenParts.length > 0 ? `${rawLet}, ${brokenParts.join(', ')}` : rawLet
        const letNames = fullLetValue
          .replace(/[{}]/g, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)

        // Build body IR from template content (body is in .content, not direct childNodes)
        const bodyNodes = Array.from(eachEl.content.childNodes)
        const {
          ir: bodyIR,
          holeIndices: bodyHoleIndices,
          leafHoleIndices: bodyLeafHoleIndices,
          nested,
        } = buildNvSlotContentIR(
          bodyNodes,
          holeExprs,
          doc,
          `each:body:${lists.length}`,
          signals,
          letNames,
          undefined,
          true, // requireSingleRoot — list-item runtime tracks exactly one DOM node per item
        )
        for (const idx of bodyHoleIndices) consumed.add(idx)

        // Compute itemReadsIndex: true iff the body (not the key) references the index binding
        const indexName = letNames[1] // undefined if no second let-binding
        // Deliberately scans the full bodyHoleIndices union rather than the narrower
        // bodyLeafHoleIndices (introduced by the phantom-hole-thunk fix, see
        // computeBodyThunks above): a hole consumed solely by a nested structural
        // child's prop/.of/key/when can still reference the index binding, and we
        // want itemReadsIndex to stay true in that case too. This is conservative-
        // but-safe — at worst it allocates an unnecessary index signal when the
        // index is only referenced inside such a consumed hole and never in real
        // per-item DOM; it never produces wrong output.
        const itemReadsIndex =
          indexName === undefined
            ? false
            : bodyHoleIndices.some((idx) => {
                const e = holeExprs[idx]
                return e !== undefined && exprReadsSignal(e, new Set([indexName]))
              })

        // Replace <template data-nv-each> element with anchor comment
        const listIndex = lists.length
        const anchor = doc.createComment(`nv-list-${listIndex}`)
        if (eachEl.parentNode === null) {
          throw new Error('[nv] <each> element has no parent — cannot compute binding path')
        }
        eachEl.parentNode.replaceChild(anchor, eachEl)
        const anchorPath = computePath(anchor, root)

        lists.push({
          anchorPath,
          itemsHoleIdx,
          keyHoleIdx,
          letNames,
          bodyIR,
          bodyHoleIndices,
          bodyLeafHoleIndices,
          itemReadsIndex,
          nested,
        })
        return // don't recurse into <each> body (already processed via .content)
      }

      // <recycle> element detection — after <each> block, before component detection.
      if (el.tagName.toLowerCase() === 'template' && el.hasAttribute('data-nv-recycle')) {
        const recycleEl = el as HTMLTemplateElement
        // Extract .of hole index (required)
        let itemsHoleIdx = -1
        for (let k = 0; k < holeExprs.length; k++) {
          if (recycleEl.getAttribute(`data-nv-prop-${k}`) === 'of') {
            itemsHoleIdx = k
            recycleEl.removeAttribute(`data-nv-prop-${k}`)
            consumed.add(k)
          }
        }
        if (itemsHoleIdx === -1) {
          throw new Error('[nv] <recycle> requires .of="${...}" attribute')
        }
        // Footgun guard: <recycle key=...> is a hard error.
        for (let k = 0; k < holeExprs.length; k++) {
          if (recycleEl.getAttribute(`data-nv-attr-${k}`) === 'key') {
            throw new Error(
              '[nv] <recycle> does not take key= (position is identity; use <each key=> for keyed lists)',
            )
          }
        }
        if (recycleEl.hasAttribute('key')) {
          throw new Error(
            '[nv] <recycle> does not take key= (position is identity; use <each key=> for keyed lists)',
          )
        }
        // Also catch .key=${expr} (prop sentinel — data-nv-prop-K === 'key')
        for (let k = 0; k < holeExprs.length; k++) {
          if (recycleEl.getAttribute(`data-nv-prop-${k}`) === 'key') {
            throw new Error(
              '[nv] <recycle> does not take key= (position is identity; use <each key=> for keyed lists)',
            )
          }
        }

        // Extract let-bound names — same JSDOM broken-attr reassembly as <each>
        const rawLet = recycleEl.getAttribute('let') ?? ''
        const brokenParts: string[] = []
        for (const attr of Array.from(recycleEl.attributes)) {
          if (attr.name !== 'let' && attr.name.endsWith('}') && attr.value === '') {
            brokenParts.push(attr.name.slice(0, -1).trim())
          }
        }
        const fullLetValue =
          brokenParts.length > 0 ? `${rawLet}, ${brokenParts.join(', ')}` : rawLet
        const letNames = fullLetValue
          .replace(/[{}]/g, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)

        // Build body IR
        const bodyNodes = Array.from(recycleEl.content.childNodes)
        const {
          ir: bodyIR,
          holeIndices: bodyHoleIndices,
          leafHoleIndices: bodyLeafHoleIndices,
          nested,
        } = buildNvSlotContentIR(
          bodyNodes,
          holeExprs,
          doc,
          `recycle:body:${recycledLists.length}`,
          signals,
          letNames,
          undefined,
          true, // requireSingleRoot — recycled-list-item runtime tracks exactly one DOM node per item
        )
        // Add body hole indices to consumed so processHtmlTemplate skips the sentinel check
        // for holes that appear exclusively inside the body (they have no outer sentinel).
        // The itemsHoleIdx (.of) is already in consumed; body holes are a disjoint subset.
        for (const idx of bodyHoleIndices) consumed.add(idx)

        // Replace element with anchor comment
        const anchor = doc.createComment(`nv-recycled-list-${recycledLists.length}`)
        if (recycleEl.parentNode === null) {
          throw new Error('[nv] <recycle> element has no parent — cannot compute binding path')
        }
        recycleEl.parentNode.replaceChild(anchor, recycleEl)
        const anchorPath = computePath(anchor, root)

        recycledLists.push({
          anchorPath,
          itemsHoleIdx,
          letNames,
          bodyIR,
          bodyHoleIndices,
          bodyLeafHoleIndices,
          nested,
        })
        return
      }

      // <switch> element detection — after <recycle> block, before component detection.
      if (el.tagName.toLowerCase() === 'template' && el.hasAttribute('data-nv-switch')) {
        const switchEl = el as HTMLTemplateElement

        // Optional pending= attribute on <switch> itself (Gate-P Ruling 1: extend
        // <switch>, no new tag). Same extraction mechanism as when= below, but on the
        // <switch> element's own sentinel attrs rather than a <match> child's. Presence
        // forks the emitted binding to DeferredSwapBinding (pushSwitchBinding); absence
        // leaves the plain-SwitchBinding path byte-identical to before this attribute
        // existed (Finding G: zero-<match> validation below is unchanged either way).
        let pendingHoleIdx = -1
        for (let k = 0; k < holeExprs.length; k++) {
          if (switchEl.getAttribute(`data-nv-attr-${k}`) === 'pending') {
            pendingHoleIdx = k
            switchEl.removeAttribute(`data-nv-attr-${k}`)
            consumed.add(k)
          }
        }

        const matchChildren = Array.from(switchEl.content.children).filter(
          (c) => c.tagName.toLowerCase() === 'template' && c.hasAttribute('data-nv-match'),
        ) as HTMLTemplateElement[]

        if (matchChildren.length === 0) {
          // Intentional asymmetry vs. the tagged-template `match([], fallback)` form
          // (src/renderer/html-tag.ts), which accepts a zero-branch array as a
          // degenerate-but-valid call — different front-ends, different authoring
          // affordances. Do not "fix" one to match the other without a decision.
          throw new Error('[nv] <switch> requires at least one <match> child')
        }

        // Guard against stray non-<match> children being silently dropped when switchEl
        // is replaced by its anchor comment below — e.g. a bare <div> sibling of <match>,
        // or a <div> wrapping a nested <match> (which the matchChildren filter above
        // would never see, since it only inspects immediate .content.children).
        for (const child of Array.from(switchEl.content.children)) {
          const isMatchTemplate =
            child.tagName.toLowerCase() === 'template' && child.hasAttribute('data-nv-match')
          if (!isMatchTemplate) {
            throw new Error('[nv] <switch> children must all be <match> elements')
          }
        }

        // First pass: extract when= hole index (or -1 for fallback) per match child,
        // consuming the sentinel attribute. Validation is done over the FULL set of
        // fallback candidates before building any body IR, so "at most one fallback"
        // is checked independently of (and prior to) "fallback must be last" — a
        // <switch> with two fallback <match>es is always "too many fallbacks" first,
        // regardless of position.
        const whenHoleIdxs: number[] = matchChildren.map((matchEl) => {
          let whenHoleIdx = -1
          for (let k = 0; k < holeExprs.length; k++) {
            if (matchEl.getAttribute(`data-nv-attr-${k}`) === 'when') {
              whenHoleIdx = k
              matchEl.removeAttribute(`data-nv-attr-${k}`)
              consumed.add(k)
            }
          }
          return whenHoleIdx
        })

        const fallbackIndices = whenHoleIdxs
          .map((idx, i) => (idx === -1 ? i : -1))
          .filter((i) => i !== -1)

        if (fallbackIndices.length > 1) {
          throw new Error('[nv] <switch> may have at most one fallback <match> (no when=)')
        }
        const hasFallback = fallbackIndices.length === 1
        if (hasFallback && (fallbackIndices[0] as number) !== matchChildren.length - 1) {
          throw new Error('[nv] <switch> fallback <match> (no when=) must be the last child')
        }

        const branches: NvWalkedMatchBranch[] = matchChildren.map((matchEl, branchIdx) => {
          const whenHoleIdx = whenHoleIdxs[branchIdx] as number
          const bodyNodes = Array.from(matchEl.content.childNodes)
          const {
            ir: bodyIR,
            holeIndices: bodyHoleIndices,
            leafHoleIndices: bodyLeafHoleIndices,
            nested,
          } = buildNvSlotContentIR(
            bodyNodes,
            holeExprs,
            doc,
            `switch:branch:${switches.length}:${branchIdx}`,
            signals,
          )
          for (const idx of bodyHoleIndices) consumed.add(idx)

          return { whenHoleIdx, bodyIR, bodyHoleIndices, bodyLeafHoleIndices, nested }
        })

        const switchIndex = switches.length
        const anchor = doc.createComment(`nv-switch-${switchIndex}`)
        if (switchEl.parentNode === null) {
          throw new Error('[nv] <switch> element has no parent — cannot compute binding path')
        }
        switchEl.parentNode.replaceChild(anchor, switchEl)
        const anchorPath = computePath(anchor, root)

        switches.push({ anchorPath, branches, hasFallback, pendingHoleIdx })
        return // don't recurse into <switch> body (already processed via .content)
      }

      // Footgun guard: a stray <match> NOT consumed as a direct child of a <switch>
      // (e.g. <match> used bare, or nested more than one level inside <switch>) reaches
      // this point because <switch>'s own handling above only inspects its immediate
      // .content.children and returns without recursing further. Without this guard, an
      // unconsumed <template data-nv-match> would silently walk as an ordinary (empty,
      // invisible) <template> element — same class of silent-footgun the <recycle key=>
      // guard prevents elsewhere in this file. Fail loudly instead.
      if (el.tagName.toLowerCase() === 'template' && el.hasAttribute('data-nv-match')) {
        throw new Error('[nv] <match> is only valid as a direct child of <switch>')
      }

      // Component element detection via data-nv-component sentinel.
      const compName = el.getAttribute('data-nv-component')
      if (compName !== null) {
        el.removeAttribute('data-nv-component')
        const tagName = compName
        const propEntries: PropEntry[] = []
        const propNames: string[] = []
        const reactiveHoles: Array<{ name: string; holeIndex: number }> = []

        for (let k = 0; k < holeExprs.length; k++) {
          for (const atype of ['attr', 'prop', 'event', 'sync'] as const) {
            const v = el.getAttribute(`data-nv-${atype}-${k}`)
            if (v !== null) {
              el.removeAttribute(`data-nv-${atype}-${k}`)
              propEntries.push({ name: v, expr: stubExpr })
              propNames.push(v)
              reactiveHoles.push({ name: v, holeIndex: k })
              consumed.add(k)
            }
          }
        }

        // Gather static (plain) attributes on the component element.
        const staticAttrs = Array.from(el.attributes)
        for (const attr of staticAttrs) {
          const val = attr.value
          propEntries.push({ name: attr.name, expr: () => val })
          if (!propNames.includes(attr.name)) propNames.push(attr.name)
        }

        // Capture slot content via the SAME walk (component-as-slot-child).
        const slots: SlotEntry[] = []
        const slotHoleGroups: number[][] = []
        const slotLetNames: string[][] = []
        if (el.childNodes.length > 0) {
          const defaultNodes: Node[] = []
          const namedGroups = new Map<string, Node[]>()
          const namedLetNames = new Map<string, string[]>()

          for (const child of Array.from(el.childNodes)) {
            if (
              child.nodeType === 1 &&
              (child as Element).tagName.toLowerCase() === 'slot' &&
              (child as Element).hasAttribute('name')
            ) {
              const slotEl = child as Element
              const slotName = slotEl.getAttribute('name') as string
              namedGroups.set(slotName, Array.from(slotEl.childNodes))
              // Extract let={item, index} attribute for scoped slots
              const letAttr = slotEl.getAttribute('let')
              if (letAttr) {
                const identifiers = letAttr
                  .replace(/[{}]/g, '')
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                namedLetNames.set(slotName, identifiers)
              }
            } else {
              defaultNodes.push(child)
            }
          }

          const hasDefaultContent = defaultNodes.some(
            (n) => n.nodeType !== 3 || (n as Text).data.trim() !== '',
          )
          if (hasDefaultContent || defaultNodes.some((n) => n.nodeType === 8)) {
            const {
              ir: defaultIR,
              holeIndices,
              letNames: defaultLetNames,
            } = buildNvSlotContentIR(
              defaultNodes,
              holeExprs,
              doc,
              `slot:${tagName}:default`,
              signals,
              [],
              diagnostics,
            )
            const defaultContent: SlotContent = (_props) => defaultIR
            slots.push({ name: 'default', content: defaultContent })
            slotHoleGroups.push(holeIndices)
            slotLetNames.push(defaultLetNames)
            for (const idx of holeIndices) consumed.add(idx)
          }

          for (const [slotName, slotChildNodes] of namedGroups) {
            const slotLet = namedLetNames.get(slotName) ?? []
            const {
              ir: namedIR,
              holeIndices,
              letNames: namedLetNamesResult,
            } = buildNvSlotContentIR(
              slotChildNodes,
              holeExprs,
              doc,
              `slot:${tagName}:${slotName}`,
              signals,
              slotLet,
              diagnostics,
            )
            const namedContent: SlotContent = (_props) => namedIR
            slots.push({ name: slotName, content: namedContent })
            slotHoleGroups.push(holeIndices)
            slotLetNames.push(namedLetNamesResult)
            for (const idx of holeIndices) consumed.add(idx)
          }
        }

        const compIndex = components.length
        const anchor = doc.createComment(`nv-comp-${compIndex}`)
        if (el.parentNode === null) {
          throw new Error('[nv] component element has no parent — cannot compute binding path')
        }
        el.parentNode.replaceChild(anchor, el)
        const anchorPath = computePath(anchor, root)
        components.push({
          anchorPath,
          tagName,
          propEntries,
          propNames,
          reactiveHoles,
          slots,
          slotHoleGroups,
          slotLetNames,
        })
        return // don't recurse into component children
      }

      for (let k = 0; k < holeExprs.length; k++) {
        for (const atype of ['attr', 'prop', 'event', 'sync'] as const) {
          const v = el.getAttribute(`data-nv-${atype}-${k}`)
          if (v !== null) {
            holeInfos.push(
              atype === 'attr'
                ? { kind: 'attr', origIdx: k, name: v }
                : atype === 'prop'
                  ? { kind: 'prop', origIdx: k, name: v }
                  : atype === 'sync'
                    ? { kind: 'sync', origIdx: k, propName: v }
                    : { kind: 'event', origIdx: k, name: v },
            )
            holePaths.push(computePath(el, root))
            el.removeAttribute(`data-nv-${atype}-${k}`)
          }
        }
      }
    }
    let child = node.firstChild
    while (child !== null) {
      walk(child)
      child = child.nextSibling
    }
  }

  for (const n of nodes) walk(n)
  return { holeInfos, holePaths, components, consumed, lists, recycledLists, switches }
}

// ── Slot content IR builder (collapse: uses walkNvNodeList) ────────────────────

/**
 * Lift all `class=` attributes from elements under `root` into ClassListBinding entries.
 * Strips the `class` attr from each element so shape.html carries no class= after this call.
 * Must run AFTER walkNvNodeList (so anchor comments are in place) and BEFORE shape
 * serialization (innerHTML). Paths computed relative to `root` (same root as all other bindings).
 * Accepts ParentNode (DocumentFragment for main path; Element for slot path) — both have querySelectorAll.
 * D-SS-1: shared lift eliminates the patchClasslistTokens regex rewrite for component slot content.
 */
function liftStaticClassBindings(
  root: ParentNode,
  allPaths: NodePath[],
  bindings: Binding[],
): void {
  for (const el of Array.from(root.querySelectorAll('[class]')) as Element[]) {
    const classVal = el.getAttribute('class') ?? ''
    const tokens = classVal.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const pathIndex = allPaths.length
    allPaths.push(computePath(el as Node, root as Node))
    el.removeAttribute('class')
    bindings.push({
      kind: 'classlist',
      pathIndex,
      entries: tokens.map((token): ClassListEntry => ({ kind: 'static', token })),
    } satisfies ClassListBinding)
  }
}

/**
 * Push one <each> list binding into allPaths + bindings.
 * Shared by processHtmlTemplate (main) and buildNvSlotContentIR (slot) so both paths
 * produce structurally identical ListBinding shapes (D-SS-2: identity by construction).
 * Emits a warning diagnostic when no let={} bindings are present.
 */
function pushListBinding(
  wl: NvWalkedEach,
  allPaths: NodePath[],
  bindings: Binding[],
  diagnostics: NvDiagnostic[],
): void {
  if (wl.letNames.length === 0) {
    diagnostics.push({
      kind: 'warning',
      message:
        '<each> has no let={} bindings. Item and index will not be accessible in the body template. Add let={item} or let={item, index}.',
      start: 0,
      end: 0,
    })
  }
  const pathIndex = allPaths.length
  allPaths.push(wl.anchorPath)
  // PARSE-PATH ONLY: structural IR shape for FE-equivalence checking.
  // itemTemplate returns the captured bodyIR by ref (same G2 by-ref fragility as component slots).
  bindings.push({
    kind: 'list',
    pathIndex,
    items: (() => []) as () => readonly unknown[],
    key: ((_item: unknown, i: number) => i) as (item: unknown, i: number) => string | number,
    itemTemplate: (_valueSig, _indexSig?) => wl.bodyIR,
    itemReadsIndex: wl.itemReadsIndex,
  } satisfies ListBinding)
}

/**
 * Push one <recycle> list binding into allPaths + bindings.
 * Standalone — does NOT call pushListBinding.
 *
 * PARSE-PATH ONLY — do not pass to mount().
 * The binding produced here is structural: itemTemplate throws to prevent accidental
 * execution outside the emit path. Callers needing the body IR must use .bodyIR
 * directly (e.g. patchClasslistTokens, emitBindingLiteral).
 */
function pushRecycledListBinding(
  wl: NvWalkedRecycle,
  allPaths: NodePath[],
  bindings: Binding[],
): void {
  const pathIndex = allPaths.length
  allPaths.push(wl.anchorPath)
  bindings.push({
    kind: 'recycled-list',
    pathIndex,
    items: (() => [] as readonly unknown[]) as ReactiveExpr<readonly unknown[]>,
    bodyIR: wl.bodyIR,
    itemTemplate: (_valueSig, _indexSig) => {
      throw new Error(
        '[nv] RecycledListBinding from parseNvFile is structural-only — use parseNvFileForEmit',
      )
    },
  } satisfies RecycledListBinding)
}

/**
 * Push one <switch> binding into allPaths + bindings.
 *
 * PARSE-PATH ONLY: `when` thunks are stubbed as `(() => false)` — structural IR shape
 * for FE-equivalence checking. Real reactive `when` thunks come from parseNvFileForEmit.
 */
function pushSwitchBinding(ws: NvWalkedSwitch, allPaths: NodePath[], bindings: Binding[]): void {
  const pathIndex = allPaths.length
  allPaths.push(ws.anchorPath)
  const stubExpr = (() => false) as ReactiveExpr<boolean>
  const branchCount = ws.hasFallback ? ws.branches.length - 1 : ws.branches.length
  const branches = ws.branches
    .slice(0, branchCount)
    .map((b) => ({ when: stubExpr, body: b.bodyIR }))
  const fallback = ws.hasFallback
    ? (ws.branches[ws.branches.length - 1] as NvWalkedMatchBranch).bodyIR
    : null

  if (ws.pendingHoleIdx !== -1) {
    // Gate-P Ruling 1: pending= present on <switch> forks the emitted binding to
    // DeferredSwapBinding. `pending` thunk is stubbed the same way `when` is above —
    // this walk builds structural IR only; real reactive thunks come from
    // parseNvFileForEmit (see pushSwitchBinding's own PARSE-PATH ONLY note).
    bindings.push({
      kind: 'deferred-swap',
      pathIndex,
      pending: stubExpr,
      branches,
      fallback,
    } satisfies DeferredSwapBinding)
    return
  }

  bindings.push({
    kind: 'switch',
    pathIndex,
    branches,
    fallback,
  } satisfies SwitchBinding)
}

/**
 * Build a TemplateIR from sentinel-DOM nodes (slot content), via the SAME
 * walkNvNodeList used for the top-level template. Component elements in slot
 * content produce ComponentBindings (component-as-slot-child).
 *
 * pathIndex within the sub-IR is COMPACT (0-based, encounter order); hole bindings
 * first, component bindings appended. Returns the GLOBAL hole indices consumed.
 */
function buildNvSlotContentIR(
  slotNodes: Node[],
  holeExprs: ts.Expression[],
  doc: Document,
  slotId: string,
  signals: ReadonlySet<string>,
  letNames: string[] = [],
  diagnostics: NvDiagnostic[] = [],
  requireSingleRoot = false,
): {
  ir: TemplateIR
  holeIndices: number[]
  /** Leaf-only hole indices (real hole bindings) — a subset of holeIndices that
   * excludes indices consumed solely by a nested structural child's prop/.of/
   * key/when. Use this (not holeIndices) to build one bodyThunk per real hole. */
  leafHoleIndices: number[]
  letNames: string[]
  nested: NestedStructuralPending
} {
  const stubExpr = (() => undefined) as ReactiveExpr<unknown>
  const stubHandler = (() => (_e: Event) => undefined) as HandlerExpr

  if (slotNodes.length === 0) {
    return {
      ir: { id: slotId, shape: { html: '', bindingPaths: [] }, bindings: [] },
      holeIndices: [],
      leafHoleIndices: [],
      letNames,
      nested: { components: [], lists: [], recycles: [], switches: [] },
    }
  }

  // Extend signals set with letNames so slot-bound identifiers are treated as reactive.
  const slotSignals = letNames.length > 0 ? new Set([...signals, ...letNames]) : signals

  const fragWrapper = doc.createElement('div')
  for (const n of slotNodes) {
    fragWrapper.appendChild(n.cloneNode(true))
  }

  const {
    holeInfos,
    holePaths,
    components,
    consumed,
    lists: slotLists,
    recycledLists: slotRecycledLists,
    switches: slotSwitches,
  } = walkNvNodeList(
    Array.from(fragWrapper.childNodes),
    holeExprs,
    doc,
    fragWrapper,
    slotSignals,
    diagnostics,
  )

  // D-SS-1: lift static class= attrs into ClassListBinding entries BEFORE serialization.
  // This replaces the regex rewrite in patchClasslistTokens component case for slot content.
  // Paths computed relative to fragWrapper (same root as all holePaths and component anchorPaths).
  const allPaths: NodePath[] = [...holePaths]
  const preLiftBindings: Binding[] = []
  liftStaticClassBindings(fragWrapper, allPaths, preLiftBindings)

  // Single-root guard: list items (and other single-root-required contexts, e.g.
  // recycle-item bodies) require the mounted template to produce EXACTLY one
  // top-level DOM node. Normally that's the slot content's own single wrapping
  // element and we strip fragWrapper via innerHTML. But when a structural child
  // (component/each/switch/list) is consumed down to a BARE anchor comment with
  // no surrounding element — e.g. `<each ...><Row/></each>` with no wrapping tag
  // — fragWrapper.innerHTML collapses to just that comment, and the nested
  // child's own rendered content is inserted as a SIBLING of the anchor at mount
  // time (see wireComponent/wireList: content is inserted before the anchor,
  // which stays as a permanent marker). That produces >1 top-level node at mount
  // time even though this function only sees 1 (the comment) at emit time —
  // exactly the failure behind "[nv] Multi-root list items are not supported"
  // for component-only <each> bodies. Fix: keep fragWrapper itself (a real
  // element) as the single top-level root whenever the body doesn't already
  // resolve to exactly one top-level Element — same effect as hand-wrapping the
  // body in a <div> (a documented workaround), but automatic. All previously
  // computed paths are relative to fragWrapper's children, so they need a
  // leading 0 (fragWrapper is now childNodes[0] of the serialized root) — done
  // once, after all path arrays (holePaths/component/list/switch anchors) are
  // finalized below.
  const needsSyntheticRoot =
    requireSingleRoot &&
    (fragWrapper.childNodes.length !== 1 ||
      fragWrapper.firstChild?.nodeType !== 1) /* ELEMENT_NODE */

  const rawHtml = (needsSyntheticRoot ? fragWrapper.outerHTML : fragWrapper.innerHTML).replace(
    new RegExp(`\\s+data-nv-${NV_SENTINEL_KINDS}-\\d+="[^"]*"`, 'g'),
    '',
  )
  const bindings: Binding[] = [
    ...preLiftBindings,
    ...holeInfos.map((info, compactIdx) =>
      buildNvHoleBinding(
        info,
        compactIdx,
        holeExprs[info.origIdx] as ts.Expression,
        doc,
        signals,
        stubExpr,
        stubHandler,
      ),
    ),
  ]
  for (const c of components) {
    const pathIndex = allPaths.length
    allPaths.push(c.anchorPath)
    bindings.push(makeUnresolvedNvComponentBinding(pathIndex, c))
  }
  // Wire <each>-in-slot via the shared helper (D-SS-2: structural identity by construction).
  // OP-3: thread diagnostics to the parent's diagnostic channel.
  for (const wl of slotLists) {
    pushListBinding(wl, allPaths, bindings, diagnostics)
  }
  // Wire <recycle>-in-slot (D-SS-2: same structural path as lists), for both
  // component slot bodies and <each> item bodies — same call as the top-level path.
  for (const wl of slotRecycledLists) {
    pushRecycledListBinding(wl, allPaths, bindings)
  }
  // Wire <switch>-in-slot for component slot bodies (D-SS-2: same structural path as lists).
  for (const ws of slotSwitches) {
    pushSwitchBinding(ws, allPaths, bindings)
  }

  const leafHoleIndices = holeInfos.map((h) => h.origIdx)
  const holeIndices = [...leafHoleIndices, ...consumed].filter((v, i, a) => a.indexOf(v) === i)

  const nested = toPendingBundle(components, slotLists, slotRecycledLists, slotSwitches)

  // fragWrapper is now serialized as the literal root element (see needsSyntheticRoot
  // above) — every previously computed path was relative to fragWrapper's children,
  // so it must be re-rooted one level deeper: fragWrapper itself is childNodes[0] of
  // the freshly parsed template at mount time.
  const finalPaths = needsSyntheticRoot ? allPaths.map((p) => [0, ...p]) : allPaths

  return {
    ir: {
      id: slotId,
      shape: { html: rawHtml, bindingPaths: finalPaths },
      bindings,
      meta: { frontEnd: 'nv-file' },
    },
    holeIndices,
    leafHoleIndices,
    letNames,
    nested,
  }
}

/** Build a ComponentBinding whose factory throws if invoked (resolve via emit path). */
function makeUnresolvedNvComponentBinding(
  pathIndex: number,
  c: NvWalkedComponent,
): ComponentBinding {
  return {
    kind: 'component',
    pathIndex,
    component: (_props, _slots) => {
      throw new Error(
        `[nv] ComponentBinding for <${c.tagName}> has no resolved factory. Use the emit path (parseNvFileForEmit + emitModule) to resolve component factories from imports.`,
      )
    },
    props: c.propEntries,
    propNames: c.propNames,
    slots: c.slots,
  }
}

// ── Sentinel HTML builder ─────────────────────────────────────────────────────

function buildNvHtmlStrings(
  strings: readonly string[],
  positions: PosKind[],
): { sentinelHtml: string; shapeHtml: string } {
  let sentinelHtml = ''
  const quoteConsumedAt = new Set<number>()

  for (let i = 0; i < strings.length; i++) {
    let raw = strings[i] as string
    if (quoteConsumedAt.has(i)) raw = raw.replace(/^["']/, '')

    if (i < positions.length) {
      const pos = positions[i] as PosKind
      if (pos.kind === 'text') {
        sentinelHtml += `${raw}<!--nv-${i}-->`
      } else {
        let stripRe: RegExp
        let sentinelAttr: string
        if (pos.kind === 'attr') {
          stripRe = /(\s+)([\w:-]+)=["']$/
          sentinelAttr = `data-nv-attr-${i}="${pos.name}"`
        } else if (pos.kind === 'prop') {
          stripRe = /(\s+)\.([\w-]+)=["']$/
          sentinelAttr = `data-nv-prop-${i}="${pos.name}"`
        } else if (pos.kind === 'sync') {
          stripRe = /(\s+):([\w-]+)=["']$/
          sentinelAttr = `data-nv-sync-${i}="${pos.propName}"`
        } else {
          stripRe = /(\s+)@([\w:-]+)=["']$/
          sentinelAttr = `data-nv-event-${i}="${pos.eventName}"`
        }
        const m = raw.match(stripRe)
        if (m === null) {
          throw new Error(
            `[nv/nv-parser] Hole ${i} (${pos.kind}): no matching pattern at end of "${raw.slice(-50)}"`,
          )
        }
        sentinelHtml += `${raw.slice(0, raw.length - (m[0] as string).length)} ${sentinelAttr}`
        quoteConsumedAt.add(i + 1)
      }
    } else {
      sentinelHtml += raw
    }
  }

  // Inject data-nv-component sentinel for capitalized-tag elements so DFS walk can detect them.
  sentinelHtml = sentinelHtml.replace(
    /<([A-Z][\w-]*)(\s|\/|>)/g,
    (_, name: string, after: string) => `<${name} data-nv-component="${name}"${after}`,
  )

  const shapeHtml = sentinelHtml.replace(
    new RegExp(`\\s+data-nv-${NV_SENTINEL_KINDS}-\\d+="[^"]*"`, 'g'),
    '',
  )
  return { sentinelHtml, shapeHtml }
}

// ── Signal/derived read detection ─────────────────────────────────────────────

/**
 * ACCEPT-biased verdict for hole expressions. Does NOT stop at function
 * boundaries — any signal/derived name anywhere in the expression → ACCEPT.
 * Over-reports on shadowed locals (safe); never under-reports reactive reads (bug).
 * See module header for full rationale.
 */
function exprReadsSignal(expr: ts.Expression, signals: ReadonlySet<string>): boolean {
  if (signals.size === 0) return false
  let found = false
  ;(function walk(node: ts.Node): void {
    if (found) return
    if (ts.isIdentifier(node) && signals.has(node.text)) {
      found = true
      return
    }
    ts.forEachChild(node, walk)
  })(expr)
  return found
}

// ── Template processing ───────────────────────────────────────────────────────

interface PendingNvComponentInfo {
  tagName: string
  propNames: readonly string[]
  reactiveHoles: ReadonlyArray<{ name: string; holeIndex: number }>
  slots: SlotEntry[]
  /** For each slot entry (index-aligned with slots), the original hole indices in the parent template. */
  slotHoleGroups: ReadonlyArray<ReadonlyArray<number>>
  /** For each slot entry (index-aligned with slots), the let-bound names from `let={...}` attr. */
  slotLetNames?: ReadonlyArray<ReadonlyArray<string>>
}

interface PendingNvEachInfo {
  itemsHoleIdx: number
  keyHoleIdx: number
  letNames: string[]
  bodyHoleIndices: number[]
  bodyLeafHoleIndices: number[]
  itemReadsIndex: boolean
  nested: NestedStructuralPending
}

interface PendingNvRecycleInfo {
  itemsHoleIdx: number
  letNames: string[]
  bodyHoleIndices: number[]
  bodyLeafHoleIndices: number[]
  nested: NestedStructuralPending
}

interface PendingNvSwitchInfo {
  branches: Array<{
    whenHoleIdx: number
    bodyHoleIndices: number[]
    bodyLeafHoleIndices: number[]
    bodyIR: TemplateIR
    nested: NestedStructuralPending
  }>
  hasFallback: boolean
}

/** Convert one level of walk-result structural collections into Pending*Info. Shared
 * by the top-level ProcessResult return and buildNvSlotContentIR (body/slot walks). */
function toPendingBundle(
  components: NvWalkedComponent[],
  lists: NvWalkedEach[],
  recycledLists: NvWalkedRecycle[],
  switches: NvWalkedSwitch[],
): NestedStructuralPending {
  return {
    components: components.map(
      ({ tagName, propNames, reactiveHoles, slots, slotHoleGroups, slotLetNames }) => ({
        tagName,
        propNames,
        reactiveHoles,
        slots,
        slotHoleGroups,
        slotLetNames,
      }),
    ),
    lists: lists.map((wl) => ({
      itemsHoleIdx: wl.itemsHoleIdx,
      keyHoleIdx: wl.keyHoleIdx,
      letNames: wl.letNames,
      bodyHoleIndices: wl.bodyHoleIndices,
      bodyLeafHoleIndices: wl.bodyLeafHoleIndices,
      itemReadsIndex: wl.itemReadsIndex,
      nested: wl.nested,
    })),
    recycles: recycledLists.map((wl) => ({
      itemsHoleIdx: wl.itemsHoleIdx,
      letNames: wl.letNames,
      bodyHoleIndices: wl.bodyHoleIndices,
      bodyLeafHoleIndices: wl.bodyLeafHoleIndices,
      nested: wl.nested,
    })),
    switches: switches.map((ws) => ({
      branches: ws.branches.map((b) => ({
        whenHoleIdx: b.whenHoleIdx,
        bodyHoleIndices: b.bodyHoleIndices,
        bodyLeafHoleIndices: b.bodyLeafHoleIndices,
        bodyIR: b.bodyIR,
        nested: b.nested,
      })),
      hasFallback: ws.hasFallback,
    })),
  }
}

interface ProcessResult {
  ir: TemplateIR
  verdicts: Array<'ACCEPT' | 'PLAIN'>
  pendingComponents: PendingNvComponentInfo[]
  pendingEachItems: PendingNvEachInfo[]
  pendingRecycleItems: PendingNvRecycleInfo[]
  pendingSwitchItems: PendingNvSwitchInfo[]
  consumedByComponent: ReadonlySet<number>
  diagnostics: NvDiagnostic[]
  shapeHtml: string // pre-walk authored shape; B3 scopeHash seed
}

function processHtmlTemplate(
  tte: ts.TaggedTemplateExpression,
  doc: Document,
  signals: ReadonlySet<string>,
): ProcessResult {
  const template = tte.template
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    return {
      ir: {
        id: `nv:${simpleHash(template.text)}`,
        shape: { html: template.text, bindingPaths: [] },
        bindings: [],
        meta: { frontEnd: 'nv-file' },
      },
      verdicts: [],
      pendingComponents: [],
      pendingEachItems: [],
      pendingRecycleItems: [],
      pendingSwitchItems: [],
      consumedByComponent: new Set<number>(),
      diagnostics: [],
      shapeHtml: template.text,
    }
  }

  const strings: string[] = [template.head.text]
  const holeExprs: ts.Expression[] = []
  for (const span of template.templateSpans) {
    holeExprs.push(span.expression)
    strings.push(span.literal.text)
  }

  const positions: PosKind[] = holeExprs.map((_, i) =>
    classifyPosition(strings[i] ?? '', strings[i + 1] ?? ''),
  )

  const { sentinelHtml: rawSentinelHtml, shapeHtml } = buildNvHtmlStrings(strings, positions)

  // Rewrite <each …> → <template data-nv-each …> before innerHTML so HTML foster-parenting
  // rules don't eject <each> from table/select/etc. contexts. <template> is whitelisted in
  // all restricted-content parents and survives in place; the walker reads .content.childNodes.
  const sentinelHtml = rawSentinelHtml
    .replace(/<each(\s[^>]*)?>/g, (_, attrs) => `<template data-nv-each${attrs ?? ''}>`)
    .replace(/<\/each>/g, '</template>')
    .replace(/<recycle(\s[^>]*)?>/g, (_, attrs) => `<template data-nv-recycle${attrs ?? ''}>`)
    .replace(/<\/recycle>/g, '</template>')
    .replace(/<switch(\s[^>]*)?>/g, (_, attrs) => `<template data-nv-switch${attrs ?? ''}>`)
    .replace(/<\/switch>/g, '</template>')
    .replace(/<match(\s[^>]*)?>/g, (_, attrs) => `<template data-nv-match${attrs ?? ''}>`)
    .replace(/<\/match>/g, '</template>')

  const tmpl = doc.createElement('template')
  tmpl.innerHTML = sentinelHtml
  const frag = tmpl.content

  const stubExpr = (() => undefined) as ReactiveExpr<unknown>
  const stubHandler = (() => (_e: Event) => undefined) as HandlerExpr

  const bindingPaths: NodePath[] = new Array(holeExprs.length).fill(null)
  const processdiagnostics: NvDiagnostic[] = []

  // DFS walk to find sentinels — SAME walk used for slot content (GATE-2 collapse).
  const {
    holeInfos,
    holePaths,
    components: pendingComponents,
    consumed: consumedByComponent,
    lists: pendingLists,
    recycledLists: pendingRecycleLists,
    switches: pendingSwitches,
  } = walkNvNodeList(Array.from(frag.childNodes), holeExprs, doc, frag, signals, processdiagnostics)
  // Map encounter-order hole paths back to GLOBAL hole indices (top-level convention).
  for (let h = 0; h < holeInfos.length; h++) {
    bindingPaths[holeInfos[h]?.origIdx as number] = holePaths[h] as NodePath
  }

  for (let i = 0; i < holeExprs.length; i++) {
    if (!consumedByComponent.has(i) && bindingPaths[i] === null)
      throw new Error(
        `[nv/nv-parser] No sentinel for hole ${i}. Sentinel: ${sentinelHtml.slice(0, 200)}`,
      )
  }

  // Build compacted allPaths: skip null slots (consumed holes have no binding path).
  // holeCompactIdx[i] maps original hole index to its index in allPaths.
  const holeCompactIdx: number[] = new Array(holeExprs.length).fill(-1)
  const allPaths: NodePath[] = []
  for (let i = 0; i < bindingPaths.length; i++) {
    if (bindingPaths[i] !== null) {
      holeCompactIdx[i] = allPaths.length
      allPaths.push(bindingPaths[i] as NodePath)
    }
  }

  const bindings: Binding[] = []
  // verdicts[i] is indexed by HOLE position (0..holeExprs.length-1), NOT by binding position.
  // Consumed holes push 'PLAIN'. ComponentBindings have no verdict entry.
  // emitSetup keys verdicts by binding.pathIndex via a Map — do NOT zip with bindings positionally.
  const verdicts: Array<'ACCEPT' | 'PLAIN'> = []

  // Add component bindings (anchors appended after hole paths)
  for (const { anchorPath, tagName, propEntries, propNames, slots } of pendingComponents) {
    const pathIndex = allPaths.length
    allPaths.push(anchorPath)
    const cb: ComponentBinding = {
      kind: 'component',
      pathIndex,
      component: (_props, _slots) => {
        throw new Error(
          `[nv] ComponentBinding for <${tagName}> has no resolved factory. Use the emit path (parseNvFileForEmit + emitModule) to resolve component factories from imports.`,
        )
      },
      props: propEntries,
      propNames,
      slots,
    }
    bindings.push(cb)
  }

  // Add list bindings from <each> elements via shared helper (D-SS-2: structural identity).
  for (const wl of pendingLists) {
    pushListBinding(wl, allPaths, bindings, processdiagnostics)
  }

  // Add recycled list bindings from <recycle> elements.
  for (const wl of pendingRecycleLists) {
    pushRecycledListBinding(wl, allPaths, bindings)
  }

  // Add switch bindings from <switch> elements.
  for (const ws of pendingSwitches) {
    pushSwitchBinding(ws, allPaths, bindings)
  }

  for (let i = 0; i < holeExprs.length; i++) {
    if (consumedByComponent.has(i)) {
      verdicts.push('PLAIN')
      continue
    }
    const pos = positions[i] as PosKind
    const holeExpr = holeExprs[i] as ts.Expression
    const pathIndex = holeCompactIdx[i] as number
    verdicts.push(exprReadsSignal(holeExpr, signals) ? 'ACCEPT' : 'PLAIN')

    // Convert PosKind → NvSlotHoleInfo (event uses eventName field; normalize to name).
    const info: NvSlotHoleInfo =
      pos.kind === 'event'
        ? { kind: 'event', origIdx: i, name: pos.eventName }
        : pos.kind === 'text'
          ? { kind: 'text', origIdx: i }
          : pos.kind === 'sync'
            ? { kind: 'sync', origIdx: i, propName: pos.propName }
            : { kind: pos.kind, origIdx: i, name: pos.name }

    bindings.push(
      buildNvHoleBinding(info, pathIndex, holeExpr, doc, signals, stubExpr, stubHandler),
    )
  }

  // D-SS-1 (main path): lift static class= attrs into ClassListBinding entries on frag
  // BEFORE cloning to shapeDiv. allPaths use frag as root — same root as all other paths.
  // Using shapeDiv as root would produce wrong paths (path-root bug caught in Gate-P review).
  liftStaticClassBindings(frag, allPaths, bindings)

  // Re-serialize shape from post-walk fragment (component elements replaced by anchors, class= stripped)
  const shapeDiv = doc.createElement('div')
  shapeDiv.appendChild(frag.cloneNode(true))
  const reserializedShape = shapeDiv.innerHTML.replace(
    new RegExp(`\\s+data-nv-${NV_SENTINEL_KINDS}-\\d+="[^"]*"`, 'g'),
    '',
  ) // strip hole attr sentinels only

  const pendingBundle = toPendingBundle(
    pendingComponents,
    pendingLists,
    pendingRecycleLists,
    pendingSwitches,
  )

  return {
    ir: {
      id: `nv:${simpleHash(reserializedShape)}`,
      shape: { html: reserializedShape, bindingPaths: allPaths as NodePath[] },
      bindings,
      meta: { frontEnd: 'nv-file' },
    },
    verdicts,
    pendingComponents: pendingBundle.components,
    pendingEachItems: pendingBundle.lists,
    pendingRecycleItems: pendingBundle.recycles,
    pendingSwitchItems: pendingBundle.switches,
    consumedByComponent,
    diagnostics: processdiagnostics,
    shapeHtml,
  }
}

// ── Component body extraction ─────────────────────────────────────────────────

function isNvConstruct(call: ts.CallExpression, name: string): boolean {
  const c = call.expression
  return (
    (ts.isIdentifier(c) && c.text === name) ||
    (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.name) && c.name.text === name)
  )
}

function collectScriptSymbols(blocks: ts.Block[]): ScriptSymbols {
  const writable: string[] = []
  const readonly_: string[] = []
  for (const block of blocks) {
    for (const stmt of block.statements) {
      if (!ts.isVariableStatement(stmt)) continue
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        if (!ts.isCallExpression(decl.initializer)) continue
        const callee = decl.initializer.expression
        if (!ts.isIdentifier(callee)) continue
        if (callee.text === 'signal') writable.push(decl.name.text)
        else if (callee.text === 'derived') readonly_.push(decl.name.text)
      }
    }
  }
  const ws = new Set(writable)
  const rs = new Set(readonly_)
  return { writable: ws, readonly: rs, all: new Set([...writable, ...readonly_]) }
}

/**
 * Scan $script blocks of a component for `const { ... } = propsParamName` destructures
 * and return a map from local name → accessor expression (e.g. `props.count()`).
 */
function extractPropsAccessors(
  componentFn: ts.ArrowFunction,
  propsParamName: string,
  diagnostics: NvDiagnostic[],
): Map<string, string> {
  const map = new Map<string, string>()
  if (!ts.isBlock(componentFn.body)) return map
  for (const stmt of componentFn.body.statements) {
    if (!ts.isExpressionStatement(stmt)) continue
    const call = stmt.expression
    if (!ts.isCallExpression(call) || !isNvConstruct(call, '$script')) continue
    const fn = call.arguments[0]
    if (!fn || !ts.isArrowFunction(fn) || !ts.isBlock(fn.body)) continue
    for (const s of fn.body.statements) {
      if (!ts.isVariableStatement(s)) continue
      for (const decl of s.declarationList.declarations) {
        if (
          ts.isObjectBindingPattern(decl.name) &&
          decl.initializer &&
          ts.isIdentifier(decl.initializer) &&
          decl.initializer.text === propsParamName
        ) {
          const accessorMap = buildPropsAccessorMap(decl.name, [], diagnostics)
          for (const [local, accessor] of accessorMap) map.set(local, accessor)
        }
      }
    }
  }
  return map
}

function extractScriptSymbols(componentFn: ts.ArrowFunction): ScriptSymbols {
  const blocks: ts.Block[] = []
  if (ts.isBlock(componentFn.body)) {
    for (const stmt of componentFn.body.statements) {
      if (!ts.isExpressionStatement(stmt)) continue
      const call = stmt.expression
      if (!ts.isCallExpression(call) || !isNvConstruct(call, '$script')) continue
      const fn = call.arguments[0]
      if (!fn || !ts.isArrowFunction(fn) || !ts.isBlock(fn.body)) continue
      blocks.push(fn.body)
    }
  }
  return collectScriptSymbols(blocks)
}

function extractRenderTemplate(
  componentFn: ts.ArrowFunction,
  doc: Document,
  symbols: ScriptSymbols,
): ProcessResult | null {
  if (!ts.isBlock(componentFn.body)) return null
  for (const stmt of componentFn.body.statements) {
    if (!ts.isExpressionStatement(stmt)) continue
    const call = stmt.expression
    if (!ts.isCallExpression(call) || !isNvConstruct(call, '$render')) continue
    const fn = call.arguments[0]
    if (!fn || !ts.isArrowFunction(fn)) continue
    const body = fn.body
    if (
      !ts.isTaggedTemplateExpression(body) ||
      !ts.isIdentifier(body.tag) ||
      body.tag.text !== 'html'
    )
      continue
    return processHtmlTemplate(body, doc, symbols.all)
  }
  return null
}

function propertyKeyText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isStringLiteral(name)) return name.text
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text
  if (ts.isNumericLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name)) return null
  throw new Error(
    `[nv/parser] propertyKeyText: unhandled static PropertyName kind ${ts.SyntaxKind[name.kind]}`,
  )
}

function extractStyleInfo(
  componentFn: ts.ArrowFunction,
  symbols: ScriptSymbols,
): NvStyleInfo | null {
  if (!ts.isBlock(componentFn.body)) return null
  for (const stmt of componentFn.body.statements) {
    if (!ts.isExpressionStatement(stmt)) continue
    const call = stmt.expression
    if (!ts.isCallExpression(call) || !isNvConstruct(call, '$style')) continue
    const arg = call.arguments[0]
    if (!arg) return null
    const src = arg.getText()
    if (ts.isObjectLiteralExpression(arg)) {
      const keys: string[] = []
      let hasComputedKeys = false
      for (const p of arg.properties) {
        if (ts.isPropertyAssignment(p)) {
          const k = propertyKeyText(p.name)
          if (k === null) {
            hasComputedKeys = true
            continue
          }
          if (k !== null) keys.push(k)
        }
      }
      return { form: 'object', keys, hasComputedKeys, source: src, objExpr: arg }
    }
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
      const fnBody = arg.body
      const objExpr = ts.isObjectLiteralExpression(fnBody)
        ? fnBody
        : ts.isParenthesizedExpression(fnBody) && ts.isObjectLiteralExpression(fnBody.expression)
          ? fnBody.expression
          : null
      if (objExpr === null) return null
      const keys: string[] = []
      let hasComputedKeys = false
      for (const p of objExpr.properties) {
        if (ts.isPropertyAssignment(p)) {
          const k = propertyKeyText(p.name)
          if (k === null) {
            hasComputedKeys = true
            continue
          }
          if (k !== null) keys.push(k)
          eraseSignalReadsInNode(p.initializer, symbols.all) // proof-of-wire; result unused in S0
        } else if (ts.isSpreadAssignment(p)) {
          eraseSignalReadsInNode(p.expression, symbols.all) // proof-of-wire; result unused in S0
        }
      }
      return { form: 'factory', keys, hasComputedKeys, source: src, objExpr, factory: arg }
    }
    return null
  }
  return null
}

// ── $script erasure ───────────────────────────────────────────────────────────

/**
 * Erase all reactive bare reads within a TS expression node → `name()` text.
 * Does NOT stop at nested function boundaries.
 * Skips: call-expression callees, property-access objects, declaration names,
 * parameter names, shorthand property names, import specifiers, label names.
 */
function eraseSignalReadsInNode(
  node: ts.Node,
  reactive: ReadonlySet<string>,
  propsAccessors?: ReadonlyMap<string, string>,
): string {
  if (reactive.size === 0 && (!propsAccessors || propsAccessors.size === 0)) return node.getText()
  const rewrites: Rewrite[] = []
  const nodeStart = node.getStart()
  ;(function walk(n: ts.Node): void {
    if (ts.isIdentifier(n)) {
      const accessor = propsAccessors?.get(n.text)
      if (accessor !== undefined || reactive.has(n.text)) {
        const p = n.parent
        if (ts.isCallExpression(p) && p.expression === n) return
        // REST binding in property access position: `rest.propKey` → `props.propKey()`
        if (
          accessor?.startsWith('REST:') &&
          ts.isPropertyAccessExpression(p) &&
          p.expression === n &&
          ts.isIdentifier(p.name)
        ) {
          rewrites.push({
            start: p.getStart(),
            end: p.getEnd(),
            replacement: `props.${p.name.text}()`,
          })
          return
        }
        // For propsAccessors (accessor !== undefined), allow rewriting the object position
        // in a property access (e.g. `item.label` → `slotProps.item().label`).
        // Only skip the property-name position (p.name === n) unconditionally.
        // For plain signal reads (no accessor), skip both positions to avoid double rewrites.
        if (ts.isPropertyAccessExpression(p) && p.name === n) return
        if (ts.isPropertyAccessExpression(p) && p.expression === n && accessor === undefined) return
        if (ts.isVariableDeclaration(p) && p.name === n) return
        if (ts.isParameter(p) && p.name === n) return
        if (ts.isShorthandPropertyAssignment(p)) return
        if (ts.isPropertyAssignment(p) && p.name === n) return
        if (ts.isImportSpecifier(p) || ts.isImportClause(p)) return
        if (ts.isLabeledStatement(p) && p.label === n) return
        rewrites.push({
          start: n.getStart(),
          end: n.getEnd(),
          replacement: accessor !== undefined ? accessor : `${n.text}()`,
        })
        return
      }
    }
    ts.forEachChild(n, walk)
  })(node)
  const text = node.getText()
  const sorted = [...rewrites].sort((a, b) => b.start - a.start)
  let result = text
  for (const r of sorted) {
    result = result.slice(0, r.start - nodeStart) + r.replacement + result.slice(r.end - nodeStart)
  }
  return result
}

/**
 * Recursively collect all locally-bound names from a BindingName node into `shadows`,
 * filtering to those that collide with a reactive variable.
 *
 * Handles: plain identifiers, object binding patterns, array binding patterns (nested).
 * Uses the LOCAL binding name, not the property key. In `{ count: local }` the shadow
 * is `local`; in `{ count }` (shorthand) it is `count`.
 * For array patterns `[, a]`, OmittedExpression holes are skipped.
 */
function collectBindingNames(
  name: ts.BindingName,
  reactive: ReadonlySet<string>,
  shadows: Set<string>,
): void {
  if (ts.isIdentifier(name)) {
    if (reactive.has(name.text)) shadows.add(name.text)
  } else if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) collectBindingNames(element.name, reactive, shadows)
    }
  } else if (ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) collectBindingNames(element.name, reactive, shadows)
      // OmittedExpression (hole) → skip
    }
  }
}

/**
 * Build a local→accessorExpr map from a destructuring pattern on `props`.
 *
 * Input:  BindingName (ObjectBindingPattern) + full propNames array (for rest set-difference).
 * Output: Map<localName, accessorExprString>
 *
 * Examples:
 *   const { count } = props         → { count: 'props.count()' }
 *   const { count: c } = props      → { c: 'props.count()' }
 *   const { count, ...rest } = props → { count: 'props.count()', rest: 'REST:label,title' }
 *
 * Nested patterns produce a diagnostic (D1) and are not added to the map.
 */
export function buildPropsAccessorMap(
  pattern: ts.BindingName,
  propNames: readonly string[],
  diagnostics: NvDiagnostic[],
): Map<string, string> {
  const map = new Map<string, string>()
  if (!ts.isObjectBindingPattern(pattern)) return map

  const destructuredKeys = new Set<string>()

  for (const element of pattern.elements) {
    if (!ts.isBindingElement(element)) continue

    // Rest element: ...rest
    if (element.dotDotDotToken !== undefined) {
      const localName = ts.isIdentifier(element.name) ? element.name.text : null
      if (localName !== null) {
        const remainingKeys = propNames.filter((k) => !destructuredKeys.has(k))
        // Store a sentinel that the erasure walker recognizes as a rest binding.
        // Format: 'REST:key1,key2,...'
        map.set(localName, `REST:${remainingKeys.join(',')}`)
      }
      continue
    }

    // Nested destructure → diagnostic (D1)
    if (!ts.isIdentifier(element.name)) {
      diagnostics.push({
        kind: 'error',
        message:
          'Nested prop destructuring is not supported in v1; destructure one level (const { user } = props; user().name).',
        start: element.getStart(),
        end: element.getEnd(),
      })
      continue
    }

    // Regular element: { key } or { key: alias }
    const propKey = element.propertyName
      ? ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : null
      : element.name.text
    const localName = element.name.text

    if (propKey !== null) {
      destructuredKeys.add(propKey)
      map.set(localName, `props.${propKey}()`)
    }
  }

  return map
}

/**
 * Recursively scan a function body for `var` declarations (function-scoped / hoisted),
 * stopping at nested function boundaries. Adds names colliding with reactive to `shadows`.
 * Does NOT stop at block boundaries — `var` anywhere in the function is in scope.
 */
function collectVarShadows(
  node: ts.Node,
  reactive: ReadonlySet<string>,
  shadows: Set<string>,
): void {
  // Don't cross function boundaries — nested functions have their own var scope
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node))
    return
  if (ts.isVariableStatement(node)) {
    const flags = node.declarationList.flags
    const isVar = (flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0
    if (isVar)
      for (const decl of node.declarationList.declarations)
        collectBindingNames(decl.name, reactive, shadows)
  }
  ts.forEachChild(node, (child) => collectVarShadows(child, reactive, shadows))
}

/**
 * Compute the shadow set when entering a nested block (NOT a function body).
 * Only `let`/`const` declarations at the TOP LEVEL of the block are block-scoped here;
 * `var` is function-scoped and was already collected by gatherFunctionShadows.
 */
function gatherBlockShadows(
  block: ts.Block,
  existing: ReadonlySet<string>,
  reactive: ReadonlySet<string>,
): ReadonlySet<string> {
  const shadows = new Set(existing)
  for (const stmt of block.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    const flags = stmt.declarationList.flags
    if ((flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0) continue // skip var (already function-scope)
    for (const decl of stmt.declarationList.declarations)
      collectBindingNames(decl.name, reactive, shadows)
  }
  return shadows
}

/**
 * Gather new shadow names when entering a function scope.
 *
 * Collects:
 *   1. Parameter names — including destructured object/array patterns (recursive).
 *   2. `var` declarations anywhere in the function body (hoisted; recursive, stops at nested fns).
 *   3. Top-level `let`/`const` declarations in the function body statements.
 *
 * Nested-block `let`/`const` are NOT collected here; they are added on demand when the
 * walk enters each nested block via gatherBlockShadows in eraseScriptBlock.
 *
 * v0 known limits:
 *   - `for (const count of ...)` loop variables not tracked (for-of / for-in scoping).
 *   - Shorthand property erasure `{ count }` left to author (write `{ count: count() }`).
 */
function gatherFunctionShadows(
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  existing: ReadonlySet<string>,
  reactive: ReadonlySet<string>,
): ReadonlySet<string> {
  const shadows = new Set(existing)
  // 1. Parameters, including destructured patterns
  for (const param of fn.parameters) collectBindingNames(param.name, reactive, shadows)
  const body =
    ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)
      ? fn.body
      : (fn as ts.FunctionDeclaration).body
  // 2. var declarations anywhere in the function body (hoisted to function scope)
  if (body) collectVarShadows(body, reactive, shadows)
  // 3. Top-level let/const in the function body (block-scoped at this function level)
  if (body && ts.isBlock(body)) {
    for (const stmt of body.statements) {
      if (!ts.isVariableStatement(stmt)) continue
      for (const decl of stmt.declarationList.declarations)
        collectBindingNames(decl.name, reactive, shadows)
    }
  }
  return shadows
}

/**
 * Full $script block erasure. Scope-aware: tracks shadowed names through
 * nested function boundaries.
 *
 * - Simple assignment `x = expr` (x in writable, not shadowed) → `x.set(erased(expr))`
 * - Compound assignment `x op= expr` (x in writable, not shadowed) → `x.set(x() op erased(expr))`
 * - Assignment to derived (x in readonly, not shadowed) → DIAGNOSTIC ERROR
 * - All other reactive bare reads → `x()` (everywhere, including inside nested fns)
 *
 * Write false-positives (rewriting a non-signal) must never occur. Shadowing
 * detection prevents them when a local variable shares a name with a signal.
 * Read false-positives (ACCEPT on a non-reactive hole) are acceptable.
 */
function eraseScriptBlock(
  block: ts.Block,
  symbols: ScriptSymbols,
  out: Rewrite[],
  diagnostics: NvDiagnostic[],
  propsParamName?: string,
): void {
  // Build mutable props accessor map (grows as we detect `const { x } = props`)
  const propsAccessors = new Map<string, string>()

  // Walk CHILDREN of the $script body directly — not the body block itself.
  // This prevents gatherBlockShadows from treating the $script's own `const count = signal(0)`
  // declarations as shadows (they are reactive declarations, not local shadows).
  ts.forEachChild(block, (child) => walk(child, new Set<string>()))

  function walk(node: ts.Node, shadowed: ReadonlySet<string>): void {
    // Props destructuring detection: `const { count } = props`
    if (propsParamName !== undefined && ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isObjectBindingPattern(decl.name) &&
          decl.initializer &&
          ts.isIdentifier(decl.initializer) &&
          decl.initializer.text === propsParamName
        ) {
          const accessorMap = buildPropsAccessorMap(decl.name, [], diagnostics)
          for (const [local, accessor] of accessorMap) {
            propsAccessors.set(local, accessor)
          }
          // Erase the destructure declaration itself
          out.push({ start: node.getFullStart(), end: node.getEnd(), replacement: '' })
          return
        }
      }
    }

    // Scope entry: function introduces new parameter and body-level shadowing
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      const fn = node as ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration
      const newShadowed = gatherFunctionShadows(fn, shadowed, symbols.all)
      const body =
        ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)
          ? fn.body
          : (fn as ts.FunctionDeclaration).body
      if (body) {
        if (ts.isBlock(body)) ts.forEachChild(body, (child) => walk(child, newShadowed))
        else walk(body, newShadowed) // arrow expression body
      }
      return
    }

    // Nested block entry: collect block-scoped let/const shadows for this block.
    // `var` is already in the function-level shadows (collected by gatherFunctionShadows).
    // This handles patterns like `{ let count = 5; count = 10 }` inside a function body.
    if (ts.isBlock(node)) {
      const newShadowed = gatherBlockShadows(node, shadowed, symbols.all)
      ts.forEachChild(node, (child) => walk(child, newShadowed))
      return
    }

    // Assignment detection (simple and compound)
    if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
      const { left: lhs, operatorToken, right: rhs } = node.expression
      const op = operatorToken.kind
      const isSimple = op === ts.SyntaxKind.EqualsToken
      const binaryOp = compoundOpMap.get(op)
      if ((isSimple || binaryOp !== undefined) && ts.isIdentifier(lhs) && !shadowed.has(lhs.text)) {
        const name = lhs.text
        // Props write detection: assignment to a destructured prop → error diagnostic
        if (propsAccessors.has(name)) {
          diagnostics.push({
            kind: 'error',
            message: `Assignment to prop '${name}': props are read-only. Use a local signal if you need local mutable state.`,
            start: node.expression.getStart(),
            end: node.expression.getEnd(),
          })
          return
        }
        if (symbols.writable.has(name)) {
          const erasedRhs = eraseSignalReadsInNode(rhs, symbols.all)
          out.push({
            start: node.expression.getStart(),
            end: node.expression.getEnd(),
            replacement: isSimple
              ? `${name}.set(${erasedRhs})`
              : `${name}.set(${name}() ${binaryOp} ${erasedRhs})`,
          })
          return
        }
        if (symbols.readonly.has(name)) {
          diagnostics.push({
            kind: 'error',
            message: `Assignment to derived '${name}': deriveds are read-only. Use signal() for writable state, or refactor the mutation into the reactive graph via sync().`,
            start: node.expression.getStart(),
            end: node.expression.getEnd(),
          })
          return
        }
      }
    }

    // Props accessor read: identifier is in propsAccessors map
    if (ts.isIdentifier(node) && propsAccessors.has(node.text) && !shadowed.has(node.text)) {
      const accessor = propsAccessors.get(node.text) ?? ''
      const p = node.parent
      if (ts.isCallExpression(p) && p.expression === node) return
      if (ts.isVariableDeclaration(p) && p.name === node) return
      if (ts.isParameter(p) && p.name === node) return
      if (ts.isShorthandPropertyAssignment(p)) return
      if (ts.isPropertyAssignment(p) && p.name === node) return
      if (ts.isImportSpecifier(p) || ts.isImportClause(p)) return
      if (ts.isLabeledStatement(p) && p.label === node) return
      // REST binding: `rest.propKey` → `props.propKey()`
      if (
        accessor.startsWith('REST:') &&
        ts.isPropertyAccessExpression(p) &&
        p.expression === node &&
        ts.isIdentifier(p.name)
      ) {
        const propKey = p.name.text
        out.push({ start: p.getStart(), end: p.getEnd(), replacement: `props.${propKey}()` })
        return
      }
      if (ts.isPropertyAccessExpression(p) && (p.expression === node || p.name === node)) return
      out.push({ start: node.getStart(), end: node.getEnd(), replacement: accessor })
      return
    }

    // Bare read: reactive identifier in a value position, not shadowed
    if (ts.isIdentifier(node) && symbols.all.has(node.text) && !shadowed.has(node.text)) {
      const p = node.parent
      if (ts.isCallExpression(p) && p.expression === node) return
      if (ts.isPropertyAccessExpression(p) && (p.expression === node || p.name === node)) return
      if (ts.isVariableDeclaration(p) && p.name === node) return
      if (ts.isParameter(p) && p.name === node) return
      if (ts.isShorthandPropertyAssignment(p)) return
      if (ts.isPropertyAssignment(p) && p.name === node) return
      if (ts.isImportSpecifier(p) || ts.isImportClause(p)) return
      if (ts.isLabeledStatement(p) && p.label === node) return
      out.push({ start: node.getStart(), end: node.getEnd(), replacement: `${node.text}()` })
      return
    }

    ts.forEachChild(node, (child) => walk(child, shadowed))
  }
}

// ── Style artifact builder ────────────────────────────────────────────────────

/** Descriptor for a dynamic CSS custom property (Phase 3 population; empty in Phase 2). */
export type VarBindingDesc = {
  /** CSS custom property name, e.g. '--nv-1a2b3c4d' */
  varName: string
  /** Erased reactive expression source (thunk body) */
  exprSrc: string
  /** pathIndex of the DOM node to attach the CSS variable to */
  pathIndex: number
  /** CSS property name, e.g. 'color' */
  propertyName: string
}

// Strips surrounding string-literal quotes from a TS node — returns raw CSS value
function getValueText(node: ts.Expression): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  return node.getText()
}

// Returns true if the expression node references any reactive signal name
function isReactiveExpr(node: ts.Expression, symbols: ScriptSymbols): boolean {
  if (symbols.all.size === 0) return false
  const original = node.getText()
  const erased = eraseSignalReadsInNode(node, symbols.all)
  return erased !== original
}

// Build CSS artifact for $style block — static CSS + varBindingDescs for reactive values
function buildStyleArtifact(
  info: NvStyleInfo,
  scopeHash: string,
  symbols: ScriptSymbols,
): {
  staticCss: string
  varBindingDescs: VarBindingDesc[]
  classRewrites: Map<string, string>
} {
  const rules: string[] = []
  const varBindingDescs: VarBindingDesc[] = []
  const classRewrites = new Map<string, string>()

  for (const p of info.objExpr.properties) {
    if (!ts.isPropertyAssignment(p)) continue
    const key = propertyKeyText(p.name)
    if (key === null) continue

    const initializer = p.initializer
    const classify = classifyStyleKey(key)

    if (ts.isObjectLiteralExpression(initializer)) {
      // Nested object: { card: { color: 'red', fontWeight: 'bold' } }
      const declPairs: Array<[string, string]> = []
      for (const decl of initializer.properties) {
        if (!ts.isPropertyAssignment(decl)) continue
        const propKey = propertyKeyText(decl.name)
        if (propKey === null) continue
        const cssProp = propKey.replace(/([A-Z])/g, '-$1').toLowerCase()
        if (isReactiveExpr(decl.initializer, symbols)) {
          const varName = `--nv-${simpleHash(`${scopeHash}|${cssProp}`)}`
          const exprSrc = eraseSignalReadsInNode(decl.initializer, symbols.all)
          varBindingDescs.push({ varName, exprSrc, pathIndex: 0, propertyName: cssProp })
          declPairs.push([cssProp, `var(${varName})`])
        } else {
          declPairs.push([cssProp, getValueText(decl.initializer)])
        }
      }
      if (declPairs.length === 0) continue
      const declarationBlock = declPairs.map(([prop, val]) => `${prop}: ${val}`).join('; ')
      if (classify.form === 'class') {
        for (const token of classify.tokens) {
          classRewrites.set(token, `${token}_${scopeHash}`)
          rules.push(`.${token}_${scopeHash} { ${declarationBlock} }`)
        }
      } else {
        rules.push(`:where([data-nv-s-${scopeHash}]) ${key} { ${declarationBlock} }`)
      }
    } else {
      // Flat value: { card: 'color: red; font-weight: bold' } — treat as static
      const val = getValueText(initializer)
      if (classify.form === 'class') {
        for (const token of classify.tokens) {
          classRewrites.set(token, `${token}_${scopeHash}`)
          rules.push(`.${token}_${scopeHash} { ${val} }`)
        }
      } else {
        rules.push(`:where([data-nv-s-${scopeHash}]) ${key} { ${val} }`)
      }
    }
  }

  return { staticCss: rules.join('\n'), varBindingDescs, classRewrites }
}

/** Count top-level element children in a raw HTML string (no wrapping element). */
function countTopLevelElements(html: string): number {
  let depth = 0
  let count = 0
  let i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      if (html[i + 1] === '/') {
        // closing tag
        const end = html.indexOf('>', i)
        depth--
        i = end + 1
      } else if (html[i + 1] === '!') {
        // comment or doctype — skip
        const end = html.indexOf('>', i)
        i = end + 1
      } else {
        // opening tag
        const end = html.indexOf('>', i)
        const tagText = html.slice(i, end + 1)
        if (depth === 0) count++
        if (!tagText.endsWith('/>')) depth++
        i = end + 1
      }
    } else {
      i++
    }
  }
  return count
}

// Inject StyleVarBinding entries into a mutable TemplateIR for each VarBindingDesc.
// pathIndex for ALL style-var bindings points to the first root element ([0]).
// bindingThunks: if provided (emit path), push a 'style-var' ThunkSource per desc.
function applyVarBindingsToIr(
  ir: TemplateIR,
  descs: VarBindingDesc[],
  bindingThunks?: ThunkSource[],
): void {
  if (descs.length > 0 && countTopLevelElements(ir.shape.html) > 1) {
    throw new Error(
      '[nv/parser] $style with dynamic values on a multi-root template is not supported',
    )
  }
  // Mutation bounded to the parse pass — no aliased references exist yet.
  const mutablePaths = ir.shape.bindingPaths as NodePath[]
  const mutableBindings = ir.bindings as StyleVarBinding[]

  const rootPathIndex = mutablePaths.length
  mutablePaths.push([0]) // first root element of the fragment

  const stubExpr = (() => undefined) as unknown as () => string | number | null | undefined
  for (const desc of descs) {
    mutableBindings.push({
      kind: 'style-var',
      pathIndex: rootPathIndex,
      varName: desc.varName,
      expr: stubExpr,
    })
    bindingThunks?.push({ kind: 'style-var', exprSrc: desc.exprSrc })
  }
}

export function patchClasslistTokens(ir: TemplateIR, classRewrites: Map<string, string>): void {
  if (classRewrites.size === 0) return
  for (const binding of ir.bindings as Binding[]) {
    if (binding.kind === 'classlist') {
      for (const entry of binding.entries) {
        if (entry.kind === 'static') {
          const rw = classRewrites.get(entry.token)
          if (rw) (entry as { token: string }).token = rw
        } else {
          const rw = classRewrites.get(entry.key)
          if (rw) (entry as { key: string }).key = rw
        }
      }
    }
    if (binding.kind === 'conditional') {
      patchClasslistTokens(binding.consequent, classRewrites)
      if (binding.alternate) patchClasslistTokens(binding.alternate, classRewrites)
    }
    if (binding.kind === 'list') {
      // NOTE: patches stub-call return; sticks only while itemTemplate returns same IR by ref.
      // Fresh-IR itemTemplate would break this silently. Same latent fragility as 'component' below.
      // Call the factory once with stub signals to get the item bodyIR, then recurse.
      // Stubs are inert: the interp stub is () => wl.bodyIR (pure); emit stub is equally pure.
      const stubVs = signal<unknown>(null)
      const stubIs = signal<number>(0)
      const itemIR = binding.itemTemplate(stubVs, stubIs)
      patchClasslistTokens(itemIR, classRewrites)
    }
    if (binding.kind === 'recycled-list') {
      // Use bodyIR directly — itemTemplate on parse-path bindings is structural-only (throws).
      // Runtime-authored bindings have no bodyIR; skip safely.
      const rlb = binding as RecycledListBinding
      if (rlb.bodyIR !== undefined) {
        patchClasslistTokens(rlb.bodyIR, classRewrites)
      }
    }
    // NEW: component case — same pattern as list (stub-call + recurse). Diverges from list in one
    // way: also rewrites static class attrs in slotIR.shape.html (slot content may carry literal
    // class="card" strings, not only classlist bindings; list-item bodies don't have this).
    // KNOWN LIMITATION: a ComponentBinding is only produced when the slot content contains at
    // least one interpolation hole (the parser requires a hole to detect the component boundary).
    // Purely static slot content (<ChildComp><div class="card">x</div></ChildComp> with no holes)
    // produces no bindings and is therefore not reached here — the static class remains unrewritten.
    // This is a pre-existing parser constraint, not a regression. The mixed case (static class +
    // any hole) works correctly: the hole triggers component detection and the regex branch fires.
    if (binding.kind === 'component') {
      const stubSlotProps = {}
      for (const slot of (binding as ComponentBinding).slots) {
        // NOTE: safe only while .nv slot factories return the same captured-by-ref IR object
        // (true for `(_props) => namedIR` closures built by buildNvSlotContentIR today).
        // The scoped-slot shape (props) => TemplateIR permits fresh-IR-per-call; that would
        // break this patch silently. Same latent fragility as the 'list' case above. (G2)
        const slotIR = slot.content(stubSlotProps)
        // D-SS-1: static class= attrs are now lifted to ClassListBinding entries at IR build time
        // (liftStaticClassBindings in buildNvSlotContentIR). No shape.html regex rewrite needed.
        patchClasslistTokens(slotIR, classRewrites)
      }
    }
  }
}

// ── Main preprocessing ─────────────────────────────────────────────────────────

/**
 * Pre-process a .nv source: full $script erasure (mutation-writes + bare reads)
 * before the TS compiler API parses the body.
 *
 * @param diagnosticsOut  Optional array to collect write-safety diagnostics
 *   (e.g., assignment to a derived). If not provided, diagnostics are silently
 *   discarded (caller using preprocessMutationWrites standalone for text checks).
 */
export function preprocessMutationWrites(
  source: string,
  fileName: string,
  diagnosticsOut?: NvDiagnostic[],
): string {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const rewrites: Rewrite[] = []
  const diagnostics: NvDiagnostic[] = []
  ;(function walk(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isNvConstruct(node.initializer, '$component')
    ) {
      const fn = node.initializer.arguments[0]
      if (!fn || !ts.isArrowFunction(fn) || !ts.isBlock(fn.body)) return
      // Collect $script blocks and their symbols for this component
      const blocks: ts.Block[] = []
      for (const stmt of fn.body.statements) {
        if (!ts.isExpressionStatement(stmt)) continue
        const call = stmt.expression
        if (!ts.isCallExpression(call) || !isNvConstruct(call, '$script')) continue
        const scriptFn = call.arguments[0]
        if (!scriptFn || !ts.isArrowFunction(scriptFn) || !ts.isBlock(scriptFn.body)) continue
        blocks.push(scriptFn.body)
      }
      // Detect props parameter name from $component((props) => ...)
      const propsParamName: string | undefined =
        fn.parameters.length > 0 &&
        fn.parameters[0] !== undefined &&
        ts.isIdentifier(fn.parameters[0].name)
          ? fn.parameters[0].name.text
          : undefined
      const symbols = collectScriptSymbols(blocks)
      for (const block of blocks)
        eraseScriptBlock(block, symbols, rewrites, diagnostics, propsParamName)
      return // each $component is its own scope
    }
    ts.forEachChild(node, walk)
  })(sf)

  if (diagnosticsOut) for (const d of diagnostics) diagnosticsOut.push(d)

  const sorted = [...rewrites].sort((a, b) => b.start - a.start)
  let result = source
  for (const r of sorted)
    result = `${result.slice(0, r.start)}${r.replacement}${result.slice(r.end)}`
  return result
}

// ── Main API ──────────────────────────────────────────────────────────────────

export function parseNvFile(source: string, fileName: string, doc: Document): NvComponentResult[] {
  const diagnostics: NvDiagnostic[] = []
  const processed = preprocessMutationWrites(source, fileName, diagnostics)

  const sf = ts.createSourceFile(
    fileName,
    processed,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  )
  const results: NvComponentResult[] = []

  ts.forEachChild(sf, (node) => {
    if (!ts.isVariableStatement(node)) return
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
      if (!isNvConstruct(decl.initializer, '$component')) continue
      const componentFn = decl.initializer.arguments[0]
      if (!componentFn || !ts.isArrowFunction(componentFn)) continue
      const name = decl.name.text
      const symbols = extractScriptSymbols(componentFn)
      const renderResult = extractRenderTemplate(componentFn, doc, symbols)
      if (renderResult === null) continue
      const styleInfo = extractStyleInfo(componentFn, symbols)
      // Fold $style source into the seed so two components with identical templates but
      // different $style rules get distinct scopeHashes — preventing CSS dedup collisions.
      const scopeHash = simpleHash(`${renderResult.shapeHtml}\0${styleInfo?.source ?? ''}`)
      if (styleInfo !== null) {
        const artifact = buildStyleArtifact(styleInfo, scopeHash, symbols)
        renderResult.ir.styleArtifact = {
          staticCss: artifact.staticCss,
          scopeHash,
          varBindingDescs: artifact.varBindingDescs.map(({ varName, exprSrc, propertyName }) => ({
            varName,
            exprSrc,
            propertyName,
          })),
        }
        if (artifact.varBindingDescs.length > 0) {
          applyVarBindingsToIr(renderResult.ir, artifact.varBindingDescs)
        }
        patchClasslistTokens(renderResult.ir, artifact.classRewrites)
        renderResult.ir.classRewrites = artifact.classRewrites
      }
      results.push({
        name,
        ir: renderResult.ir,
        scriptSignals: [...symbols.writable, ...symbols.readonly],
        style: styleInfo,
        verdicts: renderResult.verdicts,
        diagnostics: [...diagnostics, ...renderResult.diagnostics],
      })
    }
  })

  return results
}

// ── Render-hole erasure for emit ──────────────────────────────────────────────

/**
 * Erase a handler arrow-function expression for emit.
 *
 * The handler hole is expected to be an arrow function `() => body` where body is:
 *   - An expression (possibly an assignment: `count = count + 1`)
 *   - A block containing statements
 *
 * Applies the same rewrite logic as eraseScriptBlock:
 *   - Bare-read erasure on all reactive names
 *   - Mutation-write erasure (assignment → .set()) for writable signals
 *   - Diagnostic for assignment to derived
 *
 * Destructuring assignment targets (`[a, b] = ...`, `({ x } = ...)`) where a
 * bound name matches a signal name produce an error diagnostic — signals are not
 * writable via destructuring; use `.set()` directly.
 *
 * Returns the erased source text of the ENTIRE handler expression.
 */
function eraseHandlerExpr(
  handlerExpr: ts.Expression,
  symbols: ScriptSymbols,
  diagnostics: NvDiagnostic[],
  propsParamName?: string,
  propsAccessors?: ReadonlyMap<string, string>,
): string {
  if (!ts.isArrowFunction(handlerExpr)) {
    // Non-arrow handler (e.g., bare identifier): just erase bare reads
    return eraseSignalReadsInNode(handlerExpr, symbols.all, propsAccessors)
  }

  const fn = handlerExpr
  const rewrites: Rewrite[] = []
  const nodeStart = fn.getStart()

  // Build props accessor map for `const { ... } = props` inside handler body
  const handlerPropsAccessors = new Map<string, string>()

  // Gather function-level shadows (parameters + var hoisting in body)
  const fnShadowed = gatherFunctionShadows(fn, new Set<string>(), symbols.all)

  function walkHandlerNode(node: ts.Node, shadowed: ReadonlySet<string>): void {
    // Props destructuring detection: `const { count } = props` inside handler body
    if (propsParamName !== undefined && ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isObjectBindingPattern(decl.name) &&
          decl.initializer &&
          ts.isIdentifier(decl.initializer) &&
          decl.initializer.text === propsParamName
        ) {
          const accessorMap = buildPropsAccessorMap(decl.name, [], diagnostics)
          for (const [local, accessor] of accessorMap) {
            handlerPropsAccessors.set(local, accessor)
          }
          // Erase the destructure statement itself
          rewrites.push({ start: node.getFullStart(), end: node.getEnd(), replacement: '' })
          return
        }
      }
    }

    // Scope entry: nested function
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      const nested = node as ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration
      const newShadowed = gatherFunctionShadows(nested, shadowed, symbols.all)
      const body =
        ts.isArrowFunction(nested) || ts.isFunctionExpression(nested)
          ? nested.body
          : (nested as ts.FunctionDeclaration).body
      if (body) {
        if (ts.isBlock(body)) ts.forEachChild(body, (child) => walkHandlerNode(child, newShadowed))
        else walkHandlerNode(body, newShadowed)
      }
      return
    }

    // Nested block: collect block-scoped shadows
    if (ts.isBlock(node)) {
      const newShadowed = gatherBlockShadows(node, shadowed, symbols.all)
      ts.forEachChild(node, (child) => walkHandlerNode(child, newShadowed))
      return
    }

    // Assignment detection (simple and compound) at statement level
    if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
      const { left: lhs, operatorToken, right: rhs } = node.expression
      const op = operatorToken.kind
      const isSimple = op === ts.SyntaxKind.EqualsToken
      const binaryOp = compoundOpMap.get(op)
      if ((isSimple || binaryOp !== undefined) && ts.isIdentifier(lhs) && !shadowed.has(lhs.text)) {
        const name = lhs.text
        if (symbols.writable.has(name)) {
          const erasedRhs = eraseSignalReadsInNode(rhs, symbols.all, propsAccessors)
          rewrites.push({
            start: node.expression.getStart(),
            end: node.expression.getEnd(),
            replacement: isSimple
              ? `${name}.set(${erasedRhs})`
              : `${name}.set(${name}() ${binaryOp} ${erasedRhs})`,
          })
          return
        }
        if (symbols.readonly.has(name)) {
          diagnostics.push({
            kind: 'error',
            message: `Assignment to derived '${name}': deriveds are read-only. Use signal() for writable state, or refactor the mutation into the reactive graph via sync().`,
            start: node.expression.getStart(),
            end: node.expression.getEnd(),
          })
          return
        }
      }
    }

    // Destructuring assignment in statement position: ({ count } = obj), [count] = arr
    if (ts.isExpressionStatement(node)) {
      let binaryExpr: ts.BinaryExpression | null = null
      if (ts.isBinaryExpression(node.expression)) {
        binaryExpr = node.expression
      } else if (
        ts.isParenthesizedExpression(node.expression) &&
        ts.isBinaryExpression(node.expression.expression)
      ) {
        binaryExpr = node.expression.expression
      }
      if (binaryExpr !== null && binaryExpr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const lhs = binaryExpr.left
        if (ts.isObjectLiteralExpression(lhs) || ts.isArrayLiteralExpression(lhs)) {
          const names: string[] = []
          if (ts.isObjectLiteralExpression(lhs)) {
            for (const prop of lhs.properties) {
              if (ts.isShorthandPropertyAssignment(prop)) names.push(prop.name.text)
              else if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer))
                names.push(prop.initializer.text)
            }
          } else {
            for (const el of lhs.elements) {
              if (ts.isIdentifier(el)) names.push(el.text)
            }
          }
          for (const name of names) {
            if (symbols.all.has(name) && !shadowed.has(name)) {
              diagnostics.push({
                kind: 'error',
                message: `Destructuring assignment to '${name}' is not supported; signals are not writable via destructuring. Use '${name}.set(value)' directly.`,
                start: binaryExpr.getStart(),
                end: binaryExpr.getEnd(),
              })
            }
          }
          return
        }
      }
    }

    // Assignment expression (arrow expression body, not wrapped in ExpressionStatement)
    if (ts.isBinaryExpression(node)) {
      const { left: lhs, operatorToken, right: rhs } = node
      const op = operatorToken.kind
      const isSimple = op === ts.SyntaxKind.EqualsToken
      const binaryOp = compoundOpMap.get(op)
      if ((isSimple || binaryOp !== undefined) && ts.isIdentifier(lhs) && !shadowed.has(lhs.text)) {
        const name = lhs.text
        if (symbols.writable.has(name)) {
          const erasedRhs = eraseSignalReadsInNode(rhs, symbols.all, propsAccessors)
          rewrites.push({
            start: node.getStart(),
            end: node.getEnd(),
            replacement: isSimple
              ? `${name}.set(${erasedRhs})`
              : `${name}.set(${name}() ${binaryOp} ${erasedRhs})`,
          })
          return
        }
        if (symbols.readonly.has(name)) {
          diagnostics.push({
            kind: 'error',
            message: `Assignment to derived '${name}': deriveds are read-only. Use signal() for writable state, or refactor the mutation into the reactive graph via sync().`,
            start: node.getStart(),
            end: node.getEnd(),
          })
          return
        }
      }
      // Destructuring assignment in expression position
      if (isSimple && (ts.isObjectLiteralExpression(lhs) || ts.isArrayLiteralExpression(lhs))) {
        const names: string[] = []
        if (ts.isObjectLiteralExpression(lhs)) {
          for (const prop of lhs.properties) {
            if (ts.isShorthandPropertyAssignment(prop)) names.push(prop.name.text)
            else if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer))
              names.push(prop.initializer.text)
          }
        } else {
          for (const el of lhs.elements) {
            if (ts.isIdentifier(el)) names.push(el.text)
          }
        }
        for (const name of names) {
          if (symbols.all.has(name) && !shadowed.has(name)) {
            diagnostics.push({
              kind: 'error',
              message: `Destructuring assignment to '${name}' is not supported; signals are not writable via destructuring. Use '${name}.set(value)' directly.`,
              start: node.getStart(),
              end: node.getEnd(),
            })
          }
        }
        return
      }
    }

    // Props accessor bare read: identifier destructured from props inside this handler
    if (ts.isIdentifier(node) && handlerPropsAccessors.has(node.text) && !shadowed.has(node.text)) {
      const p = node.parent
      if (ts.isCallExpression(p) && p.expression === node) return
      if (ts.isPropertyAccessExpression(p) && (p.expression === node || p.name === node)) return
      if (ts.isVariableDeclaration(p) && p.name === node) return
      if (ts.isParameter(p) && p.name === node) return
      if (ts.isShorthandPropertyAssignment(p)) return
      if (ts.isPropertyAssignment(p) && p.name === node) return
      if (ts.isImportSpecifier(p) || ts.isImportClause(p)) return
      if (ts.isLabeledStatement(p) && p.label === node) return
      const accessor = handlerPropsAccessors.get(node.text)
      if (accessor === undefined) return
      rewrites.push({ start: node.getStart(), end: node.getEnd(), replacement: accessor })
      return
    }

    // Slot-prop identifier from let={item} on <each>.
    // Must allow the object position in property access (item.id → slotProps.item().id)
    // unlike signals, where obj position is skipped to avoid rewriting signal.set(...).
    if (
      propsAccessors !== undefined &&
      ts.isIdentifier(node) &&
      propsAccessors.has(node.text) &&
      !shadowed.has(node.text)
    ) {
      const p = node.parent
      if (ts.isCallExpression(p) && p.expression === node) return
      if (ts.isPropertyAccessExpression(p) && p.name === node) return // skip name position only
      if (ts.isVariableDeclaration(p) && p.name === node) return
      if (ts.isParameter(p) && p.name === node) return
      if (ts.isShorthandPropertyAssignment(p)) return
      if (ts.isPropertyAssignment(p) && p.name === node) return
      if (ts.isImportSpecifier(p) || ts.isImportClause(p)) return
      if (ts.isLabeledStatement(p) && p.label === node) return
      const slotAccessor = propsAccessors.get(node.text)
      if (slotAccessor === undefined) return
      rewrites.push({ start: node.getStart(), end: node.getEnd(), replacement: slotAccessor })
      return
    }

    // Bare read: reactive identifier in a value position, not shadowed
    if (ts.isIdentifier(node) && symbols.all.has(node.text) && !shadowed.has(node.text)) {
      const p = node.parent
      if (ts.isCallExpression(p) && p.expression === node) return
      if (ts.isPropertyAccessExpression(p) && (p.expression === node || p.name === node)) return
      if (ts.isVariableDeclaration(p) && p.name === node) return
      if (ts.isParameter(p) && p.name === node) return
      if (ts.isShorthandPropertyAssignment(p)) return
      if (ts.isPropertyAssignment(p) && p.name === node) return
      if (ts.isImportSpecifier(p) || ts.isImportClause(p)) return
      if (ts.isLabeledStatement(p) && p.label === node) return
      rewrites.push({ start: node.getStart(), end: node.getEnd(), replacement: `${node.text}()` })
      return
    }

    ts.forEachChild(node, (child) => walkHandlerNode(child, shadowed))
  }

  // Walk the handler body
  const body = fn.body
  if (ts.isBlock(body)) {
    ts.forEachChild(body, (child) => walkHandlerNode(child, fnShadowed))
  } else {
    // Expression body
    walkHandlerNode(body, fnShadowed)
  }

  // Apply rewrites to the full handler source text
  const text = fn.getText()
  const sorted = [...rewrites].sort((a, b) => b.start - a.start)
  let result = text
  for (const r of sorted) {
    result = result.slice(0, r.start - nodeStart) + r.replacement + result.slice(r.end - nodeStart)
  }
  return result
}

/**
 * Compute ThunkSource for a single binding hole.
 * `holeExpr` is the TS expression node for the hole.
 * `pos` is the classified position kind.
 * For ConditionalBinding, recursively computes consequent/alternate thunks.
 */
function computeThunkSource(
  holeExpr: ts.Expression,
  pos: PosKind,
  doc: Document,
  symbols: ScriptSymbols,
  diagnostics: NvDiagnostic[],
  propsParamName?: string,
  propsAccessors?: ReadonlyMap<string, string>,
): ThunkSource {
  if (pos.kind === 'text') {
    // Scoped slot outlet: expression is `slots.name({ item: expr, ... })` — CallExpression form.
    if (
      ts.isCallExpression(holeExpr) &&
      ts.isPropertyAccessExpression(holeExpr.expression) &&
      ts.isIdentifier(holeExpr.expression.expression) &&
      holeExpr.expression.expression.text === 'slots' &&
      ts.isIdentifier(holeExpr.expression.name)
    ) {
      const slotName = (holeExpr.expression.name as ts.Identifier).text
      const propSrcs: Array<{ name: string; exprSrc: string }> = []
      const arg = holeExpr.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
            propSrcs.push({
              name: (prop.name as ts.Identifier).text,
              exprSrc: eraseSignalReadsInNode(prop.initializer, symbols.all, propsAccessors),
            })
          }
        }
      }
      return {
        kind: 'slot-outlet' as const,
        name: slotName,
        ...(propSrcs.length > 0 && { props: propSrcs }),
      }
    }
    // Slot outlet: expression is `slots.name` property access.
    if (
      ts.isPropertyAccessExpression(holeExpr) &&
      ts.isIdentifier(holeExpr.expression) &&
      holeExpr.expression.text === 'slots' &&
      ts.isIdentifier(holeExpr.name)
    ) {
      return { kind: 'slot-outlet' as const, name: (holeExpr.name as ts.Identifier).text }
    }
    // Slot outlet with fallback: `slots.name ?? html\`...\``.
    if (
      ts.isBinaryExpression(holeExpr) &&
      holeExpr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const left = holeExpr.left
      const right = holeExpr.right
      const isHtmlTTE = (e: ts.Expression): e is ts.TaggedTemplateExpression =>
        ts.isTaggedTemplateExpression(e) && ts.isIdentifier(e.tag) && e.tag.text === 'html'
      if (
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.expression) &&
        left.expression.text === 'slots' &&
        ts.isIdentifier(left.name) &&
        isHtmlTTE(right)
      ) {
        const fallbackThunks = computeThunksForTemplate(
          right,
          doc,
          symbols,
          diagnostics,
          new Set(),
          propsParamName,
          propsAccessors,
        )
        return {
          kind: 'slot-outlet' as const,
          name: (left.name as ts.Identifier).text,
          fallbackThunks,
        }
      }
    }
    // May be a ConditionalBinding (ternary with html`` branches)
    if (ts.isConditionalExpression(holeExpr)) {
      const { condition, whenTrue, whenFalse } = holeExpr
      const isHtmlTTE = (e: ts.Expression): e is ts.TaggedTemplateExpression =>
        ts.isTaggedTemplateExpression(e) && ts.isIdentifier(e.tag) && e.tag.text === 'html'
      const isNullish = (e: ts.Expression): boolean =>
        e.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(e) && (e.text === 'null' || e.text === 'undefined'))
      if (isHtmlTTE(whenTrue) && (isHtmlTTE(whenFalse) || isNullish(whenFalse))) {
        const conditionSrc = eraseSignalReadsInNode(condition, symbols.all, propsAccessors)
        // Use computeBindingThunks (E-2b collapse) so components inside branches are handled
        const consequentResult = processHtmlTemplate(whenTrue, doc, symbols.all)
        const cHoles = extractTemplateHoles(whenTrue)
        const consequentThunks = computeBindingThunks(
          consequentResult.pendingComponents,
          consequentResult.pendingEachItems,
          consequentResult.pendingRecycleItems,
          consequentResult.pendingSwitchItems,
          consequentResult.consumedByComponent,
          cHoles.holeExprs,
          cHoles.positions,
          doc,
          symbols,
          diagnostics,
          propsParamName,
          propsAccessors,
        )
        const alternateSrc = isHtmlTTE(whenFalse)
          ? (() => {
              const altResult = processHtmlTemplate(whenFalse, doc, symbols.all)
              const aHoles = extractTemplateHoles(whenFalse)
              return computeBindingThunks(
                altResult.pendingComponents,
                altResult.pendingEachItems,
                altResult.pendingRecycleItems,
                altResult.pendingSwitchItems,
                altResult.consumedByComponent,
                aHoles.holeExprs,
                aHoles.positions,
                doc,
                symbols,
                diagnostics,
                propsParamName,
                propsAccessors,
              )
            })()
          : null
        return {
          kind: 'conditional',
          conditionSrc,
          consequent: consequentThunks,
          alternate: alternateSrc,
        }
      }
    }
    // Regular text binding
    return { kind: 'text', exprSrc: eraseSignalReadsInNode(holeExpr, symbols.all, propsAccessors) }
  }
  if (pos.kind === 'attr') {
    // ClassListBinding: class attr with object or array literal → structured classlist thunk
    if (pos.name === 'class') {
      if (ts.isObjectLiteralExpression(holeExpr)) {
        const entries: Array<
          { kind: 'static'; token: string } | { kind: 'toggle'; key: string; boolSrc: string }
        > = []
        let hasComputed = false
        for (const prop of holeExpr.properties) {
          if (ts.isShorthandPropertyAssignment(prop)) {
            hasComputed = true
            break
          }
          if (ts.isPropertyAssignment(prop)) {
            const key = propertyKeyText(prop.name)
            if (key === null) {
              hasComputed = true
              break
            }
            const boolSrc = eraseSignalReadsInNode(prop.initializer, symbols.all, propsAccessors)
            for (const token of key.split(/\s+/).filter(Boolean)) {
              entries.push({ kind: 'toggle', key: token, boolSrc })
            }
          } else {
            hasComputed = true
            break
          }
        }
        if (!hasComputed) return { kind: 'classlist', entries }
      } else if (ts.isArrayLiteralExpression(holeExpr)) {
        const entries: Array<
          { kind: 'static'; token: string } | { kind: 'toggle'; key: string; boolSrc: string }
        > = []
        let hasComputed = false
        for (const element of holeExpr.elements) {
          if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
            for (const token of element.text.split(/\s+/).filter(Boolean)) {
              entries.push({ kind: 'static', token })
            }
          } else if (ts.isObjectLiteralExpression(element)) {
            for (const prop of element.properties) {
              if (ts.isShorthandPropertyAssignment(prop)) {
                hasComputed = true
                break
              }
              if (ts.isPropertyAssignment(prop)) {
                const key = propertyKeyText(prop.name)
                if (key === null) {
                  hasComputed = true
                  break
                }
                const boolSrc = eraseSignalReadsInNode(
                  prop.initializer,
                  symbols.all,
                  propsAccessors,
                )
                for (const token of key.split(/\s+/).filter(Boolean)) {
                  entries.push({ kind: 'toggle', key: token, boolSrc })
                }
              } else {
                hasComputed = true
                break
              }
            }
            if (hasComputed) break
          } else {
            hasComputed = true
            break
          }
        }
        if (!hasComputed) return { kind: 'classlist', entries }
      }
    }
    return { kind: 'attr', exprSrc: eraseSignalReadsInNode(holeExpr, symbols.all, propsAccessors) }
  }
  if (pos.kind === 'prop') {
    return { kind: 'prop', exprSrc: eraseSignalReadsInNode(holeExpr, symbols.all, propsAccessors) }
  }
  if (pos.kind === 'sync') {
    // writeTarget must be a bare enumerable signal identifier.
    if (!ts.isIdentifier(holeExpr)) {
      diagnostics.push({
        kind: 'error',
        message:
          '[nv] :PROP sync binding requires a bare signal accessor (e.g. :value="${val}"). ' +
          'Non-enumerable expressions cannot be used as sync targets. ' +
          'Use effect() for dynamic targets (§8.5.3).',
        start: holeExpr.getStart(),
        end: holeExpr.getEnd(),
      })
      return {
        kind: 'sync',
        readExprSrc: eraseSignalReadsInNode(holeExpr, symbols.all, propsAccessors),
        writeTargetSrc: holeExpr.getText(),
        eventName: defaultEventForProp(pos.propName),
      }
    }
    const identName = (holeExpr as ts.Identifier).text
    return {
      kind: 'sync',
      readExprSrc: eraseSignalReadsInNode(holeExpr, symbols.all, propsAccessors),
      writeTargetSrc: identName,
      eventName: defaultEventForProp(pos.propName),
    }
  }
  // event
  return {
    kind: 'event',
    handlerSrc: eraseHandlerExpr(holeExpr, symbols, diagnostics, propsParamName, propsAccessors),
  }
}

/**
 * Extract holeExprs and positions from a tagged-template expression.
 * Shared by computeBindingThunks and computeThunksForTemplate.
 */
function extractTemplateHoles(tte: ts.TaggedTemplateExpression): {
  holeExprs: ts.Expression[]
  positions: PosKind[]
} {
  const template = tte.template
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    return { holeExprs: [], positions: [] }
  }
  const strings: string[] = [template.head.text]
  const holeExprs: ts.Expression[] = []
  for (const span of template.templateSpans) {
    holeExprs.push(span.expression)
    strings.push(span.literal.text)
  }
  const positions: PosKind[] = holeExprs.map((_, i) =>
    classifyPosition(strings[i] ?? '', strings[i + 1] ?? ''),
  )
  return { holeExprs, positions }
}

/**
 * Compute ThunkSource[] for all bindings (components + holes) given a ProcessResult
 * plus the raw holeExprs/positions from the template.
 *
 * Used by both the top-level emit path (parseNvFileForEmit) and the conditional
 * branch path (computeThunkSource) — this is the E-2b collapse.
 */
function computeComponentThunks(
  pendingComponents: PendingNvComponentInfo[],
  holeExprs: ts.Expression[],
  positions: PosKind[],
  doc: Document,
  symbols: ScriptSymbols,
  diagnostics: NvDiagnostic[],
  propsParamName?: string,
  propsAccessors?: ReadonlyMap<string, string>,
): ThunkSource[] {
  return pendingComponents.map((pc) => ({
    kind: 'component' as const,
    componentSrc: pc.tagName,
    propSrcs: pc.reactiveHoles.map((rh) => ({
      name: rh.name,
      exprSrc: eraseSignalReadsInNode(
        holeExprs[rh.holeIndex] as ts.Expression,
        symbols.all,
        propsAccessors,
      ),
    })),
    propNames: pc.propNames,
    slots: pc.slots.map((slot, slotIdx) => {
      const holeIndices = pc.slotHoleGroups[slotIdx] ?? []
      // Build slotPropsAccessors: letNames → 'slotProps.name()' (for emit path)
      const slotLet = pc.slotLetNames?.[slotIdx] ?? []
      const slotPropsParam = 'slotProps'
      const slotPropsAccessors: Map<string, string> | undefined =
        slotLet.length > 0
          ? new Map(slotLet.map((n) => [n, `${slotPropsParam}.${n}()`]))
          : undefined
      const mergedPropsAccessors = slotPropsAccessors
        ? new Map([...(propsAccessors ?? []), ...slotPropsAccessors])
        : propsAccessors
      const thunks: ThunkSource[] = holeIndices.map((holeIdx) => {
        const holeExpr = holeExprs[holeIdx]
        if (holeExpr === undefined) {
          throw new Error(`[nv/emitter] Slot hole index ${holeIdx} out of range`)
        }
        return computeThunkSource(
          holeExpr,
          positions[holeIdx] as PosKind,
          doc,
          symbols,
          diagnostics,
          propsParamName,
          mergedPropsAccessors,
        )
      })
      return {
        name: slot.name,
        holeIndices: [...holeIndices],
        thunks,
        ...(slotLet.length > 0 && { letNames: slotLet }),
      }
    }),
  }))
}

function computeListThunks(
  pendingEachItems: PendingNvEachInfo[],
  holeExprs: ts.Expression[],
  symbols: ScriptSymbols,
  propsAccessors: ReadonlyMap<string, string> | undefined,
  doc: Document,
  positions: PosKind[],
  diagnostics: NvDiagnostic[],
  propsParamName?: string,
): ThunkSource[] {
  return pendingEachItems.map((pe) => {
    const itemsExpr = holeExprs[pe.itemsHoleIdx] as ts.Expression
    const keyExpr = holeExprs[pe.keyHoleIdx] as ts.Expression

    // .of: erase signal reads (it's a reactive list signal read)
    const itemsSrc = eraseSignalReadsInNode(itemsExpr, symbols.all, propsAccessors)

    // key: emit verbatim — it's a pure function, not a signal read
    const keySrc = keyExpr.getText()

    // Body thunks: use slotPropsAccessors for item/index
    const slotPropsParam = 'slotProps'
    const slotPropsAccessors: Map<string, string> = new Map(
      pe.letNames.map((n) => [n, `${slotPropsParam}.${n}()`]),
    )
    const mergedAccessors = new Map([...(propsAccessors ?? []), ...slotPropsAccessors])

    const {
      bodyThunks,
      bodyComponentThunks,
      bodyListThunks,
      bodyRecycledListThunks,
      bodySwitchThunks,
    } = computeBodyThunks(
      pe.nested,
      pe.bodyLeafHoleIndices,
      holeExprs,
      positions,
      doc,
      symbols,
      diagnostics,
      propsParamName,
      mergedAccessors,
    )

    return {
      kind: 'list' as const,
      itemsSrc,
      keySrc,
      bodyThunks,
      bodyComponentThunks,
      bodyListThunks,
      bodyRecycledListThunks,
      bodySwitchThunks,
      letNames: pe.letNames,
      itemReadsIndex: pe.itemReadsIndex,
    }
  })
}

function computeRecycledListThunks(
  pendingRecycleItems: PendingNvRecycleInfo[],
  holeExprs: ts.Expression[],
  symbols: ScriptSymbols,
  propsAccessors: ReadonlyMap<string, string> | undefined,
  doc: Document,
  positions: PosKind[],
  diagnostics: NvDiagnostic[],
  propsParamName?: string,
): ThunkSource[] {
  return pendingRecycleItems.map((pe) => {
    if (pe.letNames.length !== 2) {
      throw new Error(
        `[nv] <recycle> requires exactly two let-bound names (e.g. \`let={item, i}\`); got: ${JSON.stringify(pe.letNames)}`,
      )
    }

    const itemsExpr = holeExprs[pe.itemsHoleIdx] as ts.Expression
    const itemsSrc = eraseSignalReadsInNode(itemsExpr, symbols.all, propsAccessors)

    const slotPropsParam = 'slotProps'
    const slotPropsAccessors: Map<string, string> = new Map(
      pe.letNames.map((n) => [n, `${slotPropsParam}.${n}()`]),
    )
    const mergedAccessors = new Map([...(propsAccessors ?? []), ...slotPropsAccessors])

    const {
      bodyThunks,
      bodyComponentThunks,
      bodyListThunks,
      bodyRecycledListThunks,
      bodySwitchThunks,
    } = computeBodyThunks(
      pe.nested,
      pe.bodyLeafHoleIndices,
      holeExprs,
      positions,
      doc,
      symbols,
      diagnostics,
      propsParamName,
      mergedAccessors,
    )
    return {
      kind: 'recycled-list' as const,
      itemsSrc,
      bodyThunks,
      bodyComponentThunks,
      bodyListThunks,
      bodyRecycledListThunks,
      bodySwitchThunks,
      letNames: pe.letNames as [string, string],
    }
  })
}

function computeSwitchThunks(
  pendingSwitchItems: PendingNvSwitchInfo[],
  holeExprs: ts.Expression[],
  symbols: ScriptSymbols,
  propsAccessors: ReadonlyMap<string, string> | undefined,
  doc: Document,
  positions: PosKind[],
  diagnostics: NvDiagnostic[],
  propsParamName?: string,
): ThunkSource[] {
  return pendingSwitchItems.map((ps) => {
    const branchThunks = ps.branches
      .filter((b) => b.whenHoleIdx !== -1)
      .map((b) => {
        const whenExpr = holeExprs[b.whenHoleIdx] as ts.Expression
        const whenSrc = eraseSignalReadsInNode(whenExpr, symbols.all, propsAccessors)
        const {
          bodyThunks,
          bodyComponentThunks,
          bodyListThunks,
          bodyRecycledListThunks,
          bodySwitchThunks,
        } = computeBodyThunks(
          b.nested,
          b.bodyLeafHoleIndices,
          holeExprs,
          positions,
          doc,
          symbols,
          diagnostics,
          propsParamName,
          propsAccessors,
        )
        return {
          whenSrc,
          bodyThunks,
          bodyComponentThunks,
          bodyListThunks,
          bodyRecycledListThunks,
          bodySwitchThunks,
        }
      })

    const fallbackBranch = ps.hasFallback ? ps.branches[ps.branches.length - 1] : undefined
    let fallbackThunks: ThunkSource[] | null = null
    let fallbackComponentThunks: ThunkSource[] = []
    let fallbackListThunks: ThunkSource[] = []
    let fallbackRecycledListThunks: ThunkSource[] = []
    let fallbackSwitchThunks: ThunkSource[] = []
    if (fallbackBranch !== undefined) {
      const computed = computeBodyThunks(
        fallbackBranch.nested,
        fallbackBranch.bodyLeafHoleIndices,
        holeExprs,
        positions,
        doc,
        symbols,
        diagnostics,
        propsParamName,
        propsAccessors,
      )
      fallbackThunks = computed.bodyThunks
      fallbackComponentThunks = computed.bodyComponentThunks
      fallbackListThunks = computed.bodyListThunks
      fallbackRecycledListThunks = computed.bodyRecycledListThunks
      fallbackSwitchThunks = computed.bodySwitchThunks
    }

    return {
      kind: 'switch' as const,
      branches: branchThunks,
      fallbackThunks,
      fallbackComponentThunks,
      fallbackListThunks,
      fallbackRecycledListThunks,
      fallbackSwitchThunks,
    }
  })
}

/**
 * Recursively assemble the four structural thunk channels plus the hole
 * (`bodyThunks`) channel for one body/slot level. Shared by every body-producing
 * site (each/recycle/switch branch/switch fallback) — this is the single recursive
 * reconstruction that replaces the old flat "map over bodyHoleIndices only" logic.
 *
 * Must reproduce buildNvSlotContentIR's bindings order (hole → component → list →
 * recycledList → switch) — see docs/design/design-nested-structural-emit.md.
 */
function computeBodyThunks(
  pending: NestedStructuralPending,
  bodyLeafHoleIndices: number[],
  holeExprs: ts.Expression[],
  positions: PosKind[],
  doc: Document,
  symbols: ScriptSymbols,
  diagnostics: NvDiagnostic[],
  propsParamName: string | undefined,
  propsAccessors: ReadonlyMap<string, string> | undefined,
): {
  bodyThunks: ThunkSource[]
  bodyComponentThunks: ThunkSource[]
  bodyListThunks: ThunkSource[]
  bodyRecycledListThunks: ThunkSource[]
  bodySwitchThunks: ThunkSource[]
} {
  // bodyLeafHoleIndices must be LEAF-ONLY hole indices (buildNvSlotContentIR's
  // leafHoleIndices), not the full bodyHoleIndices/consumed union — the union also
  // includes holes consumed solely by a nested structural child's prop/.of/key/when,
  // which already get their own thunk via bodyComponentThunks/bodyListThunks/etc.
  // Including them here would create a phantom bodyThunks entry that shifts the
  // positional pairing emitIrLiteral relies on between bodyIR.bindings[i] and the
  // thunk array, causing "<kind>Binding thunk kind mismatch" errors at emit time.
  const bodyThunks = bodyLeafHoleIndices.map((holeIdx) => {
    const holeExpr = holeExprs[holeIdx]
    if (holeExpr === undefined)
      throw new Error(`[nv/emitter] Body hole index ${holeIdx} out of range`)
    return computeThunkSource(
      holeExpr,
      positions[holeIdx] as PosKind,
      doc,
      symbols,
      diagnostics,
      propsParamName,
      propsAccessors,
    )
  })

  const bodyComponentThunks = computeComponentThunks(
    pending.components,
    holeExprs,
    positions,
    doc,
    symbols,
    diagnostics,
    propsParamName,
    propsAccessors,
  )
  const bodyListThunks = computeListThunks(
    pending.lists,
    holeExprs,
    symbols,
    propsAccessors,
    doc,
    positions,
    diagnostics,
    propsParamName,
  )
  // pending.recycles is populated symmetrically with the other three structural
  // channels regardless of each-body/non-each-body (buildNvSlotContentIR's
  // pushRecycledListBinding call is unconditional, matching pushListBinding and
  // pushSwitchBinding) — this call's positional pairing with the bindings array
  // holds by construction, not by a parse-time guard.
  const bodyRecycledListThunks = computeRecycledListThunks(
    pending.recycles,
    holeExprs,
    symbols,
    propsAccessors,
    doc,
    positions,
    diagnostics,
    propsParamName,
  )
  const bodySwitchThunks = computeSwitchThunks(
    pending.switches,
    holeExprs,
    symbols,
    propsAccessors,
    doc,
    positions,
    diagnostics,
    propsParamName,
  )

  return {
    bodyThunks,
    bodyComponentThunks,
    bodyListThunks,
    bodyRecycledListThunks,
    bodySwitchThunks,
  }
}

function computeBindingThunks(
  pendingComponents: PendingNvComponentInfo[],
  pendingEachItems: PendingNvEachInfo[],
  pendingRecycleItems: PendingNvRecycleInfo[],
  pendingSwitchItems: PendingNvSwitchInfo[],
  consumedByComponent: ReadonlySet<number>,
  holeExprs: ts.Expression[],
  positions: PosKind[],
  doc: Document,
  symbols: ScriptSymbols,
  diagnostics: NvDiagnostic[],
  propsParamName?: string,
  propsAccessors?: ReadonlyMap<string, string>,
): ThunkSource[] {
  const componentThunks: ThunkSource[] = computeComponentThunks(
    pendingComponents,
    holeExprs,
    positions,
    doc,
    symbols,
    diagnostics,
    propsParamName,
    propsAccessors,
  )

  const listThunks: ThunkSource[] = computeListThunks(
    pendingEachItems,
    holeExprs,
    symbols,
    propsAccessors,
    doc,
    positions,
    diagnostics,
    propsParamName,
  )

  const recycledListThunks: ThunkSource[] = computeRecycledListThunks(
    pendingRecycleItems,
    holeExprs,
    symbols,
    propsAccessors,
    doc,
    positions,
    diagnostics,
    propsParamName,
  )

  const switchThunks: ThunkSource[] = computeSwitchThunks(
    pendingSwitchItems,
    holeExprs,
    symbols,
    propsAccessors,
    doc,
    positions,
    diagnostics,
    propsParamName,
  )

  const holeThunks = holeExprs
    .map((expr, i) =>
      consumedByComponent.has(i)
        ? null
        : computeThunkSource(
            expr,
            positions[i] as PosKind,
            doc,
            symbols,
            diagnostics,
            propsParamName,
            propsAccessors,
          ),
    )
    .filter((t): t is ThunkSource => t !== null)

  return [...componentThunks, ...listThunks, ...recycledListThunks, ...switchThunks, ...holeThunks]
}

/**
 * Compute ThunkSource[] for all non-consumed holes in a tagged-template expression.
 * consumed = hole indices claimed by a component element (no binding is emitted for them).
 */
function computeThunksForTemplate(
  tte: ts.TaggedTemplateExpression,
  doc: Document,
  symbols: ScriptSymbols,
  diagnostics: NvDiagnostic[],
  consumed: ReadonlySet<number> = new Set(),
  propsParamName?: string,
  propsAccessors?: ReadonlyMap<string, string>,
): ThunkSource[] {
  const template = tte.template
  if (ts.isNoSubstitutionTemplateLiteral(template)) return []

  const strings: string[] = [template.head.text]
  const holeExprs: ts.Expression[] = []
  for (const span of template.templateSpans) {
    holeExprs.push(span.expression)
    strings.push(span.literal.text)
  }
  const positions: PosKind[] = holeExprs.map((_, i) =>
    classifyPosition(strings[i] ?? '', strings[i + 1] ?? ''),
  )

  return holeExprs
    .map((expr, i) =>
      consumed.has(i)
        ? null
        : computeThunkSource(
            expr,
            positions[i] as PosKind,
            doc,
            symbols,
            diagnostics,
            propsParamName,
            propsAccessors,
          ),
    )
    .filter((t): t is ThunkSource => t !== null)
}

/**
 * Extract the erased $script body source from a component's $script blocks.
 * Uses the POST-preprocessMutationWrites source file so the text is already erased.
 */
function extractScriptBodySource(componentFn: ts.ArrowFunction): string {
  if (!ts.isBlock(componentFn.body)) return ''
  const parts: string[] = []
  for (const stmt of componentFn.body.statements) {
    if (!ts.isExpressionStatement(stmt)) continue
    const call = stmt.expression
    if (!ts.isCallExpression(call) || !isNvConstruct(call, '$script')) continue
    const fn = call.arguments[0]
    if (!fn || !ts.isArrowFunction(fn) || !ts.isBlock(fn.body)) continue
    for (const s of fn.body.statements) {
      parts.push(s.getText())
    }
  }
  return parts.join('\n')
}

/**
 * Extract module scope: top-level imports and statements that are NOT $component
 * variable declarations. Returned verbatim from the processed source.
 */
function extractModuleScope(sf: ts.SourceFile): string {
  const parts: string[] = []
  ts.forEachChild(sf, (node) => {
    // Include import declarations verbatim
    if (ts.isImportDeclaration(node)) {
      parts.push(node.getText())
      return
    }
    // Skip $component variable statements
    if (ts.isVariableStatement(node)) {
      const isComponent = node.declarationList.declarations.some(
        (decl) =>
          decl.initializer &&
          ts.isCallExpression(decl.initializer) &&
          isNvConstruct(decl.initializer, '$component'),
      )
      if (isComponent) return
      parts.push(node.getText())
      return
    }
    // Include all other top-level statements (expression statements, etc.)
    if (
      !ts.isVariableStatement(node) &&
      !ts.isImportDeclaration(node) &&
      node.kind !== ts.SyntaxKind.EndOfFileToken
    ) {
      parts.push(node.getText())
    }
  })
  return parts.join('\n')
}

// ── Build-pipeline API ────────────────────────────────────────────────────────

/**
 * Parse a .nv source for the build pipeline.
 *
 * Like parseNvFile, but also computes the `emit` payload on each result:
 *   - scriptBody: erased $script statements
 *   - bindingThunks: per-binding erased thunk source (index-aligned with ir.bindings)
 *   - moduleScope: top-level imports + non-$component statements
 *
 * Render-hole erasure (§4):
 *   - Non-event holes: bare-read erasure via eraseSignalReadsInNode
 *   - Event handler holes: bare-read + mutation-write erasure via eraseHandlerExpr
 *
 * @param source    Raw .nv source text
 * @param fileName  File name (for TS parser)
 * @param doc       jsdom Document (build-time; used for HTML parsing)
 */
export function parseNvFileForEmit(
  source: string,
  fileName: string,
  doc: Document,
): NvComponentResult[] {
  const diagnostics: NvDiagnostic[] = []

  // Pre-pass on original (pre-preprocessed) source to extract props accessor maps,
  // since preprocessMutationWrites erases `const { ... } = props` from $script blocks.
  const originalSf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  )
  const propsAccessorsByComponent = new Map<string, Map<string, string>>()
  ts.forEachChild(originalSf, (node) => {
    if (!ts.isVariableStatement(node)) return
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
      if (!isNvConstruct(decl.initializer, '$component')) continue
      const componentFn = decl.initializer.arguments[0]
      if (!componentFn || !ts.isArrowFunction(componentFn)) continue
      const propsParamName =
        componentFn.parameters.length > 0 &&
        componentFn.parameters[0] !== undefined &&
        ts.isIdentifier(componentFn.parameters[0].name)
          ? componentFn.parameters[0].name.text
          : undefined
      if (propsParamName === undefined) continue
      const accessors = extractPropsAccessors(componentFn, propsParamName, diagnostics)
      if (accessors.size > 0) propsAccessorsByComponent.set(decl.name.text, accessors)
    }
  })

  const processed = preprocessMutationWrites(source, fileName, diagnostics)

  const sf = ts.createSourceFile(
    fileName,
    processed,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  )

  const moduleScope = extractModuleScope(sf)
  const results: NvComponentResult[] = []

  ts.forEachChild(sf, (node) => {
    if (!ts.isVariableStatement(node)) return
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
      if (!isNvConstruct(decl.initializer, '$component')) continue
      const componentFn = decl.initializer.arguments[0]
      if (!componentFn || !ts.isArrowFunction(componentFn)) continue

      const name = decl.name.text
      const symbols = extractScriptSymbols(componentFn)
      const renderResult = extractRenderTemplate(componentFn, doc, symbols)
      if (renderResult === null) continue

      const scriptBody = extractScriptBodySource(componentFn)

      // Detect props parameter name from $component((props) => ...)
      const emitPropsParamName: string | undefined =
        componentFn.parameters.length > 0 &&
        componentFn.parameters[0] !== undefined &&
        ts.isIdentifier(componentFn.parameters[0].name)
          ? componentFn.parameters[0].name.text
          : undefined

      // Find the $render template expression to compute thunks
      const emitDiagnostics: NvDiagnostic[] = []

      // Retrieve props accessor map from the pre-pass on the original source
      // (preprocessMutationWrites erases `const { ... } = props` before we can scan it)
      const emitPropsAccessors: ReadonlyMap<string, string> =
        propsAccessorsByComponent.get(name) ?? new Map()
      let bindingThunks: ThunkSource[] = []
      if (ts.isBlock(componentFn.body)) {
        for (const stmt of componentFn.body.statements) {
          if (!ts.isExpressionStatement(stmt)) continue
          const call = stmt.expression
          if (!ts.isCallExpression(call) || !isNvConstruct(call, '$render')) continue
          const fn = call.arguments[0]
          if (!fn || !ts.isArrowFunction(fn)) continue
          const body = fn.body
          if (
            !ts.isTaggedTemplateExpression(body) ||
            !ts.isIdentifier(body.tag) ||
            body.tag.text !== 'html'
          )
            continue
          const { pendingComponents, consumedByComponent } = renderResult
          const { holeExprs: bodyHoleExprs, positions: bodyPositions } = extractTemplateHoles(body)
          bindingThunks = computeBindingThunks(
            pendingComponents,
            renderResult.pendingEachItems,
            renderResult.pendingRecycleItems,
            renderResult.pendingSwitchItems,
            consumedByComponent,
            bodyHoleExprs,
            bodyPositions,
            doc,
            symbols,
            emitDiagnostics,
            emitPropsParamName,
            emitPropsAccessors,
          )
          break
        }
      }

      const allDiagnostics = [...diagnostics, ...emitDiagnostics, ...renderResult.diagnostics]

      const styleInfo = extractStyleInfo(componentFn, symbols)
      const scopeHash = simpleHash(`${renderResult.shapeHtml}\0${styleInfo?.source ?? ''}`)
      if (styleInfo !== null) {
        const artifact = buildStyleArtifact(styleInfo, scopeHash, symbols)
        renderResult.ir.styleArtifact = {
          staticCss: artifact.staticCss,
          scopeHash,
          varBindingDescs: artifact.varBindingDescs.map(({ varName, exprSrc, propertyName }) => ({
            varName,
            exprSrc,
            propertyName,
          })),
        }
        if (artifact.varBindingDescs.length > 0) {
          applyVarBindingsToIr(renderResult.ir, artifact.varBindingDescs, bindingThunks)
        }
        patchClasslistTokens(renderResult.ir, artifact.classRewrites)
        renderResult.ir.classRewrites = artifact.classRewrites
      }
      results.push({
        name,
        ir: renderResult.ir,
        scriptSignals: [...symbols.writable, ...symbols.readonly],
        style: styleInfo,
        verdicts: renderResult.verdicts,
        diagnostics: allDiagnostics,
        emit: {
          scriptBody,
          bindingThunks,
          moduleScope,
        },
      })
    }
  })

  return results
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function simpleHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}
