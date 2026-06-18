// @neutro/view/compiler — compile-time analysis over nv source.
// sync-correctness layer (classification + write-graph cycle check) and the
// §10 specialization hooks (equality inference, branch-variant dependency sets).
export { SyncTargetClassifier } from './sync-target-classifier'
export { WriteGraphCycleChecker } from './write-graph-cycle-checker'
export { EqualityPolicyInferencer } from './equality-policy-inference'
export { BranchVariantAnalyzer } from './branch-variant-analyzer'

export type {
  ClassifierConfig,
  TargetVerdict,
  EnumResult,
  EqualityPolicy,
  EqualityPolicyVerdict,
  BranchVariantVerdict,
  CycleReport,
  SyncEdge,
  ReadEnumResult,
  SignalId,
} from './types'
