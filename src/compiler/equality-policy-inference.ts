/**
 * nv Compiler — Equality-Policy Inference Pass
 * Stream:   (2) Compiler specialization layer
 * Contract: nv-reactive-core-contract.md v0.4, §7, §7.1, §10 row 2
 *
 * For each signal() and derived() call, infers the equality policy for the
 * reactive node's value type and emits an EqualityPolicyVerdict.
 *
 * Three emitted policies (§7.1):
 *   OBJECT_IS — confirmed primitive; Object.is is correct and cheap.
 *   FALSE     — confirmed mutable-in-place standard container; must always
 *               propagate to avoid the arr.push(); sig.set(arr) footgun.
 *   DECLINE   — analyzed, no opinion; runtime default (Object.is) applies.
 *
 * NOT EMITTED: STRUCTURAL. Recognized as a future optimization hypothesis
 * requiring benchmark validation against the unspecialized baseline per §10
 * hard rule. Deferred to Claude Code workstream. See comment in categorize().
 *
 * Correctness asymmetry (load-bearing — read before modifying this pass):
 *   Safe direction:   DECLINE when unsure (= today's behavior, Object.is).
 *   Unsafe direction: OBJECT_IS when type is actually mutated in place
 *                     → suppresses updates → wrong result (§7 footgun).
 *   Corollary: when immutability cannot be proven, emit DECLINE, never
 *   OBJECT_IS. This is the opposite conservatism from the sync classifier
 *   (which defaults away from claiming enumerability). Here we default away
 *   from claiming immutability.
 *
 * Library-type detection uses normPath origin-matching (same discipline as
 * symbolIsFromNvCore), not filename regex — see isStandardLibDeclaration().
 */

import * as path from 'node:path'
import * as ts from 'typescript'
import { normPath, symbolIsFromNvCore } from './signal-type-utils'
import type { ClassifierConfig, EqualityPolicy, EqualityPolicyVerdict } from './types'

// ── Public API ─────────────────────────────────────────────────────────────────

export class EqualityPolicyInferencer {
  private readonly nvCorePath: string
  /** Normalized TypeScript lib directory — computed once via normPath. */
  private readonly tsLibDir: string

