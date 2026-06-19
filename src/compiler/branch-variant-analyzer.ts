/**
 * nv Compiler — Branch-Variant Dependency Set Analysis Pass
 * Stream:   (2) Compiler specialization layer
 * Contract: nv-reactive-core-contract.md v0.4, §10 row 4
 *
 * For each derived() and effect() call, attempts to prove the complete union
 * of all possible reactive reads across all branches of the compute body, and
 * emits a BranchVariantVerdict.
 *
 * Soundness design (arch-reviewed 2026-06-17, approved):
 *   - Tracking ALWAYS runs at runtime — the declared union is an expected-reads
 *     oracle, never a replacement for tracking.
 *   - `reconcileEdges` in the finally block is always the ground truth.
 *   - Edges reflect actual reads, never the declared union.
 *   - A wrong declared set (narrower than reality) causes a divergence flag and
 *     falls to normal §5.2 reconciliation — wrong result is structurally impossible.
 *   - All-or-nothing: any unanalyzable sub-expression → DECLINE the entire body.
 *
 * Locked scope (E1/E2/E3 from soundness review):
 *   - Union-only (no per-branch variants — deferred, different soundness argument)
 *   - No skip-tracking path (different hook, separate future gated design)
 *   - Logical &&/||/?? treated as regular BinaryExpression (no short-circuit awareness)
 *     because under union-only they fold into the same set anyway
 *
 * Body shapes attempted:
 *   - CallExpression with nv-signal callee: direct reactive read
 *   - ConditionalExpression (ternary, nested): union all branches
 *   - BinaryExpression, UnaryExpression: recurse all operands
 *   - PropertyAccessExpression, ElementAccessExpression: recurse base (call site handled separately)
 *   - Block with VariableStatement + single ReturnStatement
 *   - Template expressions with interpolated signal reads
 *
 * Declined unconditionally:
 *   - Non-nv function calls (opaque: may read signals via closure)
 *   - NewExpression (constructor may read signals)
 *   - Optional chaining (complex short-circuit semantics)
 *   - Loops, switch, try/catch, async/await
 *   - Multiple return statements in a block
 *   - Cross-boundary signals (function parameters: concrete identity unknown)
 *
 * The DECLINE fallback is always correct. Over-conservatism costs performance,
 * never correctness.
 */

import * as ts from 'typescript'
import {
  isLiteralKeyExpr,
  isNvSignalType,
  normPath,
  signalSymbolId,
  symbolIsFromNvCore,
} from './signal-type-utils.js'
import type { BranchVariantVerdict, ClassifierConfig, SignalId } from './types.js'

// ── Internal body analysis result ─────────────────────────────────────────────

type BodyResult =
  | { kind: 'SIGNALS'; signals: ReadonlySet<SignalId> }
  | { kind: 'DECLINE'; reason: string }

const EMPTY: BodyResult = { kind: 'SIGNALS', signals: new Set() }

