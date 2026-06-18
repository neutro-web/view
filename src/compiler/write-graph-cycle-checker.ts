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

import * as ts from 'typescript'
import {
  isLiteralKeyExpr,
  isNvSignalType,
  signalSymbolId,
  symbolIsFromNvCore,
} from './signal-type-utils'
import type {
  ClassifierConfig,
  CycleReport,
  ReadEnumResult,
  SignalId,
  SyncEdge,
  TargetVerdict,
} from './types'

// ── Public API ─────────────────────────────────────────────────────────────────

export class WriteGraphCycleChecker {
  private readonly nvCorePath: string

  constructor(config: ClassifierConfig) {
    this.nvCorePath = config.nvCorePath
  }

  /**
   * Build the write-graph from ACCEPT verdicts and detect cycles.
   *
   * @param program  The TypeScript program (for the type checker).
   * @param verdicts All verdicts from the target classifier. Non-ACCEPT verdicts
   *                 are ignored — they have no enumerated target set to add edges for.
   * @returns        Array of detected cycles. Empty = no cycles found (may be
   *                 incomplete if source analysis couldn't resolve all reads).
   */
  check(program: ts.Program, verdicts: readonly TargetVerdict[]): CycleReport[] {
    const checker = program.getTypeChecker()
    const acceptVerdicts = verdicts.filter(
      (v): v is TargetVerdict & { kind: 'ACCEPT' } => v.kind === 'ACCEPT',
    )
    if (acceptVerdicts.length === 0) return []

    // Step A: build SyncEdge for each ACCEPT verdict
    const syncEdges: SyncEdge[] = []
    for (const verdict of acceptVerdicts) {
      const sourceArg = verdict.callNode.arguments[0]
      if (!sourceArg) continue
      const readResult = this.analyzeSourceReads(sourceArg, checker)
      const reads = readResult.kind === 'UNKNOWN' ? new Set<SignalId>() : readResult.signals
      syncEdges.push({
        reads,
        writes: verdict.targets,
        readsComplete: readResult.kind === 'SIGNALS',
        callNode: verdict.callNode,
      })
    }

    // Step B: build directed graph + attribution
    const { graph, attribution } = this.buildGraph(syncEdges)

    // Step C: detect cycles
    return this.detectCycles(graph, attribution)
  }

  /**
   * Analyze which nv signals a source thunk reactively reads.
   * Public for direct testing.
   *
   * Rules:
   *   - Reads inside untrack() are excluded (not reactive dependencies).
   *   - Reads inside nested function definitions are skipped (returns PARTIAL).
   *   - PubSub channels and other non-function sources return UNKNOWN.
   */
  analyzeSourceReads(sourceArg: ts.Expression, checker: ts.TypeChecker): ReadEnumResult {
    const body = this.getSourceBody(sourceArg, checker)
    if (body === null) {
      return {
        kind: 'UNKNOWN',
        reason: 'source is not an analyzable function (pubsub channel or opaque expression)',
      }
    }

    const reads = new Set<SignalId>()
    const incomplete = { value: false }
    this.walkReads(body, checker, reads, incomplete)

    if (reads.size === 0 && incomplete.value) {
      return { kind: 'UNKNOWN', reason: 'source has no resolvable reactive reads' }
    }
    if (incomplete.value) {
      return {
        kind: 'PARTIAL',
        signals: reads,
        reason: 'some reads could not be resolved (nested functions or unresolvable symbols)',
      }
    }
    return { kind: 'SIGNALS', signals: reads }
  }

  // ── Source body extraction ────────────────────────────────────────────────────

  /**
   * Extract the body node from a source thunk expression.
   * Returns the full body (expression or block) for read walking.
   * Returns null for non-function sources (pubsub, etc.).
   *
   * Follows a single level of identifier → variable initializer.
   */
  private getSourceBody(
    expr: ts.Expression,
    checker: ts.TypeChecker,
  ): ts.ConciseBody | ts.Block | null {
    let resolved: ts.Expression = expr

    // Follow identifier to its variable declaration
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

  // ── Reactive read walker ──────────────────────────────────────────────────────

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
  private walkReads(
    node: ts.Node,
    checker: ts.TypeChecker,
    reads: Set<SignalId>,
    incomplete: { value: boolean },
  ): void {
    // Skip nested function definitions entirely.
    // The top-level body is NOT a function definition — it's the body extracted
    // FROM the arrow/function expression by getSourceBody. Any arrow function or
    // function expression we encounter here is a nested definition inside the body.
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      incomplete.value = true // reads inside may exist but are not tracked
      return
    }

    if (ts.isCallExpression(node)) {
      // Skip untrack() subtrees — reads inside are not reactive dependencies.
      if (this.isUntrackedCall(node, checker)) return

      // Check if the callee is an nv signal being invoked (a reactive read).
      const calleeType = checker.getTypeAtLocation(node.expression)
      if (isNvSignalType(calleeType, checker, this.nvCorePath)) {
        this.addSignalRead(node.expression, checker, reads, incomplete)
      }
    }

    ts.forEachChild(node, (child) => this.walkReads(child, checker, reads, incomplete))
  }

