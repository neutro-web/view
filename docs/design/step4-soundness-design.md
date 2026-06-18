# Step 4 Soundness Design — Branch-Variant Dependency Sets
## For architect review before implementation
 
**Stream:** Compiler specialization (2)  
**Hook:** §10 row 4 — static dependency set / branch variants  
**Status:** Design only. No analysis code. Awaiting architect review.
 
---
 
## What this document is
 
The step 4 brief requires a written soundness design before any analysis code, because this is the hook where a wrong design passes its tests and still ships a correctness bug. This document answers the five required questions concretely, surfaces two design choices I want reviewed before committing to them, and describes the mandatory property test approach.
 
---
 
## 1. What counts as a provable per-branch read-set
 
The bar for "provable" is high. A body qualifies only when **every reactive read on every path is statically visible** to the analysis — meaning the analysis can enumerate, without interprocedural reasoning, exactly which nv signals are called on every execution path through the body.
 
### Shapes I will attempt
 
**Simple ternary** — `cond() ? a() : b()`  
All three signals are directly called at the top level. No loops, no opaque calls. Provable union: `{cond, a, b}`. If per-branch variants are desired, variant structure is `{cond, a}` on the true path and `{cond, b}` on the false path.
 
**Nested ternary** — `c1() ? (c2() ? a() : b()) : c3()`  
Still a tree of ternary nodes with direct signal reads at the leaves. Recursively provable by the same analysis that handles the simple case.
 
**Flat sequence of reads (no branching)** — `a() + b() * c()`  
Every operand is a direct signal read. No control flow. Trivially provable: single source set `{a, b, c}`, no variants needed.
 
**Block body with a single unconditional return, no branching** — `() => { const x = a(); return x + b() }`  
Same as flat sequence, just split across statements. Provable if the block has exactly one exit (no early returns, no conditionals). The analysis here reuses the `resolveFunctionBody` logic from steps 1–2.
 
### Shapes I will explicitly not attempt — decline to dynamic collection
 
**Opaque function calls in the body** — `derived(() => helper())` where `helper` is not an nv signal  
The function call is an unknown boundary. Even if the argument list is visible, the callee may read signals through its closure. The analysis declines the ENTIRE body on any opaque call (not just that sub-expression — see "all-or-nothing" rule below).
 
**Loops** (`for`, `while`, `do-while`)  
Number of reads per iteration is runtime-determined. NOT provable.
 
**`switch` statements**  
More complex path analysis than ternary. Deferred. Fall to dynamic collection.
 
**Logical operators with short-circuit** — `a() && b()`, `a() || b()`, `a() ?? b()`  
These ARE theoretically analyzable (`a() && b()` has variants `{a}` when a() is falsy and `{a, b}` when a() is truthy), but short-circuit semantics add complexity I'm not confident I can cover without introducing a new category of divergence. Declining for the prototype to avoid over-committing. *Surfaced for architect input — see escalation notes.*
 
**Optional chaining** — `obj?.method?.()`  
Same short-circuit issue as logical operators.
 
**`try/catch` bodies**  
Exception paths create control flow the ternary analysis doesn't model.
 
**Async/generator functions**  
Tracked reads across `yield`/`await` boundaries have complex and unsettled semantics for this system.
 
**Any nesting of reads inside calls that aren't nv signal accessors** — e.g., `Math.max(a(), b())` where `a` and `b` are signals  
Wait — this is actually fine if `Math.max` is not itself an nv node. The signals `a` and `b` are still directly read; their calls register reads normally. The opaque call rule applies to the callee: `Math.max(a(), b())` is provable because both arguments are direct signal reads. The non-nv callee (`Math.max`) does not enter a tracking context. Clarifying: "opaque function calls" means calls that may themselves READ nv signals internally (closures over signals, etc.). A call like `Math.max(a(), b())` is safe; a call like `computeVal()` where `computeVal: () => signal()` is not.
 
**The all-or-nothing rule:** if the analysis encounters any non-provable expression anywhere in the body, it declines the entire node for this hook. Emitting a partial variant is NOT safe — the divergence check (§2 below) expects the declared set to be the complete set of possible reads. A partial set that claims completeness is worse than no set at all.
 
---
 
## 2. The divergence-detection mechanism
 
**The core constraint:** I cannot skip the tracking context. The tracking context is the ground truth for what was actually read. Any mechanism that bypasses `currentObserver = node` during compute would require a completely different correctness proof. The existing reconciliation that runs in the `finally` block is the proven safety net; I must keep it.
 
**What "variant mode" actually means:**
 
A variant-mode recompute runs the compute function **with tracking enabled, exactly as today.** The declared source set (the union of all branch variants the compiler emitted) is used as an **expected-reads oracle**, not as a replacement for tracking.
 
During the run, at each reactive read, the runtime checks:
 
> Is this signal in the declared source union for this node?
 
- **Yes** → read proceeds normally; no overhead beyond one Set.has() lookup
- **No** → divergence detected; switch to `_variantMode = false` for this node for the rest of this run; continue to completion
After the run, `reconcileEdges` runs as always (in the `finally` block — §5.4.1 guarantees this regardless of divergence or throw).
 
**The optimization that divergence detection enables:**
 
When NO divergence was detected, the runtime knows that the actual reads were a subset of the declared union. At reconciliation time, the declared edges are already the correct edges (up to subset). The diff against old sources is cheaper: the declared set provides a pre-known boundary.
 