function decline(reason: string): BodyResult {
  return { kind: 'DECLINE', reason }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export class BranchVariantAnalyzer {
  private readonly nvCorePath: string

  constructor(config: ClassifierConfig) {
    this.nvCorePath = config.nvCorePath
  }

  /** Analyze all derived() and effect() calls in the program. */
  analyzeProgram(program: ts.Program): BranchVariantVerdict[] {
    const checker = program.getTypeChecker()
    const results: BranchVariantVerdict[] = []
    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const v = this.analyzeCall(node, checker)
          if (v !== null) results.push(v)
        }
        ts.forEachChild(node, visit)
      }
      ts.forEachChild(sf, visit)
    }
    return results
  }

  /** Analyze a single call expression. Returns null for non-derived/effect calls. */
  analyzeCall(call: ts.CallExpression, checker: ts.TypeChecker): BranchVariantVerdict | null {
    if (!this.isDerivedOrEffectCall(call, checker)) return null
    const body = this.extractComputeBody(call, checker)
    if (body === null) {
      return {
        kind: 'DECLINE',
        reason: 'compute argument is not an analyzable function',
        callNode: call,
      }
    }
    const result = this.analyzeBody(body, checker)
    if (result.kind === 'DECLINE') {
      return { kind: 'DECLINE', reason: result.reason, callNode: call }
    }
    return { kind: 'DECLARED', declaredUnion: result.signals, callNode: call }
  }

  /**
   * Analyze a compute body node (expression or block).
   * Public for direct testing of body shapes.
   */
  analyzeBody(body: ts.Node, checker: ts.TypeChecker): BodyResult {
    if (ts.isBlock(body)) return this.analyzeBlock(body, checker)
    return this.analyzeExpr(body as ts.Expression, checker)
  }

  // ── Nominal identification ─────────────────────────────────────────────────

  private isDerivedOrEffectCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
    const callee = call.expression
    let nameNode: ts.Identifier | null = null
    if (ts.isIdentifier(callee)) nameNode = callee
    else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
      nameNode = callee.name
    }
    if (!nameNode) return false
    if (nameNode.text !== 'derived' && nameNode.text !== 'effect') return false
    const sym = checker.getSymbolAtLocation(nameNode)
    if (!sym) return false
    return symbolIsFromNvCore(sym, checker, this.nvCorePath)
  }

  private extractComputeBody(
    call: ts.CallExpression,
    checker: ts.TypeChecker,
  ): ts.ConciseBody | ts.Block | null {
    const arg = call.arguments[0]
    if (!arg) return null

    let resolved: ts.Expression = arg
    // Follow identifier to variable initializer (one level)
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

  // ── Block analysis ────────────────────────────────────────────────────────

  /**
   * Analyze a block body.
   * Accepts only VariableStatement and a single ReturnStatement.
   * Any other statement kind → DECLINE (all-or-nothing rule).
   */
  private analyzeBlock(block: ts.Block, checker: ts.TypeChecker): BodyResult {
    let result: BodyResult = EMPTY
    let returnCount = 0

    for (const stmt of block.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (!decl.initializer) continue
          result = this.merge(result, this.analyzeExpr(decl.initializer, checker))
          if (result.kind === 'DECLINE') return result
        }
      } else if (ts.isReturnStatement(stmt)) {
        returnCount++
        if (returnCount > 1) return decline('multiple return statements in block body')
        if (stmt.expression) {
          result = this.merge(result, this.analyzeExpr(stmt.expression, checker))
          if (result.kind === 'DECLINE') return result
        }
      } else {
        return decline(`non-trivial statement in block body: ${ts.SyntaxKind[stmt.kind]}`)
      }
    }
    return result
  }

  // ── Expression analysis ────────────────────────────────────────────────────

  /**
   * Recursively enumerate reactive reads in an expression.
   *
   * Returns SIGNALS(set) when the entire expression is provably analyzed.
   * Returns DECLINE when any sub-expression is unanalyzable — the all-or-nothing rule.
   *
   * Reactive read = a CallExpression whose callee type is an nv SignalAccessor.
   * Identifiers and property accesses that aren't called are not reactive reads.
   */
  private analyzeExpr(rawExpr: ts.Expression, checker: ts.TypeChecker): BodyResult {
    // Unwrap transparent nodes (parens, type assertions, as-expressions)
    let expr: ts.Expression = rawExpr
    while (true) {
      if (ts.isParenthesizedExpression(expr)) {
        expr = expr.expression
        continue
      }
      if (ts.isAsExpression(expr)) {
        expr = expr.expression
        continue
      }
      if (expr.kind === ts.SyntaxKind.TypeAssertionExpression) {
        expr = (expr as ts.TypeAssertion).expression
        continue
      }
      break
    }

    // Optional chaining: decline (short-circuit semantics add complexity)
    if (
      (ts.isCallExpression(expr) ||
        ts.isPropertyAccessExpression(expr) ||
        ts.isElementAccessExpression(expr)) &&
      (expr as ts.CallExpression | ts.PropertyAccessExpression | ts.ElementAccessExpression)
        .questionDotToken != null
    ) {
      return decline('optional chaining: deferred')
    }

    // ── Literals: never reactive reads ────────────────────────────────────────
    if (
      ts.isStringLiteral(expr) ||
      ts.isNumericLiteral(expr) ||
      ts.isNoSubstitutionTemplateLiteral(expr) ||
      expr.kind === ts.SyntaxKind.TrueKeyword ||
      expr.kind === ts.SyntaxKind.FalseKeyword ||
      expr.kind === ts.SyntaxKind.NullKeyword ||
      expr.kind === ts.SyntaxKind.UndefinedKeyword ||
      ts.isBigIntLiteral(expr)
    ) {
      return EMPTY
    }

    // ── Identifier: a reference, not a call → not a reactive read ─────────────
    // Reactive reads come from CALLING the signal: sig() not just sig.
    if (ts.isIdentifier(expr)) return EMPTY

    // ── CallExpression: the core case for reactive reads ──────────────────────
    if (ts.isCallExpression(expr)) return this.analyzeCallExpr(expr, checker)

    // ── ConditionalExpression: union all three parts ───────────────────────────
    if (ts.isConditionalExpression(expr)) {
      return this.merge(
        this.analyzeExpr(expr.condition, checker),
        this.merge(
          this.analyzeExpr(expr.whenTrue, checker),
          this.analyzeExpr(expr.whenFalse, checker),
        ),
      )
    }

    // ── BinaryExpression: recurse both operands ────────────────────────────────
    // Logical &&/||/?? are handled here too (union-only — arch ruling E1).
    // Under union-only, short-circuit operators fold to the same union as
    // non-short-circuit binary operators, so no special handling is needed.
    if (ts.isBinaryExpression(expr)) {
      return this.merge(this.analyzeExpr(expr.left, checker), this.analyzeExpr(expr.right, checker))
    }

    // ── Unary expressions: recurse operand ───────────────────────────────────
    if (ts.isPrefixUnaryExpression(expr)) {
      return this.analyzeExpr(expr.operand as ts.Expression, checker)
    }
    if (ts.isPostfixUnaryExpression(expr)) {
      return this.analyzeExpr(expr.operand as ts.Expression, checker)
    }

    // ── PropertyAccessExpression: recurse base (the access itself is handled ──
    // by the CallExpression case when called: `obj.submit()`)
    if (ts.isPropertyAccessExpression(expr)) {
      return this.analyzeExpr(expr.expression, checker)
    }

    // ── ElementAccessExpression: recurse base and key ─────────────────────────
    if (ts.isElementAccessExpression(expr)) {
      return this.merge(
        this.analyzeExpr(expr.expression, checker),
        this.analyzeExpr(expr.argumentExpression, checker),
      )
    }

    // ── Template expression with interpolations ───────────────────────────────
    if (ts.isTemplateExpression(expr)) {
      let result: BodyResult = EMPTY
      for (const span of expr.templateSpans) {
        result = this.merge(result, this.analyzeExpr(span.expression, checker))
        if (result.kind === 'DECLINE') return result
      }
      return result
    }

    // ── Void expression ───────────────────────────────────────────────────────
    if (ts.isVoidExpression(expr)) return EMPTY

    // Everything else (new, await, yield, spread, tagged template, etc.) → DECLINE
    return decline(`unhandled expression kind: ${ts.SyntaxKind[expr.kind]}`)
  }

  /**
   * Analyze a CallExpression for reactive reads.
   *
   *   - nv signal callee (sig(), obj.prop(), obj['key']()) → SIGNALS({calleeId})
   *   - nv untrack() callee → EMPTY (reads inside are not reactive — skip subtree)
   *   - any other callee → DECLINE (may read signals via closure; opaque boundary)
   */
  private analyzeCallExpr(call: ts.CallExpression, checker: ts.TypeChecker): BodyResult {
    const calleeType = checker.getTypeAtLocation(call.expression)

    // nv signal read: sig()
    if (isNvSignalType(calleeType, checker, this.nvCorePath)) {
      const id = this.resolveReadId(call.expression, checker)
      if (id === null)
        return decline('signal read symbol not resolvable (cross-boundary or dynamic)')
      return { kind: 'SIGNALS', signals: new Set([id]) }
    }

    // untrack(): skip the argument subtree entirely
    // Reads inside untrack are not reactive — same treatment as in the cycle checker
    if (this.isUntrackedCall(call, checker)) return EMPTY

    // Any other non-nv call: decline
    // The callee might read signals via closure; we cannot prove it doesn't.
    return decline('non-nv call: cannot prove callee does not read signals')
  }

  // ── Signal identity resolution ────────────────────────────────────────────

  /**
   * Resolve the stable SignalId for the callee of a signal read.
   * Returns null if the symbol is unresolvable or is a function parameter
   * (cross-boundary: concrete identity unknown).
   *
   * MUST use signalSymbolId — same derivation as steps 1 and 2 — so that a signal
   * appearing in both the declared union and a sync target/source read produces the
   * same identity.
   */
  private resolveReadId(callee: ts.Expression, checker: ts.TypeChecker): SignalId | null {
    let sym: ts.Symbol | undefined

    if (ts.isIdentifier(callee)) {
      sym = checker.getSymbolAtLocation(callee)
    } else if (ts.isPropertyAccessExpression(callee)) {
      sym = checker.getSymbolAtLocation(callee.name)
    } else if (
      ts.isElementAccessExpression(callee) &&
      isLiteralKeyExpr(callee.argumentExpression)
    ) {
      const key = (callee.argumentExpression as ts.StringLiteral | ts.NumericLiteral).text
      sym = checker.getTypeAtLocation(callee.expression).getProperty(key)
    }

    if (!sym) return null

    // Cross-boundary: parameter signal — concrete identity is unknown from this call site
    const decl = sym.valueDeclaration ?? sym.declarations?.[0]
    if (decl && ts.isParameter(decl)) return null

    return signalSymbolId(sym, checker)
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

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

  /**
   * Merge two BodyResults.
   * DECLINE wins unconditionally (all-or-nothing rule).
   * SIGNALS + SIGNALS = SIGNALS(union).
   */
  private merge(a: BodyResult, b: BodyResult): BodyResult {
    if (a.kind === 'DECLINE') return a
    if (b.kind === 'DECLINE') return b
    return { kind: 'SIGNALS', signals: new Set([...a.signals, ...b.signals]) }
  }
}
