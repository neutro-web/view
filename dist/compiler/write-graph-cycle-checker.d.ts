/**
 * nv Compiler — Write-Graph Cycle Checker
 * Stream:   (2) Compiler specialization layer
 * Contract: nv-reactive-core-contract.md v0.4, §8.5.2, §10 row 1
 *
 * Consumes ACCEPT verdicts from the sync-target classifier (step 1) and the
 * TypeScript program. For each ACCEPT verdict:
 *   1. Analyzes the sync's SOURCE thunk to find which nv signals it reactively reads.
 *   2. Contributes directed write-graph edges: readSignal → writeSignal.
 *
 * Then runs DFS cycle detection over the complete write-graph.
 *
 * Hard invariants:
 *   - Uses signalSymbolId from signal-type-utils — SAME derivation as step 1.
 *     A signal referenced as a sync target and the same signal read in another
 *     sync's source must produce identical IDs, or the graph edges won't connect.
 *   - Conservative-on-incompleteness: a missed read = missing edge = missed cycle.
 *     Falls to runtime cascade cap. Never produces a false cycle report.
 *   - Reads inside untrack() are excluded (they are not reactive dependencies).
 *   - Reads inside nested function definitions are skipped (safe: might miss a
 *     cycle, never false-positive). Sets readsComplete = false.
 */
import * as ts from 'typescript';
import type { ClassifierConfig, CycleReport, ReadEnumResult, TargetVerdict } from './types';
export declare class WriteGraphCycleChecker {
    private readonly nvCorePath;
    constructor(config: ClassifierConfig);
    /**
     * Build the write-graph from ACCEPT verdicts and detect cycles.
     *
     * @param program  The TypeScript program (for the type checker).
     * @param verdicts All verdicts from the target classifier. Non-ACCEPT verdicts
     *                 are ignored — they have no enumerated target set to add edges for.
     * @returns        Array of detected cycles. Empty = no cycles found (may be
     *                 incomplete if source analysis couldn't resolve all reads).
     */
    check(program: ts.Program, verdicts: readonly TargetVerdict[]): CycleReport[];
    /**
     * Analyze which nv signals a source thunk reactively reads.
     * Public for direct testing.
     *
     * Rules:
     *   - Reads inside untrack() are excluded (not reactive dependencies).
     *   - Reads inside nested function definitions are skipped (returns PARTIAL).
     *   - PubSub channels and other non-function sources return UNKNOWN.
     */
    analyzeSourceReads(sourceArg: ts.Expression, checker: ts.TypeChecker): ReadEnumResult;
    /**
     * Extract the body node from a source thunk expression.
     * Returns the full body (expression or block) for read walking.
     * Returns null for non-function sources (pubsub, etc.).
     *
     * Follows a single level of identifier → variable initializer.
     */
    private getSourceBody;
    /**
     * Walk an AST node and collect all nv signal reactive reads.
     *
     * Signal read = a CallExpression whose callee type is an nv SignalAccessor
     *   (i.e., the signal is being invoked: `sig()`).
     *
     * Skips:
     *   - untrack() call subtrees (reads inside are not reactive)
     *   - Nested function/arrow definitions (interprocedural out of scope;
     *     sets incomplete=true so the result is PARTIAL, not SIGNALS)
     */
    private walkReads;
    /**
     * Nominally identify a CallExpression as nv's untrack().
     * Same nominal pattern as isSyncCall in the target classifier.
     */
    private isUntrackedCall;
    /**
     * Resolve and record the identity of a signal read from a callee expression.
     *
     * Handles:
     *   - Identifiers:           sig()        → symbol of `sig`
     *   - PropertyAccess:        obj.sig()    → symbol of property `sig`
     *   - ElementAccess literal: obj['sig']() → property symbol via type lookup
     *
     * Sets incomplete if the symbol cannot be resolved or is a function parameter
     * (cross-boundary: concrete signal unknown). Safe: missed read = missed edge.
     *
     * MUST use signalSymbolId from signal-type-utils — same derivation as step 1 —
     * so that a signal appearing as both a sync target and a source read produces
     * the same ID, allowing the write-graph edges to connect properly.
     */
    private addSignalRead;
    /**
     * Build the directed write-graph from SyncEdges.
     *
     * Edge R → W: some sync reads R and writes W ("write to R may trigger a
     * write to W"). A cycle in this graph is a potential reactive cascade loop.
     *
     * Also builds an attribution map (R, W) → Set<CallExpression> so that detected
     * cycles can report which sync calls formed each edge.
     */
    private buildGraph;
    /**
     * DFS cycle detection with three-color marking (WHITE / GRAY / BLACK).
     * A back-edge to a GRAY node (currently on the DFS stack) indicates a cycle.
     *
     * Extracts the cycle from the current path and deduplicates by normalizing
     * (rotate to lexicographically smallest ID, then join). Deduplication prevents
     * reporting the same cycle multiple times when DFS starts from different nodes
     * in the same strongly connected component.
     *
     * Returns CycleReport[] with the cycle path and the sync CallExpression nodes
     * that form the cycle's edges (derived from the attribution map).
     *
     * Note: recursive DFS. The compiler stream is not bound by the runtime's
     * no-recursion rule, but a pathologically deep write-graph (thousands of unique
     * signal nodes in one chain) could overflow the call stack. Acceptable for
     * build-time analysis of real codebases; revisit if usage patterns prove otherwise.
     */
    private detectCycles;
}
//# sourceMappingURL=write-graph-cycle-checker.d.ts.map