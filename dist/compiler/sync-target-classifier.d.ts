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
import * as ts from 'typescript';
import type { ClassifierConfig, TargetVerdict } from './types';
export declare class SyncTargetClassifier {
    private readonly nvCorePath;
    constructor(config: ClassifierConfig);
    /**
     * Find and classify every sync() call in the program.
     * Skips declaration files (.d.ts).
     */
    classifyProgram(program: ts.Program): TargetVerdict[];
    /**
     * Classify a single CallExpression node if it is an nv sync() call.
     * Returns null for non-sync calls.
     * Suitable for targeted analysis (e.g. IDE integration, per-node testing).
     */
    classifyCall(call: ts.CallExpression, checker: ts.TypeChecker): TargetVerdict | null;
    private visitNode;
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
    private isSyncCall;
    /**
     * Walk alias chain to canonical declaration; confirm it's in the nv core file.
     * Delegates to shared utility in signal-type-utils (also used by WriteGraphCycleChecker).
     */
    private symbolIsFromNvCore;
    /**
     * Dispatch on target type (§8.5.3):
     *
     *   any              → UNDECIDABLE (conservative default)
     *   nv SignalAccessor → Path A: direct signal (one known target)
     *   () → nv Signal   → Path B: conditional thunk (enumerate body)
     *   otherwise        → UNDECIDABLE (unrecognized form)
     */
    private classifyTarget;
    /**
     * Classify a target whose type is already confirmed as an nv SignalAccessor.
     * Needs to resolve the SPECIFIC signal identity for the write-graph.
     *
     * Returns UNDECIDABLE when the signal identity can't be determined (function
     * parameter — concrete signal unknown from call site; or unresolvable symbol).
     */
    private classifyDirectSignal;
    /**
     * Classify a target whose type is `() => SignalAccessor<T>`.
     * Extracts the function body and recursively enumerates the signal set.
     */
    private classifyConditionalThunk;
    /**
     * Extract the return expression from an arrow function or function expression.
     * Follows a single level of identifier → initializer to handle:
     *   `const myTarget = () => cond ? a : b; sync(s, myTarget, c)`
     *
     * Returns null if the body can't be extracted to a single expression.
     */
    private resolveFunctionBody;
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
    private enumerateSignals;
    /**
     * PropertyAccessExpression: obj.prop
     *
     * If the property type is an nv signal, use the property's symbol as the
     * write-graph identity. Two usages of `obj.submit` will produce the same ID.
     */
    private enumeratePropertyAccess;
    /**
     * ElementAccessExpression: obj[key]
     *
     * Arch ruling 2026-06-15: do NOT blanket-UNDECIDABLE literal-key cases.
     *   - non-literal key → NON_ENUMERABLE (provably runtime-computed)
     *   - literal key + resolvable property symbol → SIGNALS
     *   - literal key + unresolvable → UNDECIDABLE (honest fallback)
     */
    private enumerateElementAccess;
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
    private mergeEnum;
    /**
     * Resolve the stable SignalId for a direct signal expression.
     *
     * Returns null when:
     *   - No symbol is resolvable at the location
     *   - The symbol's declaration is a function parameter (cross-boundary: the
     *     concrete signal identity is unknown from this call site)
     */
    private resolveSignalId;
    /**
     * Unwrap transparent AST wrappers: parentheses, 'as' expressions,
     * angle-bracket type assertions. These don't change the expression's
     * runtime value, only its presentation or TypeScript type.
     */
    private unwrapTransparent;
}
//# sourceMappingURL=sync-target-classifier.d.ts.map