/**
 * nv Compiler — Shared Types
 * Stream: (2) Compiler specialization layer
 * Contract: nv-reactive-core-contract.md v0.4
 */

import type * as ts from 'typescript'

// ── Signal identity ────────────────────────────────────────────────────────────
/**
 * Stable write-graph identity for a specific nv signal instance.
 * Format: "<normalizedAbsoluteFilePath>#<symbolName>@<declarationOffset>"
 *
 * Derived by following the TypeScript symbol's alias chain to the canonical
 * declaration. Stable across imports and re-exports of the same signal.
 */
export type SignalId = string

// ── Internal enumeration result ───────────────────────────────────────────────
/**
 * Result of the recursive target expression enumerator.
 * Consumed by classifyConditionalThunk to produce the final TargetVerdict.
 *
 * Merge semantics (used in ConditionalExpression branches):
 *   SIGNALS + SIGNALS      → SIGNALS(union)        — all branches enumerable
 *   NON_ENUMERABLE + any   → NON_ENUMERABLE         — proven non-enumerable wins
 *   UNDECIDABLE + SIGNALS  → UNDECIDABLE            — partial set is not safe to ACCEPT
 *   UNDECIDABLE + UNDECIDABLE → UNDECIDABLE
 */
export type EnumResult =
  | { kind: 'SIGNALS'; signals: ReadonlySet<SignalId> }
  | { kind: 'NON_ENUMERABLE'; reason: string }
  | { kind: 'UNDECIDABLE'; reason: string }

// ── Per-sync() call verdict ───────────────────────────────────────────────────
/**
 * Per-sync() call verdict (§8.5.3, §10 row 1).
 *
 * ACCEPT
 *   Target is provably enumerable. The `targets` set feeds the write-graph cycle
 *   checker (§8.5.2).
 *   CONSERVATIVE-ON-INCOMPLETENESS: a missing edge in `targets` (analysis was
 *   incomplete) degrades to the runtime cascade cap — it never lets the cycle
 *   checker assert acyclicity it has not proven. The cycle checker downstream
 *   MUST preserve this invariant.
 *
 * REJECT
 *   Target is provably non-enumerable (e.g., runtime-indexed array, dynamic
 *   lookup call). Directive to user: refactor or use effect (§8.5.4).
 *
 * UNDECIDABLE
 *   Analysis cannot decide enumerability. Conservative default per §8.5.3 option
 *   (a): treat as non-enumerable → force effect at the call site.
 *   Option (b) — accept with runtime enumerability check + soundness fallback —
 *   is deliberately deferred; flag to revisit when real renderer components
 *   arrive, because forced-effect-on-any is a real DX cost. (Arch ruling
 *   2026-06-15; not a settled truth.)
 */
export type TargetVerdict =
  | {
      kind: 'ACCEPT'
      /** Enumerated target set. Fed to write-graph cycle checker. */
      targets: ReadonlySet<SignalId>
      callNode: ts.CallExpression
    }
  | {
      kind: 'REJECT'
      reason: string
      /** User-facing diagnostic string. */
      diagnostic: string
      callNode: ts.CallExpression
    }
  | {
      kind: 'UNDECIDABLE'
      reason: string
      callNode: ts.CallExpression
    }

// ── Branch-variant dependency set types (§10 row 4) ──────────────────────────

/**
 * Compiler-side verdict for a derived/effect compute body (§10 row 4).
 *
 * DECLARED: the compiler proved the complete union of all possible reactive reads
 *   across all branches of the body. `declaredUnion` feeds the runtime's §10 hook
 *   as the expected-reads oracle (not as a replacement for tracking — see design).
 *
 * DECLINE: the compiler could not prove completeness for this body (opaque call,
 *   loop, complex block, unresolvable symbol, etc.). The node uses §5.2 dynamic
 *   collection unchanged. This is ALWAYS the safe direction.
 *
 * All-or-nothing rule: any unanalyzable sub-expression declines the ENTIRE body.
 *   A partial set claiming completeness is the failure mode; declining the whole
 *   node avoids it. The fallback (§5.2 dynamic collection) is always correct.
 *
 * The oracle does NOT skip the tracking context. Tracking stays on; `reconcileEdges`
 *   in the finally block is always the ground truth. The declared union is used only
 *   to detect divergence (a read outside the union) and to enable cheaper
 *   reconciliation when the union is correct. (Arch ruling 2026-06-17: E2 conservative
 *   scope — skip-tracking is a separate future hook with its own soundness proof.)
 *
 * Edges always reflect ACTUAL reads, never the declared union:
 *   `cond?a:b` with union {cond,a,b} — a run that reads {cond,a} must still remove
 *   the `b` edge even though `b` is in the declared union.
 */
export type BranchVariantVerdict =
  | {
      kind: 'DECLARED'
      /** Union of all possible reactive reads across all branches. */
      declaredUnion: ReadonlySet<SignalId>
      callNode: ts.CallExpression
    }
  | {
      kind: 'DECLINE'
      reason: string
      callNode: ts.CallExpression
    }

