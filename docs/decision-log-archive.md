# nv Decision Log — Archive

Superseded/stale entries relocated from `decision-log.md` to keep the live log navigable.
Entries here are historical record only; the live log's Current State is authoritative for
what is decided now. Each relocation leaves a one-line pointer in the live log.

---

### SyncBinding Part 3 RESOLVED — A2 accepted; §8.5.2 contract bump v0.4.2 → v0.4.3 [2026-06-24]

**Workstream:** WS4 (architect ruling) → WS2 (commission). **Type:** design ruling +
contract bump + implementation commission. **Probe verified at `9172e5a`**;
architect re-verified the load-bearing seams at the same SHA (did not rely on probe
summary alone).

**Resolves** the deferral in *SyncBinding Part 3* [2026-06-24]. That entry deferred the
write-back edge mechanism with a lean toward Approach A and named the §8.5.2
build-integration driver as prerequisite. The driver landed (*Unit 1* [2026-06-24]); the
Unit 2 probe then tested A's viability empirically.

**Decision: Approach A2 accepted** — the classifier learns to recognize the emitted
SyncBinding IR-literal shape (`{ kind: 'sync', writeTarget, readExpr }`) and contributes
its write-graph edge through the **existing** `signalSymbolId` derivation. One symbol
space, one ID scheme, no second representation.

**Empirical basis (probe + architect re-verification at `9172e5a`).**
- **Resolution axis CONFIRMED:** emitted `writeTarget: val` and hand-written
  `sync(..., val)` both resolve via `signalSymbolId` to `signals.ts#val@46`. Alias
  resolution is context-independent (property value vs. call argument is irrelevant).
- **Premise CONFIRMED:** `checkProgram` over an emitted module yields zero verdicts today
  — the IR literal is invisible to the classifier. A2 closes exactly this.
- **A1 rejected:** a checker-visible `sync()` anchor is a second representation (structural
  drift — the degraded-copy pattern Part 3 forbade) AND a live anchor double-executes the
  binding, corrupting the reactive graph with a spurious second node. (Architect confirmed
  the double-execution hazard.)
- **A3 rejected:** no TypeChecker at plugin time (settled in Unit 1), so the plugin cannot
  compute `signalSymbolId`; any raw-edge channel collapses to A2 with added IO complexity.

**Two corrections to the probe's cost estimate (architect re-verification).**
1. The shared-type change is **two** types, not one: both `TargetVerdict.callNode` AND
   `SyncEdge.callNode` are `ts.CallExpression`.
2. The checker derives an ACCEPT edge's `reads` from `verdict.callNode.arguments[0]`
   (`write-graph-cycle-checker.ts:68`). A SyncBinding verdict has no `.arguments`. So A2 is
   **not** a blanket widen of `callNode` to `ts.Node` (that would compile but break the
   `.arguments[0]` access at runtime). **Ruling: model the verdict/edge as a discriminated
   convergence** — `sync-call` source carries the CallExpression and extracts reads from
   `arguments[0]`; `sync-binding` source carries `reads: ∅, writes: {target}` directly and
   never reaches `.arguments`. The type system must make `.arguments`-on-SyncBinding
   unreachable, not merely untested.

**SyncBinding edge shape (realizes Part 3 §6 static-target ruling):** `reads: ∅, writes:
{target}`. The write-back is DOM-event-triggered (no reactive read). The `readExpr` is the
signal→DOM render direction and contributes NO write-graph edge — it must not be routed
through `analyzeSourceReads`.

**Contract bump v0.4.2 → v0.4.3.** §8.5.2's edge definition widens: renderer-synthesized
SyncBindings now contribute edges on the same footing as source `sync(...)` calls, and the
global check explicitly spans the `.nv`/`.ts` front-end boundary. Edits in
`contract-bump-v0.4.3.md` (title version; §8.5.2 opening paragraph; cross-boundary bullet;
dynamic-target exclusion note). The Part 3 entry anticipated this bump "at the
driver-implementation session, against real integration code" — this is that bump, now
against verified seams. Dynamic-target exclusion (D-sync-cond-1) carried into the contract
as an explicit scope note, preserving never-false-positive.

**Commissioned:** Unit 2 implementation to WS2/CC (`handoff-unit2-impl-CC.md`), plan-first,
gates G0–G6. The §2.3 type-convergence shape is pre-decided (this ruling); a blanket-widen
plan is a G0 re-surface. **Commission authorized to proceed now** — A2-confirmed-on-both-
axes is a verified fact, not an open gate (architect + Kofi, this session).

**Supersedes:** the deferral in *Part 3* [2026-06-24] (cites it). **Cites:** *Unit 1
LANDED* [2026-06-24], *D-sync-cond-1* [2026-06-24], probe `unit2-probe-results.md`.