More precisely: the saving is in the reconciliation diff, not in skipping tracking. Skipping tracking entirely is a more aggressive optimization that requires a different, higher-risk mechanism. For this design, I'm explicitly scoping to the cheaper reconciliation case. Whether skipping tracking is worth it is a benchmark question for the Claude Code stream.
 
**The check is O(1) per read:** a `Set.has()` call. The declared union is a `ReadonlySet<SignalId>` attached to the node, built at compile time. The total overhead per run is at most `|actual reads| * O(1)` for the has() checks. Whether this overhead is less than the reconciliation savings is — again — a benchmark question.
 
---
 
## 3. The fallback path
 
**Divergence detected during a run:** switch `_variantMode = false` for this run, continue the compute to completion with tracking enabled (it was already enabled). At the end, `reconcileEdges` runs normally (the `finally` block — always runs, per §5.4.1). This is exactly §5.2 dynamic collection, the proven path.
 
**Compiler declined (no variant emitted):** the node's `_compilerSources` field is null. The recompute runs as today, with no variant logic touched. Exactly §5.2.
 
**There is no new fallback path.** The variant mechanism is an optimization hint. The existing reconciliation is always the final authority. If the declared set was wrong, reconciliation corrects it, and the result is identical to an unspecialized run.
 
The correctness argument: `reconcileEdges` is always called (§5.4.1 makes this explicit — even a compute that throws still reconciles). Any divergence between declared and actual reads is corrected there. The declared set affects ONLY how cheaply the reconciliation can run, never whether it runs correctly.
 
---
 
## 4. The conservative default
 
When the analysis cannot prove the per-branch read-set, it emits nothing. The node's `_compilerSources` field is left null. The runtime uses §5.2 dynamic collection exactly as today — no change, no regression.
 
A partial analysis result (can enumerate some branches but not all) declines the entire node. The all-or-nothing rule applies here too.
 
---
 
## 5. Interactions
 
**With the equality hook (step 3):** Independent. Equality comparison happens after the recompute produces a new value (§5.1.6 — compare new value to old under `equals`). The variant mechanism governs how source edges are collected during the run; equality governs whether observers are notified after the run. No interaction.
 
**With sync:** For a `sync(source, target, compute)` with a reactive source, the source thunk is tracked "exactly like a Derived/Effect" (§5.1). The variant mechanism applies to the source thunk identically to how it applies to a `derived` body. The target write is independent of source collection. No new interaction; the analysis reuses the same body-enumeration logic.
 
**With the §2.1 logical model:** Variants attach to a field on the logical Node — the `_compilerSources` analog from §10 row 4. They do NOT reference Link structs (`firstSource`, `lastSource`, `_walkParent`, `_walkCursor`) or any other physical layout field. The compiler accesses the node through the §10 hook point only. Physical layout is in flux from the runtime perf tuning stream; this hook never touches it.
 
**With the §10 hard rule:** Variants are an optimization hypothesis. Whether cheaper reconciliation beats dynamic collection on real workloads is unmeasured. The design is built to "provably correct, with the mechanism in place." The perf claim is a hypothesis for Claude Code benchmarking. No variant is "proven faster" from sandbox measurement.
 
---
 
## Mandatory test plan (for after design approval)
 
Per the brief, the property/fuzz test is mandatory, not optional.
 
**Property test:** Build computations with conditional reads (`cond() ? a() : b()` shaped), attach declared variant sets, drive branch-flipping writes (cond changes), assert the node still updates correctly after each flip. Specifically: the node must recompute when the newly-live dependency changes, and must NOT recompute when the now-dead dependency changes. This is §12.3 (dynamic dependency) applied to the variant mechanism.
 
**Explicit soundness test:** Feed a deliberately wrong declared set (narrower than actual reads — e.g., declare `{cond}` for `cond() ? a() : b()` where the actual reads are `{cond, a}` or `{cond, b}`). Assert the runtime still produces the correct result — proving the fallback-via-reconciliation works independently of the analysis being right.
 
**Over-correction guard:** A computation the analysis declined (returned no variant) must behave exactly as a computation that was never analyzed. No regression on §12.3.
 
---
 
## Escalation surfaces requiring architect input before I build
 
**E1 — Logical operators (`&&`, `||`, `??`):**  
These have provable branch variants (e.g., `a() && b()` → variant `{a}` when a() falsy, `{a, b}` when a() truthy). I've declined them in the design above. But they're common in real component code. If the architect wants them in scope for the prototype, I need guidance on the divergence check for the falsy-path case — specifically, how to detect that `b()` was NOT called when `a()` was falsy, so I don't flag a false divergence.
 
**E2 — "Skip tracking entirely" vs. "cheaper reconciliation":**  
I chose the conservative option: keep tracking enabled, use the declared set only for cheaper reconciliation. The more aggressive option (skip `currentObserver = node` during the run) saves more overhead but requires a different divergence mechanism — the tracking context is the only reliable way to know what was read. If the architect wants to design the aggressive path, that needs a separate soundness argument I haven't constructed here. My recommendation: start conservative, benchmark, escalate if the saving isn't large enough to justify the next step.
 
**E3 — Per-branch variants vs. union-only:**  
I've described the declared set as the UNION of all variants (overapproximation). Per-branch sets (emitting `{cond, a}` for the true branch separately from `{cond, b}` for the false branch) would let the reconciliation diff be even smaller, but they require the runtime to know at the START of a run which branch variant is active — which requires knowing the branch outcome before compute runs, which requires knowing the condition's current value. That requires the runtime to evaluate the condition before entering the tracking context, which changes the order of operations and has its own correctness questions. My recommendation: start with union-only and defer per-branch to a later pass once the mechanism is proven on real hardware.