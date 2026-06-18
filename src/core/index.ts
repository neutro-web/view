// @neutro/view/core — the fine-grained reactive runtime (DOM-free, agnostic).
// Public surface = the four primitives + helpers + ownership/scheduling utilities.
// `__test` instrumentation is intentionally NOT re-exported here (test-only).
export {
  signal,
  derived,
  effect,
  sync,
  pubsub,
  errorBoundary,
  batch,
  untrack,
  createRoot,
  onCleanup,
  flushSync,
} from './core'

export type {
  SignalAccessor,
  DerivedAccessor,
  PubSub,
  ExternalSource,
} from './core'
