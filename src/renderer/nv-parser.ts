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
import type {
  AttrBinding,
  Binding,
  ComponentBinding,
  ConditionalBinding,
  EventBinding,
  HandlerExpr,
  NodePath,
  PropBinding,
  PropEntry,
  ReactiveExpr,
  SlotEntry,
  TemplateIR,
  TemplateShape,
  TextBinding,
} from './ir.js'

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
      slots: Array<{ name: string; thunks: ThunkSource[] }>
    }

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
  keys: readonly string[]
  source: string
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

function classifyPosition(prevString: string, nextString: string): PosKind {
  const isClosingQuote = nextString.startsWith('"') || nextString.startsWith("'")
  const em = prevString.match(/\s@([\w:-]+)=["']$/)
  if (em !== null && isClosingQuote) return { kind: 'event', eventName: em[1] as string }
  const pm = prevString.match(/\s\.([\w-]+)=["']$/)
  if (pm !== null && isClosingQuote) return { kind: 'prop', name: pm[1] as string }
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
    /\s+data-nv-(?:attr|prop|event)-\d+="[^"]*"|\s+data-nv-component="[^"]*"/g,
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
}

interface ProcessResult {
  ir: TemplateIR
  verdicts: Array<'ACCEPT' | 'PLAIN'>
  pendingComponents: PendingNvComponentInfo[]
  consumedByComponent: ReadonlySet<number>
  diagnostics: NvDiagnostic[]
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
      consumedByComponent: new Set<number>(),
      diagnostics: [],
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

  const { sentinelHtml, shapeHtml } = buildNvHtmlStrings(strings, positions)

  const tmpl = doc.createElement('template')
  tmpl.innerHTML = sentinelHtml
  const frag = tmpl.content

  const stubExpr = (() => undefined) as ReactiveExpr<unknown>
  const stubHandler = (() => (_e: Event) => undefined) as HandlerExpr

  const bindingPaths: NodePath[] = new Array(holeExprs.length).fill(null)
  const consumedByComponent = new Set<number>()

  interface PendingNvComponent {
    anchorPath: NodePath
    tagName: string
    propEntries: PropEntry[]
    propNames: string[]
    reactiveHoles: Array<{ name: string; holeIndex: number }>
    slots: SlotEntry[]
  }
  const pendingComponents: PendingNvComponent[] = []
  const processdiagnostics: NvDiagnostic[] = []
  ;(function walk(node: Node): void {
    if (node.nodeType === 8) {
      const m = (node as Comment).data.match(/^nv-(\d+)$/)
      if (m !== null) bindingPaths[Number.parseInt(m[1] as string, 10)] = computePath(node, frag)
    } else if (node.nodeType === 1) {
      const el = node as Element

      // Component element detection via data-nv-component sentinel
      const compName = el.getAttribute('data-nv-component')
      if (compName !== null) {
        el.removeAttribute('data-nv-component')
        const tagName = compName
        const propEntries: PropEntry[] = []
        const propNames: string[] = []
        const reactiveHoles: Array<{ name: string; holeIndex: number }> = []

        for (let k = 0; k < holeExprs.length; k++) {
          for (const atype of ['attr', 'prop', 'event'] as const) {
            const v = el.getAttribute(`data-nv-${atype}-${k}`)
            if (v !== null) {
              el.removeAttribute(`data-nv-${atype}-${k}`)
              propEntries.push({ name: v, expr: stubExpr })
              propNames.push(v)
              reactiveHoles.push({ name: v, holeIndex: k })
              consumedByComponent.add(k)
            }
          }
        }

        // Gather static (plain) attributes on the component element
        const staticAttrs = Array.from(el.attributes)
        for (const attr of staticAttrs) {
          const val = attr.value
          propEntries.push({ name: attr.name, expr: () => val })
          if (!propNames.includes(attr.name)) propNames.push(attr.name)
        }

        // Capture slot content before replacing element with anchor
        const slots: SlotEntry[] = []
        if (el.childNodes.length > 0) {
          const innerHTML = el.innerHTML
          if (/<!--nv-\d+-->|data-nv-/.test(innerHTML)) {
            // Mark any hole indices embedded in slot children as consumed so path-check passes
            const holeRe = /<!--nv-(\d+)-->/g
            let m2: RegExpExecArray | null
            // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
            while ((m2 = holeRe.exec(innerHTML)) !== null) {
              consumedByComponent.add(Number.parseInt(m2[1] as string, 10))
            }
            processdiagnostics.push({
              kind: 'warning',
              message: `Dynamic slot content in <${tagName}> is not yet supported`,
              start: 0,
              end: 0,
            })
          } else {
            // Static slot content
            const slotIR: TemplateIR = {
              id: `slot:${tagName}:default`,
              shape: { html: innerHTML, bindingPaths: [] },
              bindings: [],
            }
            slots.push({ name: 'default', content: slotIR })
          }
        }
        const compIndex = pendingComponents.length
        const anchor = doc.createComment(`nv-comp-${compIndex}`)
        el.parentNode?.replaceChild(anchor, el)
        const anchorPath = computePath(anchor, frag)
        pendingComponents.push({
          anchorPath,
          tagName,
          propEntries,
          propNames,
          reactiveHoles,
          slots,
        })
        return // don't recurse into component children
      }

      for (let k = 0; k < holeExprs.length; k++) {
        for (const atype of ['attr', 'prop', 'event'] as const) {
          const v = el.getAttribute(`data-nv-${atype}-${k}`)
          if (v !== null) {
            bindingPaths[k] = computePath(el, frag)
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
  })(frag)

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

  for (let i = 0; i < holeExprs.length; i++) {
    if (consumedByComponent.has(i)) {
      verdicts.push('PLAIN')
      continue
    }
    const pos = positions[i] as PosKind
    const holeExpr = holeExprs[i] as ts.Expression
    const pathIndex = holeCompactIdx[i] as number
    verdicts.push(exprReadsSignal(holeExpr, signals) ? 'ACCEPT' : 'PLAIN')

    if (pos.kind === 'text') {
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
            alternate: isHtmlTTE(whenFalse)
              ? processHtmlTemplate(whenFalse, doc, signals).ir
              : null,
          }
          bindings.push(b)
          continue
        }
      }
      const b: TextBinding = {
        kind: 'text',
        pathIndex,
        expr: stubExpr as ReactiveExpr<string | number | boolean | null | undefined>,
      }
      bindings.push(b)
    } else if (pos.kind === 'attr') {
      const b: AttrBinding = {
        kind: 'attr',
        pathIndex,
        name: pos.name,
        expr: stubExpr as ReactiveExpr<string | number | boolean | null | undefined>,
      }
      bindings.push(b)
    } else if (pos.kind === 'prop') {
      const b: PropBinding = { kind: 'prop', pathIndex, name: pos.name, expr: stubExpr }
      bindings.push(b)
    } else {
      const b: EventBinding = {
        kind: 'event',
        pathIndex,
        eventName: pos.eventName,
        handler: stubHandler,
        handlerKind: 'reactive',
      }
      bindings.push(b)
    }
  }

  return {
    ir: {
      id: `nv:${simpleHash(shapeHtml)}`,
      shape: { html: shapeHtml, bindingPaths: allPaths as NodePath[] },
      bindings,
      meta: { frontEnd: 'nv-file' },
    },
    verdicts,
    pendingComponents: pendingComponents.map(({ tagName, propNames, reactiveHoles, slots }) => ({
      tagName,
      propNames,
      reactiveHoles,
      slots,
    })),
    consumedByComponent,
    diagnostics: processdiagnostics,
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

function extractStyleInfo(componentFn: ts.ArrowFunction): NvStyleInfo | null {
  if (!ts.isBlock(componentFn.body)) return null
  for (const stmt of componentFn.body.statements) {
    if (!ts.isExpressionStatement(stmt)) continue
    const call = stmt.expression
    if (!ts.isCallExpression(call) || !isNvConstruct(call, '$style')) continue
    const arg = call.arguments[0]
    if (!arg) return null
    const src = arg.getText()
    if (ts.isObjectLiteralExpression(arg)) {
      const keys = arg.properties
        .filter(ts.isPropertyAssignment)
        .map((p) =>
          ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : '',
        )
        .filter(Boolean)
      return { form: 'object', keys, source: src }
    }
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
      const fnBody = ts.isArrowFunction(arg) ? arg.body : arg.body
      const objExpr = ts.isObjectLiteralExpression(fnBody)
        ? fnBody
        : ts.isParenthesizedExpression(fnBody) && ts.isObjectLiteralExpression(fnBody.expression)
          ? fnBody.expression
          : null
      const keys: string[] = []
      if (objExpr !== null)
        for (const p of objExpr.properties)
          if (ts.isPropertyAssignment(p)) {
            const k = ts.isIdentifier(p.name)
              ? p.name.text
              : ts.isStringLiteral(p.name)
                ? p.name.text
                : ''
            if (k) keys.push(k)
          }
      return { form: 'factory', keys, source: src }
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
        if (ts.isPropertyAccessExpression(p) && (p.expression === n || p.name === n)) return
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
      results.push({
        name,
        ir: renderResult.ir,
        scriptSignals: [...symbols.writable, ...symbols.readonly],
        style: extractStyleInfo(componentFn),
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
): string {
  if (!ts.isArrowFunction(handlerExpr)) {
    // Non-arrow handler (e.g., bare identifier): just erase bare reads
    return eraseSignalReadsInNode(handlerExpr, symbols.all)
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
          const erasedRhs = eraseSignalReadsInNode(rhs, symbols.all)
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
          const erasedRhs = eraseSignalReadsInNode(rhs, symbols.all)
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
        // Recursively compute thunks for branch bindings
        const consequentResult = processHtmlTemplate(whenTrue, doc, symbols.all)
        const consequentThunks = computeThunksForTemplate(
          whenTrue,
          doc,
          symbols,
          diagnostics,
          new Set(),
          propsParamName,
          propsAccessors,
        )
        void consequentResult
        const alternateSrc = isHtmlTTE(whenFalse)
          ? computeThunksForTemplate(
              whenFalse,
              doc,
              symbols,
              diagnostics,
              new Set(),
              propsParamName,
              propsAccessors,
            )
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
    return { kind: 'attr', exprSrc: eraseSignalReadsInNode(holeExpr, symbols.all, propsAccessors) }
  }
  if (pos.kind === 'prop') {
    return { kind: 'prop', exprSrc: eraseSignalReadsInNode(holeExpr, symbols.all, propsAccessors) }
  }
  // event
  return {
    kind: 'event',
    handlerSrc: eraseHandlerExpr(holeExpr, symbols, diagnostics, propsParamName),
  }
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
          const bodyHoleExprs: ts.Expression[] = ts.isNoSubstitutionTemplateLiteral(body.template)
            ? []
            : body.template.templateSpans.map((s) => s.expression)
          const componentThunks: ThunkSource[] = pendingComponents.map((pc) => ({
            kind: 'component' as const,
            componentSrc: pc.tagName,
            propSrcs: pc.reactiveHoles.map((rh) => ({
              name: rh.name,
              exprSrc: (bodyHoleExprs[rh.holeIndex] as ts.Expression).getText(),
            })),
            propNames: pc.propNames,
            slots: [],
          }))
          const holeThunks = computeThunksForTemplate(
            body,
            doc,
            symbols,
            emitDiagnostics,
            consumedByComponent,
            emitPropsParamName,
            emitPropsAccessors,
          )
          bindingThunks = [...componentThunks, ...holeThunks]
          break
        }
      }

      const allDiagnostics = [...diagnostics, ...emitDiagnostics, ...renderResult.diagnostics]

      results.push({
        name,
        ir: renderResult.ir,
        scriptSignals: [...symbols.writable, ...symbols.readonly],
        style: extractStyleInfo(componentFn),
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

function simpleHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}
