// @neutro/view/compiler — compile-time analysis over nv source.
// sync-correctness layer (classification + write-graph cycle check) and the
// §10 specialization hooks (equality inference, branch-variant dependency sets).
export { SyncTargetClassifier } from './sync-target-classifier.js'
export { WriteGraphCycleChecker } from './write-graph-cycle-checker.js'
export { EqualityPolicyInferencer } from './equality-policy-inference.js'
export { BranchVariantAnalyzer } from './branch-variant-analyzer.js'
export { ReadWriteErasureAnalyzer } from './read-write-erasure-analyzer.js'
export { emitMount } from './emitted-mount.js'
export type { EmitResult } from './emitted-mount.js'

export type {
  ClassifierConfig,
  TargetVerdict,
  EqualityPolicy,
  EqualityPolicyVerdict,
  BranchVariantVerdict,
  CycleReport,
  SyncEdge,
  ReadEnumResult,
  SignalId,
  BindingErasureVerdict,
  TemplateErasureResult,
} from './types.js'
