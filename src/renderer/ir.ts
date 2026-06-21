/**
 * nv Template IR — Type Definitions
 * Source of truth: nv-template-ir.md v0.3.1 (arch-approved 2026-06-21)
 * Stream: (3) Renderer/templating
 *
 * These types are the contract between the two front-ends and two back-ends.
 * Do not add fields beyond what the design document specifies without an IR
 * revision. In particular: do not add DOM-specific fields here; those belong
 * in the back-end implementations.
 */

// ── Paths ─────────────────────────────────────────────────────────────────────

/**
 * Positional path from a cloned template root (DocumentFragment) to a target
 * DOM node. Each element is the 0-based childNodes index at that level.
 * Example: [0, 2] = root.childNodes[0].childNodes[2]
 */
export type NodePath = readonly number[]

// ── Source metadata ───────────────────────────────────────────────────────────

export type SourceSpan = { file: string; start: number; end: number }

// ── Expressions ───────────────────────────────────────────────────────────────

/**
 * A reactive expression: a thunk called inside an effect's tracking context.
 * Interpreter path: the thunk is a live closure capturing the component scope.
 * Compiler path: an AST node emitted as source code (back-end-specific form).
 *
 * Both forms must be observationally equivalent (same signals read, same value).
 *
 * NOTE: in the tagged-template front-end, expressions MUST be wrapped in `() =>`
 * by the caller. Passing a raw value (not a function) is a runtime error.
 */
export type ReactiveExpr<T = unknown> = () => T

/**
 * Event handler expression. May itself be reactive — the EventBinding effect
 * tracks it via the wrapper-listener pattern (§3.4 of the IR design).
 */
export type HandlerExpr<E extends Event = Event> = () => (e: E) => void

// ── Shape ─────────────────────────────────────────────────────────────────────

export type TemplateShape = {
  /**
   * Serialized static HTML. Text-binding holes have `<!--nv-N-->` comment
   * sentinels (for debugging and for the interpreter's Text node replacement).
   * Attribute-binding holes are absent (attribute not present in shape HTML).
   *
   * jsdom-vs-browser note: shape.html is produced by serializing the sentinel
   * DOM's innerHTML. jsdom uses parse5; real browsers use their platform parser.
   * For well-formed HTML with simple structure (no CDATA, no PI, no namespace
   * weirdness), parse5 and platform parsers produce identical results. This is
   * a known assumption that should be validated against a real browser when the
   * interpreter is promoted to Claude Code.
   */
  html: string
  /**
   * bindingPaths[i] is the NodePath locating the DOM node targeted by
   * bindings[i]. Paths are stable across clones of the same shape (same HTML
   * produces same tree structure, so paths remain valid).
   */
  bindingPaths: readonly NodePath[]
}

// ── IR root ───────────────────────────────────────────────────────────────────

export type TemplateMeta = {
  source?: SourceSpan
  frontEnd?: 'nv-file' | 'tagged-template'
}

export type TemplateIR = {
  /** Stable template identity (source site identifier). */
  id: string
  shape: TemplateShape
  /** Reactive/imperative holes. bindings[i] targets shape.bindingPaths[i]. */
  bindings: readonly Binding[]
  meta?: TemplateMeta
}

// ── Bindings ──────────────────────────────────────────────────────────────────

export type BaseBinding = {
  /** Index into shape.bindingPaths — which DOM node this binding targets. */
  pathIndex: number
  meta?: { source?: SourceSpan }
}

// ── PoC scope ─────────────────────────────────────────────────────────────────

/** Updates a Text node's content reactively. Back-end: one effect per binding. */
export type TextBinding = BaseBinding & {
  kind: 'text'
  expr: ReactiveExpr<string | number | boolean | null | undefined>
}

/** Updates an HTML attribute reactively. Back-end: one effect per binding. */
export type AttrBinding = BaseBinding & {
  kind: 'attr'
  name: string
  expr: ReactiveExpr<string | number | boolean | null | undefined>
}

/** Sets a DOM property directly. Back-end: one effect per binding. */
export type PropBinding = BaseBinding & {
  kind: 'prop'
  name: string
  expr: ReactiveExpr<unknown>
}

/**
 * Registers an event listener. Handler may be reactive (wrapper-effect pattern).
 * Back-end: wrapper-listener + effect that tracks the handler expression.
 *
 * handlerKind discriminant: v0 always emits 'reactive' and always uses the
 * wrapper-effect. The 'stable' skip-the-effect optimization is a performance
 * hypothesis deferred to benchmark validation (§10 hard rule, matching the
 * equality-policy inference precedent).
 */
