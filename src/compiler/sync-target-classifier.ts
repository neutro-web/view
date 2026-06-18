/**
 * nv Compiler — sync-target Classification Pass
 * Stream:   (2) Compiler specialization layer
 * Contract: nv-reactive-core-contract.md v0.4, §8.5.3, §10 row 1
 *
 * Classifies the `target` argument of every sync(source, target, compute) call.
 *
 * Three verdicts (§8.5.3):
 *   ACCEPT      — target is provably enumerable; emits target set for cycle check
 *   REJECT      — target is provably non-enumerable; directive: use effect
 *   UNDECIDABLE — can't decide; conservative default (option a): force effect
 *
 * Hard invariants:
 *   - The compiler may only skip provable work; misclassification → slower, never wrong.
 *   - ACCEPT with an incomplete target set degrades to the runtime cascade cap;
 *     the cycle checker must never assert acyclicity it hasn't proven.
 *   - isNvSignal check is NOMINAL (not structural): confirmed by origin file.
 *     Structural shape alone would corrupt the write-graph with non-nv edges.
 *     (Arch ruling 2026-06-15.)
 */

import * as ts from 'typescript'
import {
  getThunkReturnSignalType,
  isAnyType,
  isLiteralKeyExpr,
  isNvSignalType,
  normPath,
  signalSymbolId,
  symbolIsFromNvCore,
} from './signal-type-utils'
import type { ClassifierConfig, EnumResult, SignalId, TargetVerdict } from './types'

const REJECT_DIAGNOSTIC =
  'sync target is not statically resolvable. ' +
  'Use effect (accepting the cascade-cap tradeoff, §8.5.4) or refactor ' +
  'so the target is an enumerable signal reference (§8.5.3).'

// ── Public API ─────────────────────────────────────────────────────────────────

export class SyncTargetClassifier {
  private readonly nvCorePath: string

  constructor(config: ClassifierConfig) {
    this.nvCorePath = config.nvCorePath
  }

