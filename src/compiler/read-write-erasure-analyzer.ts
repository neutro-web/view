/**
 * nv Compiler — Read/Write Erasure Analysis Pass (Phase 1)
 * Stream:   (2) Compiler specialization layer / (3) Renderer seam
 * Contract: nv-template-ir.md v0.2; Soundness design 2026-06-18
 *
 * Analyzes `html` tagged-template call sites in a TypeScript program and emits
 * per-hole verdicts (ACCEPT / DECLINE / PLAIN) for read/write erasure.
 *
 * Phase 1 scope:
 *   READ ERASURE:  Identifies whether a non-event hole expression contains a
 *     provable nv reactive read. A hole with no reactive reads → PLAIN (still
 *     wired as an effect for correctness; optimizer hint only). The dangerous
 *     missed-read case (where a reactive read was silently dropped, causing a
 *     stale binding) is visible: it surfaces as PLAIN rather than ACCEPT, and
 *     the differential gate catches the DOM not updating.
 *
 *   WRITE ERASURE: Detects `.set()` calls in event-attribute holes (including
 *     inside nested handler bodies — the handler body executes at event-fire
 *     time and is part of this binding's write surface). If the call's receiver
 *     SignalId matches a sync-target → DECLINE + diagnostic.
 *
 * Soundness invariants:
 *   1. DECLINE never suppresses a binding. The binding is wired as-is (correctness);
 *      the diagnostic surfaces the issue without producing a wrong result.
 *   2. Uses signalSymbolId from signal-type-utils — SAME derivation as the sync
 *      classifier. Do not re-derive SignalId in this pass.
 *   3. All-or-nothing per hole: if any sub-expression is unanalyzable (opaque call,
 *      etc.) the verdict is conservative (PLAIN for reads, ACCEPT for event writes
 *      if no sync-target found). The dangerous direction — asserting a read is
 *      reactive when it isn't, or asserting a write is safe when it isn't — must
 *      never happen.
 *   4. Reads inside untrack() are not reactive (consistent with steps 2, 4).
 *      Writes inside untrack() ARE writes and ARE checked (untrack does not
 *      make a write safe — it only prevents tracking, not writing).
 *   5. Read analysis for event holes: the outer thunk returns a function (the
 *      handler); the outer thunk itself has no reactive reads at effect time.
 *      Event holes are always wired in effects (v0 always-reactive), so read
 *      analysis for them is vacuous. Event holes that pass write safety → ACCEPT.
 *
 * Cross-pass identity seam: syncTargetIds MUST come from the SyncTargetClassifier
 * via the same signalSymbolId derivation. Mismatched derivations silently miss
 * sync-target writes. This seam has been the load-bearing cross-pass constraint
 * since step 1.
 */

import * as ts from 'typescript'
import {
  isLiteralKeyExpr,
  isNvSignalType,
  signalSymbolId,
  symbolIsFromNvCore,
} from './signal-type-utils.js'
import type {
  BindingErasureVerdict,
  ClassifierConfig,
  SignalId,
  TemplateErasureResult,
} from './types.js'

// ── Hole context ───────────────────────────────────────────────────────────────

type HoleContext = { kind: 'text' } | { kind: 'attr'; name: string; isEvent: boolean }

/**
 * Classify the hole between prevStr and nextStr.
 * Mirrors html-tag.ts classifyHole so analysis and front-end agree on context.
 */
