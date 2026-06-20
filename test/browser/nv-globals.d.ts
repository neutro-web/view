/**
 * Type declarations for window.__nv (the browser-gate bundle).
 * Keeps page.evaluate() calls type-safe.
 */

import type { EmitResult } from '../../src/compiler/emitted-mount.js'
import type { DerivedAccessor, SignalAccessor } from '../../src/core/core.js'
import type { Owner } from '../../src/core/core.js'
import type { CompareResult } from '../../src/renderer/comparator.js'
import type { TemplateIR } from '../../src/renderer/ir.js'

interface NvBundle {
  signal: <T>(init: T) => SignalAccessor<T>
  derived: <T>(fn: () => T) => DerivedAccessor<T>
  effect: (fn: () => void) => () => void
  flushSync: () => void
  createRoot: <T>(fn: (dispose: () => void) => T) => T
  errorBoundary: (handler: (e: unknown) => void, fn: () => void) => void
  mount: (ir: TemplateIR, parent: Element, doc: Document) => () => void
  createHtmlTag: (
    doc: Document,
  ) => (strings: TemplateStringsArray, ...exprs: unknown[]) => TemplateIR
  structurallyEqual: (a: Node, b: Node) => CompareResult
  emitMount: (ir: TemplateIR) => EmitResult
}

declare global {
  interface Window {
    __nv: NvBundle
  }
}