// ── Equality-policy inference types (§7.1, §10 row 2) ────────────────────────

/**
 * Inferred equality policy for a reactive node (§7.1).
 *
 * OBJECT_IS  — Confirmed primitive type (number, string, boolean, bigint, symbol,
 *              null, undefined, or their literal variants). Object.is is provably
 *              correct and optimal. Emitted explicitly so downstream can distinguish
 *              "compiler confirmed" from "compiler never looked."
 *
 * FALSE      — Confirmed mutable-in-place standard-library container (Array<T>,
 *              Map<K,V>, Set<T>, WeakMap<K,V>, WeakSet<T>, mutable tuples).
 *              Must always propagate to avoid the §7 footgun: arr.push(x);
 *              sig.set(arr) — reference unchanged, contents not.
 *
 * DECLINE    — Analyzed, no opinion. Covers: user-defined objects/classes, union
 *              types containing non-primitives, generic type parameters, any/unknown,
 *              ReadonlyArray<T> and readonly tuples (TypeScript's readonly is type-
 *              level only, not a runtime guarantee — can be cast away). Runtime
 *              default (Object.is) applies. Same behavior as unspecialized runtime.
 *
 * STRUCTURAL — Recognized as a future category (types with a cheap structural
 *              compare), but NOT emitted by this pass. Whether structural comparison
 *              beats Object.is on a real workload is unmeasured; per §10 hard rule,
 *              this must be validated against the baseline benchmark before shipping.
 *              Marked for Claude Code validation — not a hypothesis this pass decides.
 *
 * Correctness asymmetry (§7): erring toward OBJECT_IS when the type is actually
 * mutated in place suppresses updates → wrong result. Erring toward DECLINE is
 * always safe (same as today without the compiler). DECLINE is the correct fallback
 * for any type where immutability cannot be proven.
 */
export type EqualityPolicy = 'OBJECT_IS' | 'FALSE' | 'DECLINE'

export interface EqualityPolicyVerdict {
  policy: EqualityPolicy
  /** String representation of the inferred value type T (for diagnostics/audit). */
  valueTypeString: string
  callNode: ts.CallExpression
}

// ── Write-graph cycle checker types ───────────────────────────────────────────

/**
 * Result of analyzing which signals a sync's source thunk reactively reads.
 *
 * SIGNALS: complete static read set — all reactive reads were resolved.
 * PARTIAL: some reads resolved, some could not (nested function bodies, unresolvable
 *   symbols). The known edges are added to the graph; the rest degrade to the
 *   runtime cascade cap. Safe: might miss a cycle, never false-positive one.
 * UNKNOWN: no reads could be extracted (pubsub source, non-analyzable thunk).
 *   No edges added for this sync. Runtime cap is the only cycle gate for it.
 *
 * Conservative-on-incompleteness: a missed read = a missed write-graph edge =
 * a potentially missed cycle → falls to runtime cascade cap. Never a false cycle.
 */
export type ReadEnumResult =
  | { kind: 'SIGNALS'; signals: ReadonlySet<SignalId> }
  | { kind: 'PARTIAL'; signals: ReadonlySet<SignalId>; reason: string }
  | { kind: 'UNKNOWN'; reason: string }

/**
 * A single directed edge bundle in the write-graph, derived from one sync() call.
 * Contributes edges readSignal → writeSignal for each (read, write) pair.
 *
 * Edge semantics: "a reactive write to `read` may trigger this sync, which writes
 * to `write`." A cycle in the resulting graph is a potential infinite cascade.
 */
export interface SyncEdge {
  reads: ReadonlySet<SignalId>
  writes: ReadonlySet<SignalId>
  /** Whether source analysis was complete. Incomplete → some edges may be missing. */
  readsComplete: boolean
  callNode: ts.CallExpression
}

/**
 * A detected cycle in the write-graph (§8.5.2).
 *
 * `cycle` is an ordered sequence of SignalIds [A, B, C] meaning A→B→C→A.
 * `involvedSyncs` are the sync() calls whose read/write edges form the cycle —
 * the information needed to emit diagnostics at the right call sites.
 *
 * Conservative-on-incompleteness applies: a genuine runtime cycle may produce no
 * report if source analysis was incomplete. Safe — runtime cascade cap fires.
 * A CycleReport is never a false positive.
 */
export interface CycleReport {
  cycle: SignalId[]
  involvedSyncs: ts.CallExpression[]
}

// ── Classifier configuration ───────────────────────────────────────────────────
export interface ClassifierConfig {
  /**
   * Normalized absolute path to the nv core module (core.ts / @neutro/core).
   *
   * REQUIRED for the nominal isNvSignal check. Must not be omitted in favour
   * of a structural-only check: the verdict gates the write-graph cycle checker,
   * and a structural false match (a non-nv type that happens to be callable+.set)
   * would corrupt the write-graph, potentially producing wrong build-time verdicts.
   * (Arch ruling 2026-06-15: nominal now, not deferred.)
   */
  nvCorePath: string
}