  /**
   * Find and classify every sync() call in the program.
   * Skips declaration files (.d.ts).
   */
  classifyProgram(program: ts.Program): TargetVerdict[] {
    const checker = program.getTypeChecker()
    const results: TargetVerdict[] = []
    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue
      this.visitNode(sf, checker, results)
    }
    return results
  }

  /**
   * Classify a single CallExpression node if it is an nv sync() call.
   * Returns null for non-sync calls.
   * Suitable for targeted analysis (e.g. IDE integration, per-node testing).
   */
  classifyCall(call: ts.CallExpression, checker: ts.TypeChecker): TargetVerdict | null {
    if (!this.isSyncCall(call, checker)) return null
    if (call.arguments.length < 2) return null
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
    return this.classifyTarget(call.arguments[1]!, call, checker)
  }

  // ── AST walk ─────────────────────────────────────────────────────────────────

  private visitNode(node: ts.Node, checker: ts.TypeChecker, results: TargetVerdict[]): void {
    if (ts.isCallExpression(node)) {
      const v = this.classifyCall(node, checker)
      if (v !== null) results.push(v)
    }
    ts.forEachChild(node, (child) => this.visitNode(child, checker, results))
  }

  // ── Nominal sync() identification ─────────────────────────────────────────────

  /**
   * Nominally identify the call as nv's sync().
   *
   * Requires:
   *   1. The callee is an identifier (or qualified name) whose text is 'sync'.
   *   2. That identifier resolves (through import aliases) to a declaration in
   *      the nv core source file.
   *
   * A local function named 'sync' in user code is NOT classified.
   */
  private isSyncCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
    const callee = call.expression

    // Extract the name node ('sync' identifier)
    let nameNode: ts.Identifier | null = null
    if (ts.isIdentifier(callee) && callee.text === 'sync') {
      nameNode = callee
    } else if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.name) &&
      callee.name.text === 'sync'
    ) {
      nameNode = callee.name
    }
    if (nameNode === null) return false

    const sym = checker.getSymbolAtLocation(nameNode)
    if (!sym) return false
    return this.symbolIsFromNvCore(sym, checker)
  }

  /**
   * Walk alias chain to canonical declaration; confirm it's in the nv core file.
   * Delegates to shared utility in signal-type-utils (also used by WriteGraphCycleChecker).
   */
  private symbolIsFromNvCore(sym: ts.Symbol, checker: ts.TypeChecker): boolean {
    return symbolIsFromNvCore(sym, checker, this.nvCorePath)
  }

  // ── Top-level target dispatch ─────────────────────────────────────────────────

  /**
   * Dispatch on target type (§8.5.3):
   *
   *   any              → UNDECIDABLE (conservative default)
   *   nv SignalAccessor → Path A: direct signal (one known target)
   *   () → nv Signal   → Path B: conditional thunk (enumerate body)
   *   otherwise        → UNDECIDABLE (unrecognized form)
   */
  private classifyTarget(
    arg: ts.Expression,
    call: ts.CallExpression,
    checker: ts.TypeChecker,
  ): TargetVerdict {
    const type = checker.getTypeAtLocation(arg)

    // any → undecidable (§8.5.3 option a: force effect)
    if (isAnyType(type)) {
      return {
        kind: 'UNDECIDABLE',
        reason: "target type is 'any' — enumerability cannot be determined statically",
        callNode: call,
      }
    }

    // Path A: target is a direct nv signal reference (has .set from nv core)
    if (isNvSignalType(type, checker, this.nvCorePath)) {
      return this.classifyDirectSignal(arg, call, checker)
    }

    // Path B: target is a conditional thunk (() => SignalAccessor<T>)
    if (getThunkReturnSignalType(type, checker, this.nvCorePath) !== null) {
      return this.classifyConditionalThunk(arg, call, checker)
    }

    return {
      kind: 'UNDECIDABLE',
      reason: `target type is not a recognized nv signal form: ${checker.typeToString(type)}`,
      callNode: call,
    }
  }

  // ── Path A: direct signal ─────────────────────────────────────────────────────

  /**
   * Classify a target whose type is already confirmed as an nv SignalAccessor.
   * Needs to resolve the SPECIFIC signal identity for the write-graph.
   *
   * Returns UNDECIDABLE when the signal identity can't be determined (function
   * parameter — concrete signal unknown from call site; or unresolvable symbol).
   */
  private classifyDirectSignal(
    expr: ts.Expression,
    call: ts.CallExpression,
    checker: ts.TypeChecker,
  ): TargetVerdict {
    const id = this.resolveSignalId(expr, checker)
    if (id === null) {
      return {
        kind: 'UNDECIDABLE',
        reason:
          'direct signal target symbol not resolvable — may be a function parameter ' +
          '(concrete identity unknown from call site) or a dynamically produced value',
        callNode: call,
      }
    }
    return { kind: 'ACCEPT', targets: new Set([id]), callNode: call }
  }

  // ── Path B: conditional thunk ─────────────────────────────────────────────────

  /**
   * Classify a target whose type is `() => SignalAccessor<T>`.
   * Extracts the function body and recursively enumerates the signal set.
   */
  private classifyConditionalThunk(
    expr: ts.Expression,
    call: ts.CallExpression,
    checker: ts.TypeChecker,
  ): TargetVerdict {
    const body = this.resolveFunctionBody(expr, checker)
    if (body === null) {
      return {
        kind: 'UNDECIDABLE',
        reason:
          'conditional thunk body could not be extracted (not an arrow function or function expression)',
        callNode: call,
      }
    }

    const result = this.enumerateSignals(body, checker)
    switch (result.kind) {
      case 'SIGNALS':
        return { kind: 'ACCEPT', targets: result.signals, callNode: call }
      case 'NON_ENUMERABLE':
        return {
          kind: 'REJECT',
          reason: result.reason,
          diagnostic: REJECT_DIAGNOSTIC,
          callNode: call,
        }
      case 'UNDECIDABLE':
        return { kind: 'UNDECIDABLE', reason: result.reason, callNode: call }
    }
  }

  /**
   * Extract the return expression from an arrow function or function expression.
   * Follows a single level of identifier → initializer to handle:
   *   `const myTarget = () => cond ? a : b; sync(s, myTarget, c)`
   *
   * Returns null if the body can't be extracted to a single expression.
   */
  private resolveFunctionBody(expr: ts.Expression, checker: ts.TypeChecker): ts.Expression | null {
    let resolved: ts.Expression = expr

    // Follow identifier to its variable declaration initializer
    if (ts.isIdentifier(resolved)) {
      const sym = checker.getSymbolAtLocation(resolved)
      const decl = sym?.valueDeclaration ?? sym?.declarations?.[0]
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
        resolved = decl.initializer
      }
    }

    // Arrow function: () => expr  (concise body — the direct return expression)
    //             or () => { return expr }  (block body)
    if (ts.isArrowFunction(resolved)) {
      const body = resolved.body
      if (!ts.isBlock(body)) return body as ts.Expression
      for (const stmt of body.statements) {
        if (ts.isReturnStatement(stmt) && stmt.expression) return stmt.expression
      }
      return null
    }

    // function() { return expr }
    if (ts.isFunctionExpression(resolved)) {
      for (const stmt of resolved.body.statements) {
        if (ts.isReturnStatement(stmt) && stmt.expression) return stmt.expression
      }
      return null
    }

    return null
  }

  // ── Recursive signal enumerator ───────────────────────────────────────────────

  /**
   * Recursively enumerate the set of nv signals that an expression may resolve to.
   *
   * Expression patterns handled:
   *
   *   Identifier             — must be an nv signal with resolvable symbol → SIGNALS
   *   ConditionalExpression  — enumerate both branches; merge (union or propagate error)
   *   PropertyAccessExpression — if property type is nv signal → SIGNALS (property symbol)
   *   ElementAccessExpression:
   *     literal key          — resolve property symbol on object type → SIGNALS if found
   *     non-literal key      — provably non-enumerable → NON_ENUMERABLE
   *   CallExpression         — identity depends on runtime call → NON_ENUMERABLE
   *   ParenthesizedExpr /
   *   AsExpression /
   *   TypeAssertion          — unwrap, then recurse
   *   other                  → UNDECIDABLE
   */
  private enumerateSignals(rawExpr: ts.Expression, checker: ts.TypeChecker): EnumResult {
    // Unwrap transparent wrappers before dispatch
    const expr = this.unwrapTransparent(rawExpr)

    const type = checker.getTypeAtLocation(expr)
    if (isAnyType(type)) return { kind: 'UNDECIDABLE', reason: "expression is 'any'" }

    // ── Identifier ─────────────────────────────────────────────────────────────
    if (ts.isIdentifier(expr)) {
      if (!isNvSignalType(type, checker, this.nvCorePath)) {
        return {
          kind: 'UNDECIDABLE',
          reason: `'${expr.text}' is not an nv signal type (nominal check failed)`,
        }
      }
      const id = this.resolveSignalId(expr, checker)
      return id !== null
        ? { kind: 'SIGNALS', signals: new Set([id]) }
        : {
            kind: 'UNDECIDABLE',
            reason: `'${expr.text}' symbol not resolvable (cross-boundary or dynamic)`,
          }
    }

    // ── ConditionalExpression (cond ? whenTrue : whenFalse) ───────────────────
    if (ts.isConditionalExpression(expr)) {
      return this.mergeEnum(
        this.enumerateSignals(expr.whenTrue, checker),
        this.enumerateSignals(expr.whenFalse, checker),
      )
    }

    // ── PropertyAccessExpression (obj.prop) ───────────────────────────────────
    if (ts.isPropertyAccessExpression(expr)) {
      return this.enumeratePropertyAccess(expr, type, checker)
    }

    // ── ElementAccessExpression (obj[key]) ────────────────────────────────────
    if (ts.isElementAccessExpression(expr)) {
      return this.enumerateElementAccess(expr, type, checker)
    }

    // ── CallExpression → provably non-enumerable ──────────────────────────────
    // A call expression as the target means the signal identity depends on a
    // runtime function call (e.g., map.get(key()), factory()) — cannot enumerate.
    if (ts.isCallExpression(expr)) {
      return {
        kind: 'NON_ENUMERABLE',
        reason: 'call expression — signal identity depends on a runtime call',
      }
    }

    return {
      kind: 'UNDECIDABLE',
      reason: `unrecognized expression kind: ${ts.SyntaxKind[expr.kind]}`,
    }
  }

  /**
   * PropertyAccessExpression: obj.prop
   *
   * If the property type is an nv signal, use the property's symbol as the
   * write-graph identity. Two usages of `obj.submit` will produce the same ID.
   */
  private enumeratePropertyAccess(
    expr: ts.PropertyAccessExpression,
    type: ts.Type,
    checker: ts.TypeChecker,
  ): EnumResult {
    if (!isNvSignalType(type, checker, this.nvCorePath)) {
      return {
        kind: 'UNDECIDABLE',
        reason: `'.${expr.name.text}' is not an nv signal type (nominal check failed)`,
      }
    }
    const sym = checker.getSymbolAtLocation(expr.name)
    if (!sym) {
      return {
        kind: 'UNDECIDABLE',
        reason: `'.${expr.name.text}' symbol not resolvable`,
      }
    }
    return { kind: 'SIGNALS', signals: new Set([signalSymbolId(sym, checker)]) }
  }

  /**
   * ElementAccessExpression: obj[key]
   *
   * Arch ruling 2026-06-15: do NOT blanket-UNDECIDABLE literal-key cases.
   *   - non-literal key → NON_ENUMERABLE (provably runtime-computed)
   *   - literal key + resolvable property symbol → SIGNALS
   *   - literal key + unresolvable → UNDECIDABLE (honest fallback)
   */
  private enumerateElementAccess(
    expr: ts.ElementAccessExpression,
    type: ts.Type,
    checker: ts.TypeChecker,
  ): EnumResult {
    const key = expr.argumentExpression

    // Non-literal key: any non-string/numeric-literal means runtime-computed
    if (!isLiteralKeyExpr(key)) {
      return {
        kind: 'NON_ENUMERABLE',
        reason:
          'non-literal element access key — signal identity is runtime-computed ' +
          '(e.g., arr[i()], map.get(key()), arr[variable])',
      }
    }

    // Literal key: attempt to resolve via the object type's property symbol
    if (!isNvSignalType(type, checker, this.nvCorePath)) {
      return {
        kind: 'UNDECIDABLE',
        reason: 'literal-indexed element is not an nv signal type',
      }
    }

    const keyText = (key as ts.StringLiteral | ts.NumericLiteral).text
    const objType = checker.getTypeAtLocation(expr.expression)
    const propSym = objType.getProperty(keyText)

    if (propSym) {
      // Two accesses to obj['submit'] resolve to the same property symbol → same ID
      return { kind: 'SIGNALS', signals: new Set([signalSymbolId(propSym, checker)]) }
    }

    // Type is nv signal but property symbol not resolvable (e.g., numeric index
    // into a generic Array<SignalAccessor<T>> — we know the type but not which)
    return {
      kind: 'UNDECIDABLE',
      reason: `literal key ['${keyText}'] resolves to nv signal type but property symbol not resolvable`,
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Merge two EnumResults from conditional branches.
   *
   * Priority: NON_ENUMERABLE > UNDECIDABLE > (both SIGNALS → union)
   * Rationale for UNDECIDABLE + SIGNALS → UNDECIDABLE:
   *   Accepting a PARTIAL target set (some branches known, some not) would give
   *   the cycle checker an incomplete graph. That's conservative-on-incompleteness
   *   and safe for soundness, but it means we've ACCEPTED a sync whose full
   *   target set we don't know. We could choose to ACCEPT with the partial set
   *   (relying on the cycle checker's conservative-on-incompleteness guarantee),
   *   but returning UNDECIDABLE is the stricter and cleaner choice: we haven't
   *   proven enumerability of ALL branches, so we don't claim we have.
   */
  private mergeEnum(a: EnumResult, b: EnumResult): EnumResult {
    if (a.kind === 'NON_ENUMERABLE') return a
    if (b.kind === 'NON_ENUMERABLE') return b
    if (a.kind === 'SIGNALS' && b.kind === 'SIGNALS') {
      return { kind: 'SIGNALS', signals: new Set([...a.signals, ...b.signals]) }
    }
    // One or both UNDECIDABLE
    const reason =
      a.kind === 'UNDECIDABLE' ? a.reason : (b as { kind: 'UNDECIDABLE'; reason: string }).reason
    return { kind: 'UNDECIDABLE', reason }
  }

  /**
   * Resolve the stable SignalId for a direct signal expression.
   *
   * Returns null when:
   *   - No symbol is resolvable at the location
   *   - The symbol's declaration is a function parameter (cross-boundary: the
   *     concrete signal identity is unknown from this call site)
   */
  private resolveSignalId(expr: ts.Expression, checker: ts.TypeChecker): SignalId | null {
    const sym = checker.getSymbolAtLocation(expr)
    if (!sym) return null

    // Cross-boundary: function parameter → concrete signal unknown
    const decl = sym.valueDeclaration ?? sym.declarations?.[0]
    if (decl && ts.isParameter(decl)) return null

    return signalSymbolId(sym, checker)
  }

  /**
   * Unwrap transparent AST wrappers: parentheses, 'as' expressions,
   * angle-bracket type assertions. These don't change the expression's
   * runtime value, only its presentation or TypeScript type.
   */
  private unwrapTransparent(rawExpr: ts.Expression): ts.Expression {
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
      // TypeAssertionExpression: <Type>expr (SyntaxKind-based check for version compat)
      if (expr.kind === ts.SyntaxKind.TypeAssertionExpression) {
        expr = (expr as ts.TypeAssertion).expression
        continue
      }
      break
    }
    return expr
  }
}
