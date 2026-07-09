/**
 * Type declarations for window.__nv (the browser-gate bundle).
 * Keeps page.evaluate() calls type-safe.
 */

import type { EmitResult } from '../../src/compiler/emitted-mount.js'
import type { DerivedAccessor, SignalAccessor } from '../../src/core/core.js'
import type { Owner } from '../../src/core/core.js'
import type { CompareResult } from '../../src/renderer/comparator.js'
import type { EachSentinel, MatchSentinel } from '../../src/renderer/html-tag.js'
import type { SlotContent, TemplateIR } from '../../src/renderer/ir.js'
import type { Resource } from '../../src/renderer/resource.js'

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
  match: (
    branches: readonly { when: () => boolean; body: () => TemplateIR }[],
    fallback?: (() => TemplateIR) | null,
    pending?: () => boolean,
  ) => MatchSentinel
  resource: <S, T>(
    source: () => S,
    fetcher: (s: S, info: { signal: AbortSignal }) => Promise<T>,
  ) => Resource<T>
  each: (
    items: () => readonly unknown[],
    key: (item: unknown, i: number) => string | number,
    factory: SlotContent,
  ) => EachSentinel
  structurallyEqual: (a: Node, b: Node) => CompareResult
  emitMount: (ir: TemplateIR) => EmitResult
  injectComponentStyle: (doc: Document, identityHash: string, cssText: string) => void
  getStyleRegistry: (doc: Document) => Map<string, unknown> | undefined
}

declare global {
  interface Window {
    __nv: NvBundle
  }
}
