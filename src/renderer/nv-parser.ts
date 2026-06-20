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
 *   - Block-scoped shadowing (`const count = 0` inside an `if` block) is not
 *     tracked — only function-scope shadowing (parameters and function-body
 *     declarations). `var` hoisting is also handled at function scope.
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
  ConditionalBinding,
  EventBinding,
  HandlerExpr,
  NodePath,
  PropBinding,
  ReactiveExpr,
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

export interface NvComponentResult {
  name: string
  ir: TemplateIR
  /** Combined list of signal() and derived() names from $script blocks. */
  scriptSignals: readonly string[]
  style: NvStyleInfo | null
  verdicts: ReadonlyArray<'ACCEPT' | 'PLAIN'>
  diagnostics: ReadonlyArray<NvDiagnostic>
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

  const shapeHtml = sentinelHtml.replace(/\s+data-nv-(?:attr|prop|event)-\d+="[^"]*"/g, '')
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

interface ProcessResult {
  ir: TemplateIR
  verdicts: Array<'ACCEPT' | 'PLAIN'>
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

  const bindingPaths: NodePath[] = new Array(holeExprs.length).fill(null)
  ;(function walk(node: Node): void {
    if (node.nodeType === 8) {
      const m = (node as Comment).data.match(/^nv-(\d+)$/)
      if (m !== null) bindingPaths[Number.parseInt(m[1] as string, 10)] = computePath(node, frag)
    } else if (node.nodeType === 1) {
      const el = node as Element
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
    if (bindingPaths[i] === null)
      throw new Error(
        `[nv/nv-parser] No sentinel for hole ${i}. Sentinel: ${sentinelHtml.slice(0, 200)}`,
      )
  }

  const bindings: Binding[] = []
  const verdicts: Array<'ACCEPT' | 'PLAIN'> = []
  const stubExpr = (() => undefined) as ReactiveExpr<unknown>
  const stubHandler = (() => (_e: Event) => undefined) as HandlerExpr

  for (let i = 0; i < holeExprs.length; i++) {
    const pos = positions[i] as PosKind
    const holeExpr = holeExprs[i] as ts.Expression
    const pathIndex = i
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
      shape: { html: shapeHtml, bindingPaths: bindingPaths as NodePath[] },
      bindings,
      meta: { frontEnd: 'nv-file' },
    },
    verdicts,
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
function eraseSignalReadsInNode(node: ts.Node, reactive: ReadonlySet<string>): string {
  if (reactive.size === 0) return node.getText()
  const rewrites: Rewrite[] = []
  const nodeStart = node.getStart()
  ;(function walk(n: ts.Node): void {
    if (ts.isIdentifier(n) && reactive.has(n.text)) {
      const p = n.parent
      if (ts.isCallExpression(p) && p.expression === n) return
      if (ts.isPropertyAccessExpression(p) && (p.expression === n || p.name === n)) return
      if (ts.isVariableDeclaration(p) && p.name === n) return
      if (ts.isParameter(p) && p.name === n) return
      if (ts.isShorthandPropertyAssignment(p)) return
      if (ts.isPropertyAssignment(p) && p.name === n) return
      if (ts.isImportSpecifier(p) || ts.isImportClause(p)) return
      if (ts.isLabeledStatement(p) && p.label === n) return
      rewrites.push({ start: n.getStart(), end: n.getEnd(), replacement: `${n.text}()` })
      return
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
): void {
  // Walk CHILDREN of the $script body directly — not the body block itself.
  // This prevents gatherBlockShadows from treating the $script's own `const count = signal(0)`
  // declarations as shadows (they are reactive declarations, not local shadows).
  ts.forEachChild(block, (child) => walk(child, new Set<string>()))

  function walk(node: ts.Node, shadowed: ReadonlySet<string>): void {
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
      const symbols = collectScriptSymbols(blocks)
      for (const block of blocks) eraseScriptBlock(block, symbols, rewrites, diagnostics)
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
        diagnostics: [...diagnostics],
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