function classifyHoleContext(prevStr: string, nextStr: string): HoleContext {
  const m = prevStr.match(/\s([\w:-]+)=["']$/)
  if (m !== null && (nextStr.startsWith('"') || nextStr.startsWith("'"))) {
    const name = m[1] ?? ''
    return { kind: 'attr', name, isEvent: name.startsWith('on') }
  }
  return { kind: 'text' }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export class ReadWriteErasureAnalyzer {
  private readonly nvCorePath: string
  private readonly syncTargetIds: ReadonlySet<SignalId>

  constructor(config: ClassifierConfig, syncTargetIds: ReadonlySet<SignalId> = new Set()) {
    this.nvCorePath = config.nvCorePath
    this.syncTargetIds = syncTargetIds
  }

  /** Analyze all `html` tagged-template calls across the full program. */
  analyzeProgram(program: ts.Program): TemplateErasureResult[] {
    const results: TemplateErasureResult[] = []
    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue
      for (const r of this.analyzeFile(program, sf)) results.push(r)
    }
    return results
  }

  /**
   * Analyze `html` tagged-template calls in a specific source file.
   * Public for targeted testing (analyze only the fixture file, not core.ts etc.).
   */
  analyzeFile(program: ts.Program, sf: ts.SourceFile): TemplateErasureResult[] {
    const checker = program.getTypeChecker()
    const results: TemplateErasureResult[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isTaggedTemplateExpression(node) && this.isHtmlTag(node)) {
        const r = this.analyzeTaggedTemplate(node, checker)
        if (r !== null) results.push(r)
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(sf, visit)
    return results
  }

  /**
   * Analyze a single tagged-template expression.
   * Returns null if the tag can't be confirmed as the nv html tag.
   * Public for targeted testing.
   */
  analyzeTaggedTemplate(
    tte: ts.TaggedTemplateExpression,
    checker: ts.TypeChecker,
  ): TemplateErasureResult | null {
    const template = tte.template
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      return { callNode: tte, verdicts: [] }
    }

    const strings: string[] = [template.head.text]
    const holes: ts.Expression[] = []
    for (const span of template.templateSpans) {
      holes.push(span.expression)
      strings.push(span.literal.text)
    }

    const verdicts: BindingErasureVerdict[] = holes.map((expr, i) => {
      const ctx = classifyHoleContext(strings[i] ?? '', strings[i + 1] ?? '')
      return this.analyzeHole(expr, ctx, i, checker)
    })

    return { callNode: tte, verdicts }
  }

  // ── Tag identification ─────────────────────────────────────────────────────

  /**
   * Confirm the tagged template tag is the nv html function.
   *
   * Phase 1: convention check — tag name is 'html'. Production hardening:
   * nominal origin check (verify tag resolves to createHtmlTag's return type
   * declared in the nv renderer package). Flagged for post-integration hardening.
   * The convention check errs safe: false positives (extra diagnostics on user
   * 'html' functions) are visible; false negatives (missed sync-target writes)
   * are not.
   */
  private isHtmlTag(tte: ts.TaggedTemplateExpression): boolean {
    const tag = tte.tag
    if (ts.isIdentifier(tag)) return tag.text === 'html'
    if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.name)) {
      return tag.name.text === 'html'
    }
    return false
  }

  // ── Per-hole analysis ──────────────────────────────────────────────────────

  /**
   * Analyze a single expression hole.
   *
   * Event attribute holes (onclick, oninput, etc.):
   *   1. Write-safety check: scan the entire expression (including nested handler
   *      bodies) for .set() calls on sync-target signals → DECLINE if found.
   *   2. If write-safe: ACCEPT. Event holes are always wired in effects (v0
   *      always-reactive). The outer thunk returns a handler function — its own
   *      reactive reads (if any) are tracked by the effect; no read analysis needed.
   *
   * Non-event holes (text content, data attributes):
   *   1. Write-safety check (opaque writes in non-event positions are unusual but
   *      possible, e.g. a thunk that calls a side-effectful helper).
   *   2. Read analysis: does the outer thunk body contain a reactive nv signal read?
   *      → ACCEPT if yes, PLAIN if no.
   *
   * PLAIN is never an error — it's a compiler hint that the effect will have no
   * reactive sources. The binding is still wired; the differential gate catches
   * any case where this analysis is wrong (DOM won't update, caught by gate case 1).
   */
  private analyzeHole(
    expr: ts.Expression,
    ctx: HoleContext,
    index: number,
    checker: ts.TypeChecker,
  ): BindingErasureVerdict {
    // Write-safety check applies regardless of hole kind
    const writeViolations = this.findSetCallsToSyncTargets(expr, checker)
    if (writeViolations.length > 0) {
      const syncTargetId = writeViolations[0] as SignalId
      const attrName = ctx.kind === 'attr' ? ctx.name : '(text position)'
      return {
        kind: 'DECLINE',
        expressionIndex: index,
        reason: `expression at "${attrName}" contains a .set() call on a sync-target signal`,
        diagnostic: `Binding at position ${index} ('${attrName}'): the expression calls .set() on a signal that is already written by a sync() construct. This creates a second writer that the §8.5.2 write-graph cycle checker never analyzed. Remove this write or route it through the sync() machinery instead.`,
        syncTargetId,
      }
    }

    // Event attribute holes: write-safe → ACCEPT (always wired in effect, v0 always-reactive)
    if (ctx.kind === 'attr' && ctx.isEvent) {
      return { kind: 'ACCEPT', expressionIndex: index }
    }

    // Non-event holes: read analysis
    const hasReactiveRead = this.hasNvSignalReadInOuterThunk(expr, checker)
    if (!hasReactiveRead) {
      return {
        kind: 'PLAIN',
        expressionIndex: index,
        reason:
          'hole expression outer thunk contains no provable nv signal reads — ' +
          'effect will have no reactive sources (still wired; optimizer hint only)',
      }
    }

    return { kind: 'ACCEPT', expressionIndex: index }
  }

  // ── Write safety: find .set() calls targeting sync signals ─────────────────

  /**
   * Walk an expression (recursively, including into nested function bodies) for
   * `.set(...)` calls on nv signal types whose receiver SignalId is in syncTargetIds.
   *
   * Recurses into nested functions: the event handler body executes at event-fire
   * time and is part of this binding's write surface. A write inside the handler
   * is attributed to this binding site even though it runs outside the reactive graph.
   *
   * Does NOT skip untrack() subtrees: untrack prevents tracking, not writing.
   * A .set() inside untrack() is still a write and is still checked.
   */
  private findSetCallsToSyncTargets(root: ts.Node, checker: ts.TypeChecker): SignalId[] {
    const violations: SignalId[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.name) &&
          callee.name.text === 'set'
        ) {
          const receiverType = checker.getTypeAtLocation(callee.expression)
          if (isNvSignalType(receiverType, checker, this.nvCorePath)) {
            const id = this.resolveId(callee.expression, checker)
            if (id !== null && this.syncTargetIds.has(id)) {
              violations.push(id)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(root)
    return violations
  }

  // ── Read erasure: reactive read detection in outer thunk ───────────────────

  /**
   * Check whether the OUTER thunk body contains at least one nv signal read
   * (a call expression whose callee type is an nv SignalAccessor).
   *
   * "Outer thunk body" means: the body of the hole expression's arrow/function
   * wrapper — the code that executes during the reactive effect's run. Code inside
   * nested function definitions (like event handlers) executes at a different time
   * (event-fire, not effect-run) and does NOT count as a reactive read here.
   *
   * Examples:
   *   () => count()           → body = count(); count is nv signal → true (ACCEPT)
   *   () => localVar          → body = localVar; not a signal call → false (PLAIN)
   *   () => (e) => count()    → body = (e) => count(); body IS a nested function
   *                             (the outer thunk wraps a handler) → skip body →
   *                             false (PLAIN — outer thunk has no reactive read;
   *                             ACCEPT is returned by the event-hole path instead)
   *
   * Reads inside untrack() are excluded (consistent with steps 2, 4).
   */
  private hasNvSignalReadInOuterThunk(holeExpr: ts.Expression, checker: ts.TypeChecker): boolean {
    // Extract the outer thunk body (one level of function unwrapping)
    const body = this.getOuterThunkBody(holeExpr, checker)
    if (body === null) return false

    let found = false
    const visit = (node: ts.Node): void => {
      if (found) return

      // Stop at nested function definitions: reads inside them execute at a
      // different time (not during the reactive effect's tracking run).
      if (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node)
      ) {
        return // do not recurse
      }

      if (ts.isCallExpression(node)) {
        // Skip untrack() subtrees — reads inside are not reactive
        if (this.isUntrackedCall(node, checker)) return

        const calleeType = checker.getTypeAtLocation(node.expression)
        if (isNvSignalType(calleeType, checker, this.nvCorePath)) {
          found = true
          return
        }
      }

      ts.forEachChild(node, visit)
    }
    visit(body)
    return found
  }

  /**
   * Extract the body of an arrow function or function expression (one level).
   * Follows a single identifier → initializer link.
   * Returns null if the expression is not a function.
   */
  private getOuterThunkBody(expr: ts.Expression, checker: ts.TypeChecker): ts.Node | null {
    let resolved: ts.Expression = expr
    if (ts.isIdentifier(resolved)) {
      const sym = checker.getSymbolAtLocation(resolved)
      const decl = sym?.valueDeclaration ?? sym?.declarations?.[0]
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
        resolved = decl.initializer
      }
    }
    if (ts.isArrowFunction(resolved)) return resolved.body
    if (ts.isFunctionExpression(resolved)) return resolved.body
    return null
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  /**
   * Resolve the SignalId for a signal expression (callee receiver).
   * Handles: Identifier, PropertyAccess (obj.prop), ElementAccess (obj['key']).
   * Returns null for parameters (cross-boundary) or unresolvable symbols.
   *
   * Uses signalSymbolId — SAME derivation as the sync classifier.
   */
  private resolveId(expr: ts.Expression, checker: ts.TypeChecker): SignalId | null {
    let sym: ts.Symbol | undefined

    if (ts.isIdentifier(expr)) {
      sym = checker.getSymbolAtLocation(expr)
    } else if (ts.isPropertyAccessExpression(expr)) {
      sym = checker.getSymbolAtLocation(expr.name)
    } else if (ts.isElementAccessExpression(expr) && isLiteralKeyExpr(expr.argumentExpression)) {
      const key = (expr.argumentExpression as ts.StringLiteral | ts.NumericLiteral).text
      sym = checker.getTypeAtLocation(expr.expression).getProperty(key)
    }

    if (!sym) return null
    const decl = sym.valueDeclaration ?? sym.declarations?.[0]
    if (decl && ts.isParameter(decl)) return null // cross-boundary
    return signalSymbolId(sym, checker)
  }

  private isUntrackedCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
    const callee = call.expression
    let nameNode: ts.Identifier | null = null
    if (ts.isIdentifier(callee) && callee.text === 'untrack') nameNode = callee
    else if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.name) &&
      callee.name.text === 'untrack'
    ) {
      nameNode = callee.name
    }
    if (!nameNode) return false
    const sym = checker.getSymbolAtLocation(nameNode)
    if (!sym) return false
    return symbolIsFromNvCore(sym, checker, this.nvCorePath)
  }
}
