/**
 * nv Compiler Back-End Phase 2: Equality Hook Emission (step-3 only)
 * Stream:   (2) compiler / (3) renderer seam
 * Spec:     Soundness Design 2026-06-19
 * Builds on: Phase 1b (emitMount), step-3 EqualityPolicyInference analysis
 *
 * Applies setCompilerEquals(fn, false) for FALSE-policy signal/derived sites.
 *
 * Phase 2 is NOT an extension of emitMount. emitMount handles template wiring
 * (binding effects → DOM). Phase 2 hooks attach to signal/derived CONSTRUCTION
 * SITES in component code, BEFORE the template mounts:
 *
 *   // In emitted component code:
 *   const count = signal(0)
 *   // Phase 2 skips: OBJECT_IS is a no-op (§2 decision)
 *   const items = signal([])
 *   __core.setCompilerEquals(items, false)  // Phase 2 emits this
 *   const { mountFn } = emitMount(ir)       // Phase 1b
 *   mountFn(parent, doc)
 *
 * Emission rules (§2):
 *   FALSE     → emit setCompilerEquals(fn, false) — the only behavior-changing case
 *   OBJECT_IS → SKIP. No-op by construction (replaces Object.is with Object.is),
 *               AND writes a field that transitions the node's hidden class, adding
 *               HC perturbation cost for zero benefit (step-3 integration finding,
 *               2026-06-19). Minimizing setter calls to sites that matter.
 *   DECLINE   → SKIP. No annotation → runtime default (Object.is) applies.
 *
 * Soundness (§3):
 *   The runtime setter already guards against explicit-user-equals displacement
 *   (nodesWithUserEquals guard in core.ts). But emission should not even occur for
 *   those sites — the step-3 analysis already DECLINEs explicit-equals sites, so
 *   no FALSE verdict is produced for them. Belt-and-suspenders.
 *
 * Step-4 not emitted (§1 decision — shelved, net-negative on all measured workloads).
 * Phase 2b (step-4 emission) is gated on that shelve being reopened.
 */

/** The equality policies from step-3 inference (matches EqualityPolicy in compiler/types.ts) */
export type EqualityPolicy = 'OBJECT_IS' | 'FALSE' | 'DECLINE'

/**
 * Apply Phase 2 equality hook emission for one signal/derived site.
 *
 * In production, the compiler GENERATES this call right after the signal/derived
 * construction in the emitted component code. In the sandbox, the test calls this
 * directly to simulate the emission and prove the behavioral guarantee.
 *
 * @param fn               The signal/derived accessor function (result of the construction).
 * @param policy           The step-3 inferred policy for this site.
 * @param setCompilerEquals The runtime setter (from __test surface or production equivalent).
 */
export function emitEqualityHook(
  fn: object,
  policy: EqualityPolicy,
  setCompilerEquals: (fn: object, eq: ((a: unknown, b: unknown) => boolean) | false) => void,
): void {
  if (policy === 'FALSE') {
    setCompilerEquals(fn, false)
    return
  }
  // OBJECT_IS: skip — no-op + HC perturbation cost (§2 decision).
  // DECLINE: skip — no annotation, runtime default (Object.is) applies.
}

/**
 * Apply Phase 2 equality hook emission for a batch of signal/derived sites.
 *
 * @param sites  Map from signal/derived accessor function → inferred policy.
 *               Built from EqualityPolicyVerdict[] (step-3 output):
 *               `new Map(verdicts.map(v => [runtimeFn, v.policy]))`
 * @param setCompilerEquals  Runtime setter.
 */
export function emitEqualityHooks(
  sites: ReadonlyMap<object, EqualityPolicy>,
  setCompilerEquals: (fn: object, eq: ((a: unknown, b: unknown) => boolean) | false) => void,
): void {
  for (const [fn, policy] of sites) {
    emitEqualityHook(fn, policy, setCompilerEquals)
  }
}