  constructor(config: ClassifierConfig) {
    this.nvCorePath = config.nvCorePath
    // Establish TypeScript's lib directory using the same path-resolution
    // discipline as symbolIsFromNvCore: normPath(path.resolve(...)).
    // This is a directory prefix check, not a filename regex.
    this.tsLibDir = normPath(
      path.dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 })),
    )
  }

  /**
   * Infer equality policies for all signal() and derived() calls in the program.
   * Skips declaration files.
   */
  inferProgram(program: ts.Program): EqualityPolicyVerdict[] {
    const checker = program.getTypeChecker()
    const results: EqualityPolicyVerdict[] = []
    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const v = this.inferCall(node, checker)
          if (v !== null) results.push(v)
        }
        ts.forEachChild(node, visit)
      }
      ts.forEachChild(sf, visit)
    }
    return results
  }

  /**
   * Infer the equality policy for a single call expression.
   * Returns null for non-signal/derived calls or when the value type
   * cannot be extracted (no verdict → runtime default applies).
   * Public for direct testing.
   */
  inferCall(call: ts.CallExpression, checker: ts.TypeChecker): EqualityPolicyVerdict | null {
    if (!this.isSignalOrDerivedCall(call, checker)) return null

    // If the user explicitly passed { equals: ... } in the options argument,
    // defer entirely — do not override their explicit choice.
    if (this.hasExplicitEquals(call, checker)) {
      const valueType = this.extractValueType(call, checker)
      return {
        policy: 'DECLINE',
        valueTypeString: valueType ? checker.typeToString(valueType) : 'unknown',
        callNode: call,
      }
    }

    const valueType = this.extractValueType(call, checker)
    if (!valueType) return null
    return {
      policy: this.categorize(valueType, checker),
      valueTypeString: checker.typeToString(valueType),
      callNode: call,
    }
  }

  // ── Explicit-equals deference ──────────────────────────────────────────────

  /**
   * Detect whether the call site explicitly sets an `equals` option.
   *
   * Two-layer check:
   *
   *   1. Direct ObjectLiteralExpression (AST-based, precise):
   *      Covers the three literal forms:
   *        PropertyAssignment:      { equals: false }
   *        ShorthandPropertyAssign: { equals }
   *        SpreadAssignment:        { ...opts }  ← conservative: spread may carry equals
   *
   *   2. Non-literal options argument (type-based, conservative):
   *      When the options arg is a variable reference, cast, or any other non-literal
   *      expression, AST inspection is not available. Fall back to the type checker:
   *        - Type has an 'equals' property (including optional) → DECLINE
   *        - Type is 'any' or unresolvable → DECLINE (can't prove equals is absent)
   *        - Type has no 'equals' property → proceed with inference
   *
   *      Asymmetry rule: overriding a user equals is a wrong-result bug; declining
   *      costs only lost specialization. When the compiler can't prove absence of
   *      equals, it must defer.
   *
   *      Critical pin: `const opts = { name: 'x' }; signal(arr, opts)` must still
   *      infer normally — the fallback is specific to the 'equals' property, not
   *      "any non-literal options object defers."
   */
  private hasExplicitEquals(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
    const optionsArg = call.arguments[1]
    if (!optionsArg) return false

    // Layer 1: direct object literal — AST-based, covers all three literal forms
    if (ts.isObjectLiteralExpression(optionsArg)) {
      return optionsArg.properties.some(
        (p) =>
          (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'equals') ||
          (ts.isShorthandPropertyAssignment(p) && p.name.text === 'equals') ||
          ts.isSpreadAssignment(p),
      )
    }

    // Layer 2: non-literal options (variable ref, cast, conditional, etc.)
    // Type-based: look for an 'equals' property on the resolved type.
    const optionsType = checker.getTypeAtLocation(optionsArg)

    // 'any' type → can't prove equals is absent → DECLINE (conservative)
    if (optionsType.flags & ts.TypeFlags.Any) return true

    // Type has 'equals' property (including optional: { equals?: ... }) → DECLINE
    return optionsType.getProperty('equals') !== undefined
  }

  // ── Nominal identification ─────────────────────────────────────────────────

  /**
   * Nominally check that the call is nv's signal() or derived().
   * Callee must resolve (through import aliases) to the nv core's exports.
   * A local function named 'signal' or 'derived' does NOT qualify.
   */
  private isSignalOrDerivedCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
    const callee = call.expression
    let nameNode: ts.Identifier | null = null
    if (ts.isIdentifier(callee)) {
      nameNode = callee
    } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
      nameNode = callee.name
    }
    if (!nameNode) return false
    if (nameNode.text !== 'signal' && nameNode.text !== 'derived') return false
    const sym = checker.getSymbolAtLocation(nameNode)
    if (!sym) return false
    return symbolIsFromNvCore(sym, checker, this.nvCorePath)
  }

  // ── Value-type extraction ──────────────────────────────────────────────────

  /**
   * Extract the value type T from a signal<T>() or derived<T>() call.
   *
   * Both signal() and derived() return generic interfaces (SignalAccessor<T> and
   * DerivedAccessor<T>), so getTypeArguments() yields [T] directly for both.
   * This also handles the explicit-annotation case: `signal<number[]>([])`.
   */
  private extractValueType(call: ts.CallExpression, checker: ts.TypeChecker): ts.Type | null {
    const returnType = checker.getTypeAtLocation(call)
    const typeArgs = checker.getTypeArguments(returnType as ts.TypeReference)
    if (typeArgs.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
      return typeArgs[0]!
    }
    return null
  }

  // ── Policy categorization ──────────────────────────────────────────────────

  /**
   * Map a value type to an equality policy.
   *
   * Decision tree:
   *   1. Union type: all members primitive → OBJECT_IS; else → DECLINE.
   *      (A union like `string | number` is safely compared with Object.is;
   *       a union like `string | string[]` might hold a mutable member.)
   *   2. Primitive type → OBJECT_IS.
   *   3. Known mutable standard-library container → FALSE.
   *   4. Everything else → DECLINE.
   *
   * STRUCTURAL NOTE: The contract §7.1 mentions "types with a cheap structural
   * compare → inject that compare." This is a recognized future category.
   * It is NOT emitted here because:
   *   (a) Whether a structural compare beats Object.is on real workloads is
   *       unmeasured. Per §10 hard rule, every hook must beat the baseline.
   *   (b) The "cheap" predicate cannot be verified statically without profiling.
   *   Deferred to Claude Code workstream for benchmark validation.
   */
  private categorize(type: ts.Type, checker: ts.TypeChecker): EqualityPolicy {
    // Union type: conservative — any non-primitive member → DECLINE
    if (type.isUnion()) {
      return type.types.every((t) => this.isPrimitiveType(t)) ? 'OBJECT_IS' : 'DECLINE'
    }

    if (this.isPrimitiveType(type)) return 'OBJECT_IS'
    if (this.isMutableStandardContainer(type, checker)) return 'FALSE'

    // Intersection types, user-defined objects/classes, generic params,
    // any/unknown/never, function types, readonly containers → DECLINE.
    //
    // Deliberate non-handling (DECLINE by design, not oversight):
    //   Date          — mutable in place (date.setFullYear()), but not in the known-
    //                   container list. User must opt in with { equals: false } explicitly.
    //                   Adding it here without user intent evidence would be presumptuous.
    //   Typed arrays  — Int32Array, Float64Array, etc. are mutable but niche enough that
    //                   a false FALSE (over-propagation) is less harmful than a wrong
    //                   inference. Deferred to a future explicit list if adoption demands it.
    //   Object literals — { x: number } could be frozen, recreated, or mutated; no static
    //                   guarantee either way. DECLINE matches today's unspecialized behavior.
    // In all three cases, DECLINE is safe (= Object.is default = today's behavior).
    return 'DECLINE'
  }

  // ── Primitive detection ────────────────────────────────────────────────────

  /**
   * TypeScript primitive types: number, string, boolean, bigint, symbol (primitive),
   * null, undefined, void, never, and their literal variants (42, "hello", true).
   *
   * These are incapable of being mutated in place — no reference to mutate.
   * Object.is is provably correct and optimal for all of them.
   *
   * Note: `never` is included because it carries no value at runtime; its equality
   * predicate is vacuously correct. `void` likewise (only value is undefined).
   */
  private isPrimitiveType(type: ts.Type): boolean {
    return !!(
      type.flags &
      (ts.TypeFlags.Number |
        ts.TypeFlags.NumberLiteral |
        ts.TypeFlags.String |
        ts.TypeFlags.StringLiteral |
        ts.TypeFlags.Boolean |
        ts.TypeFlags.BooleanLiteral |
        ts.TypeFlags.BigInt |
        ts.TypeFlags.BigIntLiteral |
        ts.TypeFlags.ESSymbol |
        ts.TypeFlags.UniqueESSymbol |
        ts.TypeFlags.Null |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Void |
        ts.TypeFlags.Never)
    )
  }

  // ── Mutable-container detection ────────────────────────────────────────────

  /**
   * Detect known mutable-in-place containers from the TypeScript standard library.
   *
   * Covered: Array<T>, Map<K,V>, Set<T>, WeakMap<K,V>, WeakSet<T>, and
   * non-readonly tuples.
   *
   * NOT covered (→ DECLINE instead):
   *   - ReadonlyArray<T>, readonly T[] — TypeScript readonly is type-level only;
   *     it is erasable at the call site (`arr as T[]`) and cannot be asserted
   *     as a runtime immutability guarantee. Claiming Object.is would be wrong
   *     if the caller casts and mutates in place.
   *   - readonly [T, S] tuples — same reasoning.
   *   - User-defined types named 'Map', 'Set', etc. — isStandardLibDeclaration
   *     gates this check; a user class named 'Map' will DECLINE, not FALSE.
   *     This is the adversarially correct behavior.
   *
   * Library-type detection uses normPath origin-matching (isStandardLibDeclaration),
   * NOT a filename regex. Per arch ruling: use established path-resolution discipline,
   * not substring matching, to stay consistent with the nominal pattern used elsewhere.
   */
  private isMutableStandardContainer(type: ts.Type, checker: ts.TypeChecker): boolean {
    // Tuple types: check before array (isTupleType takes priority)
    if (checker.isTupleType(type)) {
      return !this.isTupleReadonly(type)
    }

    const sym = type.getSymbol()
    if (!sym || !this.isStandardLibDeclaration(sym)) return false

    const name = sym.name

    // Array<T> / T[]: mutable. ReadonlyArray<T>: falls to DECLINE via the sym.name check.
    if (checker.isArrayType(type)) {
      return name === 'Array' // ReadonlyArray → false → DECLINE
    }

    // Mutable standard collection types
    return name === 'Map' || name === 'Set' || name === 'WeakMap' || name === 'WeakSet'
  }

  /**
   * Check if a tuple type is readonly.
   * Accesses TypeScript's TupleType.readonly field via TypeReference.target.
   * This is part of TypeScript 5.x's public type API.
   *
   * Returns false (= treat as mutable) if the readonly field can't be determined.
   * This is the conservative direction: mutable-by-default means FALSE, never
   * asserts immutability we can't prove.
   */
  private isTupleReadonly(type: ts.Type): boolean {
    const target = (type as ts.TypeReference).target as ts.TupleType | undefined
    return target?.readonly === true
  }

  /**
   * Verify that a symbol's declaration originates in TypeScript's standard library.
   *
   * Uses normPath(path.resolve(fileName)) and a directory prefix check against
   * the TypeScript package lib directory — same path-resolution discipline as
   * symbolIsFromNvCore. Not a filename regex or substring match.
   *
   * This is the gate that prevents a user-defined class named 'Map' from being
   * treated as the standard Map — the adversarially important case.
   */
  private isStandardLibDeclaration(sym: ts.Symbol): boolean {
    const decl = sym.declarations?.[0]
    if (!decl) return false
    const fileName = normPath(decl.getSourceFile().fileName)
    return fileName.startsWith(`${this.tsLibDir}/`)
  }
}