  /**
   * Nominally identify a CallExpression as nv's untrack().
   * Same nominal pattern as isSyncCall in the target classifier.
   */
  private isUntrackedCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
    const callee = call.expression
    let nameNode: ts.Identifier | null = null
    if (ts.isIdentifier(callee) && callee.text === 'untrack') {
      nameNode = callee
    } else if (
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
  private addSignalRead(
    callee: ts.Expression,
    checker: ts.TypeChecker,
    reads: Set<SignalId>,
    incomplete: { value: boolean },
  ): void {
    let sym: ts.Symbol | undefined

    if (ts.isIdentifier(callee)) {
      sym = checker.getSymbolAtLocation(callee)
    } else if (ts.isPropertyAccessExpression(callee)) {
      sym = checker.getSymbolAtLocation(callee.name)
    } else if (
      ts.isElementAccessExpression(callee) &&
      isLiteralKeyExpr(callee.argumentExpression)
    ) {
      const keyText = (callee.argumentExpression as ts.StringLiteral | ts.NumericLiteral).text
      const objType = checker.getTypeAtLocation(callee.expression)
      sym = objType.getProperty(keyText)
    }

    if (!sym) {
      incomplete.value = true
      return
    }

    // Cross-boundary: parameter signal — concrete identity unknown from call site
    const decl = sym.valueDeclaration ?? sym.declarations?.[0]
    if (decl && ts.isParameter(decl)) {
      incomplete.value = true
      return
    }

    reads.add(signalSymbolId(sym, checker))
  }

  // ── Graph construction ────────────────────────────────────────────────────────

  /**
   * Build the directed write-graph from SyncEdges.
   *
   * Edge R → W: some sync reads R and writes W ("write to R may trigger a
   * write to W"). A cycle in this graph is a potential reactive cascade loop.
   *
   * Also builds an attribution map (R, W) → Set<CallExpression> so that detected
   * cycles can report which sync calls formed each edge.
   */
  private buildGraph(syncEdges: SyncEdge[]): {
    graph: Map<SignalId, Set<SignalId>>
    attribution: Map<SignalId, Map<SignalId, Set<ts.CallExpression>>>
  } {
    const graph = new Map<SignalId, Set<SignalId>>()
    const attribution = new Map<SignalId, Map<SignalId, Set<ts.CallExpression>>>()

    const addEdge = (from: SignalId, to: SignalId, call: ts.CallExpression): void => {
      if (!graph.has(from)) graph.set(from, new Set())
      graph.get(from)?.add(to)

      if (!attribution.has(from)) attribution.set(from, new Map())
      const toMap = attribution.get(from)
      if (toMap !== undefined) {
        if (!toMap.has(to)) toMap.set(to, new Set())
        toMap.get(to)?.add(call)
      }
    }

    for (const edge of syncEdges) {
      for (const read of edge.reads) {
        for (const write of edge.writes) {
          addEdge(read, write, edge.callNode)
        }
      }
    }

    return { graph, attribution }
  }

  // ── Cycle detection ───────────────────────────────────────────────────────────

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
  private detectCycles(
    graph: Map<SignalId, Set<SignalId>>,
    attribution: Map<SignalId, Map<SignalId, Set<ts.CallExpression>>>,
  ): CycleReport[] {
    // Collect all nodes (sources AND targets — target-only nodes have no out-edges
    // but may be visited as neighbors)
    const allNodes = new Set<SignalId>(graph.keys())
    for (const neighbors of graph.values()) {
      for (const n of neighbors) allNodes.add(n)
    }

    type Color = 'W' | 'G' | 'B'
    const color = new Map<SignalId, Color>()
    for (const n of allNodes) color.set(n, 'W')

    const path: SignalId[] = []
    const reports: CycleReport[] = []
    const seenNorms = new Set<string>()

    const dfs = (v: SignalId): void => {
      color.set(v, 'G')
      path.push(v)

      for (const w of graph.get(v) ?? []) {
        const wColor = color.get(w) ?? 'W'

        if (wColor === 'G') {
          // Back-edge: w is on the current path → cycle
          const startIdx = path.indexOf(w)
          const cycle = path.slice(startIdx) // [w, ..., v] forms cycle back to w

          const norm = normalizeCycle(cycle)
          if (!seenNorms.has(norm)) {
            seenNorms.add(norm)
            reports.push({
              cycle,
              involvedSyncs: findInvolvedSyncs(cycle, attribution),
            })
          }
        } else if (wColor === 'W') {
          dfs(w)
        }
        // BLACK: fully processed subtree, no new cycles through w
      }

      path.pop()
      color.set(v, 'B')
    }

    for (const node of allNodes) {
      if ((color.get(node) ?? 'W') === 'W') dfs(node)
    }

    return reports
  }
}

// ── Cycle utilities ────────────────────────────────────────────────────────────

/**
 * Normalize a cycle for deduplication: rotate so the lexicographically
 * smallest SignalId is first, then join with '|'.
 * [A, B, C] and [B, C, A] and [C, A, B] all normalize to the same string.
 */
function normalizeCycle(cycle: SignalId[]): string {
  if (cycle.length === 0) return ''
  const minIdx = cycle.reduce((best, _, i) => (cycle[i]! < cycle[best]! ? i : best), 0)
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)].join('|')
}

/**
 * For a cycle [A, B, C] (meaning A→B→C→A), look up which sync CallExpressions
 * created each edge in the attribution map.
 */
function findInvolvedSyncs(
  cycle: SignalId[],
  attribution: Map<SignalId, Map<SignalId, Set<ts.CallExpression>>>,
): ts.CallExpression[] {
  const syncs = new Set<ts.CallExpression>()
  for (let i = 0; i < cycle.length; i++) {
    const from = cycle[i]!
    const to = cycle[(i + 1) % cycle.length]!
    const callSet = attribution.get(from)?.get(to)
    if (callSet !== undefined) {
      for (const c of callSet) syncs.add(c)
    }
  }
  return [...syncs]
}