export type EventBinding = BaseBinding & {
  kind: 'event'
  eventName: string
  handler: HandlerExpr
  handlerKind: 'stable' | 'reactive' // v0: always emit 'reactive'
  options?: AddEventListenerOptions
}

/**
 * Dynamic content hole for reactive values. Targets an anchor Comment node;
 * content is inserted before the anchor.
 *
 * v0 scope: primitive values (string|number|null|undefined) → single Text node.
 * DOM Node / TemplateIR values: designed, deferred.
 */
export type ChildBinding = BaseBinding & {
  kind: 'child'
  expr: ReactiveExpr<string | number | null | undefined>
  // v0: primitive-only. DOM Node / TemplateIR values: designed, deferred.
}

/** Structural if/else form. Mounts/unmounts branch templates reactively. */
export type ConditionalBinding = BaseBinding & {
  kind: 'conditional'
  condition: ReactiveExpr<boolean>
  consequent: TemplateIR
  alternate: TemplateIR | null
}

// ── Designed, now in scope ────────────────────────────────────────────────────

/**
 * Minimal writable-signal interface. Structurally compatible with core's
 * SignalAccessor<T>; defined here so the IR stays DOM-free and core-free.
 */
export interface WritableSignal<T> {
  (): T
  set(v: T): void
}

/**
 * Keyed list reconciliation. One reconcile effect + per-item createRoot (§6).
 * itemTemplate is a factory called per item: receives per-item valueSig and
 * indexSig; returns a TemplateIR whose expressions close over those signals.
 * The renderer supplies the signals; the compiler emits references to them.
 */
export type ListBinding = BaseBinding & {
  kind: 'list'
  items: ReactiveExpr<readonly unknown[]>
  key: (item: unknown, index: number) => string | number
  itemTemplate: (valueSig: WritableSignal<unknown>, indexSig: WritableSignal<number>) => TemplateIR
}

/**
 * Two-way binding: signal→DOM (read) + DOM event→signal (write-back via sync).
 * DESIGNED, NOT IN PoC SCOPE.
 *
 * writeTargetId: agreed deferred field (compiler path only).
 * Must use same signalSymbolId derivation as compiler steps 1–2/4 so the
 * §8.5.2 write-graph cycle check can connect the renderer's write-back edge.
 */
export type SyncBinding = BaseBinding & {
  kind: 'sync'
  propName: string
  readExpr: ReactiveExpr<unknown>
  eventName: string
  writeTarget: () => { set: (v: unknown) => void }
  writeTargetId?: string // SignalId — compiler path only; build when SyncBinding is scoped
  transform?: (eventValue: unknown, current: unknown) => unknown
}

// ── ComponentBinding (v0.3) ───────────────────────────────────────────────────

/** Local structural type — DOM-free and core-free (per ir.ts header discipline). */
export type PropsObject = { readonly [name: string]: ReactiveExpr }
/** Local structural type — slot content keyed by name. */
export type SlotFns = { readonly [name: string]: TemplateIR }
/** Factory the back-end calls: receives live props + slot IRs, returns child TemplateIR. */
export type ComponentRef = (props: PropsObject, slots: SlotFns) => TemplateIR

export type PropEntry = { name: string; expr: ReactiveExpr }
export type SlotEntry = { name: string; content: TemplateIR }

export type ComponentBinding = BaseBinding & {
  kind: 'component'
  component: ComponentRef
  props: readonly PropEntry[]
  propNames: readonly string[]
  slots: readonly SlotEntry[]
}

// ── SlotOutletBinding (v0.3.1) ─────────────────────────────────────────────

/**
 * Marks where a named slot's content is inserted.
 * Targets a Comment anchor (same family as conditional/component).
 * NO expr — slot content is not tracked reactively; it is owned parent-lexically (D-slot-1).
 * name: the slot name to resolve from slotsObj passed to the child factory.
 */
export type SlotOutletBinding = BaseBinding & {
  kind: 'slot-outlet'
  name: string
}

export type Binding =
  | TextBinding
  | AttrBinding
  | PropBinding
  | EventBinding
  | ChildBinding
  | ConditionalBinding
  | ListBinding
  | SyncBinding
  | ComponentBinding
  | SlotOutletBinding
