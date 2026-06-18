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
import * as ts from 'typescript';
import type { BranchVariantVerdict, ClassifierConfig, SignalId } from './types';
type BodyResult = {
    kind: 'SIGNALS';
    signals: ReadonlySet<SignalId>;
} | {
    kind: 'DECLINE';
    reason: string;
};
export declare class BranchVariantAnalyzer {
    private readonly nvCorePath;
    constructor(config: ClassifierConfig);
    /** Analyze all derived() and effect() calls in the program. */
    analyzeProgram(program: ts.Program): BranchVariantVerdict[];
    /** Analyze a single call expression. Returns null for non-derived/effect calls. */
    analyzeCall(call: ts.CallExpression, checker: ts.TypeChecker): BranchVariantVerdict | null;
    /**
     * Analyze a compute body node (expression or block).
     * Public for direct testing of body shapes.
     */
    analyzeBody(body: ts.Node, checker: ts.TypeChecker): BodyResult;
    private isDerivedOrEffectCall;
    private extractComputeBody;
    /**
     * Analyze a block body.
     * Accepts only VariableStatement and a single ReturnStatement.
     * Any other statement kind → DECLINE (all-or-nothing rule).
     */
    private analyzeBlock;
    /**
     * Recursively enumerate reactive reads in an expression.
     *
     * Returns SIGNALS(set) when the entire expression is provably analyzed.
     * Returns DECLINE when any sub-expression is unanalyzable — the all-or-nothing rule.
     *
     * Reactive read = a CallExpression whose callee type is an nv SignalAccessor.
     * Identifiers and property accesses that aren't called are not reactive reads.
     */
    private analyzeExpr;
    /**
     * Analyze a CallExpression for reactive reads.
     *
     *   - nv signal callee (sig(), obj.prop(), obj['key']()) → SIGNALS({calleeId})
     *   - nv untrack() callee → EMPTY (reads inside are not reactive — skip subtree)
     *   - any other callee → DECLINE (may read signals via closure; opaque boundary)
     */
    private analyzeCallExpr;
    /**
     * Resolve the stable SignalId for the callee of a signal read.
     * Returns null if the symbol is unresolvable or is a function parameter
     * (cross-boundary: concrete identity unknown).
     *
     * MUST use signalSymbolId — same derivation as steps 1 and 2 — so that a signal
     * appearing in both the declared union and a sync target/source read produces the
     * same identity.
     */
    private resolveReadId;
    private isUntrackedCall;
    /**
     * Merge two BodyResults.
     * DECLINE wins unconditionally (all-or-nothing rule).
     * SIGNALS + SIGNALS = SIGNALS(union).
     */
    private merge;
}
export {};
//# sourceMappingURL=branch-variant-analyzer.d.ts.map