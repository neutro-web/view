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
import * as ts from 'typescript';
import type { ClassifierConfig, EqualityPolicyVerdict } from './types';
export declare class EqualityPolicyInferencer {
    private readonly nvCorePath;
    /** Normalized TypeScript lib directory — computed once via normPath. */
    private readonly tsLibDir;
    constructor(config: ClassifierConfig);
    /**
     * Infer equality policies for all signal() and derived() calls in the program.
     * Skips declaration files.
     */
    inferProgram(program: ts.Program): EqualityPolicyVerdict[];
    /**
     * Infer the equality policy for a single call expression.
     * Returns null for non-signal/derived calls or when the value type
     * cannot be extracted (no verdict → runtime default applies).
     * Public for direct testing.
     */
    inferCall(call: ts.CallExpression, checker: ts.TypeChecker): EqualityPolicyVerdict | null;
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
    private hasExplicitEquals;
    /**
     * Nominally check that the call is nv's signal() or derived().
     * Callee must resolve (through import aliases) to the nv core's exports.
     * A local function named 'signal' or 'derived' does NOT qualify.
     */
    private isSignalOrDerivedCall;
    /**
     * Extract the value type T from a signal<T>() or derived<T>() call.
     *
     * Both signal() and derived() return generic interfaces (SignalAccessor<T> and
     * DerivedAccessor<T>), so getTypeArguments() yields [T] directly for both.
     * This also handles the explicit-annotation case: `signal<number[]>([])`.
     */
    private extractValueType;
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
    private categorize;
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
    private isPrimitiveType;
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
    private isMutableStandardContainer;
    /**
     * Check if a tuple type is readonly.
     * Accesses TypeScript's TupleType.readonly field via TypeReference.target.
     * This is part of TypeScript 5.x's public type API.
     *
     * Returns false (= treat as mutable) if the readonly field can't be determined.
     * This is the conservative direction: mutable-by-default means FALSE, never
     * asserts immutability we can't prove.
     */
    private isTupleReadonly;
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
    private isStandardLibDeclaration;
}
//# sourceMappingURL=equality-policy-inference.d.ts.map