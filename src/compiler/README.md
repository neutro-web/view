# @neutro/view/compiler

Compile-time analysis over nv source. The compiler may only **skip provable work** —
misclassification costs performance, never correctness (a soundness fallback always
applies).

## Passes

**`sync`-correctness layer**
- `SyncTargetClassifier` — classifies each `sync` target ACCEPT / REJECT / UNDECIDABLE
  (nominal nv-signal detection; enumerable element-access resolves).
- `WriteGraphCycleChecker` — builds the global write-graph and returns structured
  `CycleReport[]` (throwing/severity left to a reporting layer).

**§10 specialization hooks**
- `EqualityPolicyInferencer` — per-node `equals` from static type (primitives →
  `Object.is`; std-lib mutable containers → `false`; unprovable → decline). Never
  overrides an explicit user `equals`.
- `BranchVariantAnalyzer` — proves the union of reactive reads across branches; the
  declared union is an expected-reads *oracle* for cheaper reconciliation, never a
  replacement for tracking (so a wrong union costs work, never correctness).

## Standing rule

Every specialization is built "provably correct, with the mechanism in place." Whether
a specialization *beats the unspecialized baseline* is a benchmark question — validated
on real hardware, not asserted from a sandbox number.
