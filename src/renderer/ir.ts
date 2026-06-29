/**
 * nv Template IR — Type Definitions
 * Source of truth: nv-template-ir.md v0.4.2 (arch-approved 2026-06-22)
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
  styleArtifact?: {
    staticCss: string
    scopeHash: string
    varBindingDescs?: ReadonlyArray<{ varName: string; exprSrc: string; propertyName: string }>
  }
  classRewrites?: ReadonlyMap<string, string>
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
 * optional indexSig; returns a TemplateIR whose expressions close over those signals.
 * The renderer supplies the signals; the compiler emits references to them.
 */
export type ListBinding = BaseBinding & {
  kind: 'list'
  items: ReactiveExpr<readonly unknown[]>
  key: (item: unknown, index: number) => string | number
  /**
   * Factory called per item. Receives per-item valueSig (always) and optional indexSig.
   * Returns a TemplateIR whose expressions close over those signals.
   * See itemReadsIndex for index-elision semantics.
   */
  itemTemplate: (valueSig: WritableSignal<unknown>, indexSig?: WritableSignal<number>) => TemplateIR
  /** v0.4.3 — index-elision. true|absent ⇒ item template may read index;
   * renderer MUST allocate indexSig (conservative default). false ⇒ parser
   * proved the body never reads index; renderer MAY elide indexSig.
   * Absent defaults to the conservative (allocate) branch — preserves byte-compat
   * for any producer that does not set it, and keeps the soundness fence at the IR layer.
   */
  itemReadsIndex?: boolean
}

// SyncBinding is an external-source sync (§8.5); contributes no §8.5.2 write-graph edge.
export type SyncBinding = BaseBinding & {
  kind: 'sync'
  // signal→DOM (read direction) — like PropBinding
  propName: string
  readExpr: ReactiveExpr<unknown>
  // DOM→signal (write-back direction) — via sync() external-source path
  eventName: string
  // FIX: was `() => { set: (v) => void }` — stale vs v0.4.2 core.
  // sync() resolves the target via nodeForFn.get(target); needs the accessor itself.
  writeTarget: WritableSignal<unknown> | (() => WritableSignal<unknown>)
  transform?: (eventValue: unknown, current: unknown) => unknown
}

// ── ComponentBinding (v0.3) ───────────────────────────────────────────────────

/** Local structural type — DOM-free and core-free (per ir.ts header discipline). */
export type PropsObject = { readonly [name: string]: ReactiveExpr }
/** Child-exposed accessor thunks readable by parent-authored slot content (v0.4). */
export type SlotProps = PropsObject
/** Factory: parent-authored slot content receives child-exposed props, returns TemplateIR. */
export type SlotContent = (props: SlotProps) => TemplateIR
/** Local structural type — slot content keyed by name. */
export type SlotFns = { readonly [name: string]: SlotContent }
/** Factory the back-end calls: receives live props + slot factories, returns child TemplateIR. */
export type ComponentRef = (props: PropsObject, slots: SlotFns) => TemplateIR

export type PropEntry = { name: string; expr: ReactiveExpr }
export type SlotEntry = { name: string; content: SlotContent }

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
  /** Child-exposed accessor thunks readable by parent-authored slot content (v0.4). */
  props?: readonly PropEntry[]
  /** Child-authored default content, rendered when the slot is absent (v0.3.3). */
  fallback?: TemplateIR
}

// ── ClassListBinding (v0.4.1) ─────────────────────────────────────────────────

/**
 * A single entry in a class list binding.
 * static: always-on token (added once at setup)
 * toggle: conditionally toggled token (reactive, one effect per key or one looping effect)
 */
export type ClassListEntry =
  | { kind: 'static'; token: string }
  | { kind: 'toggle'; key: string; expr: () => unknown }

/**
 * Structured class binding: separates static tokens from reactive toggles.
 * Back-end: static entries → classList.add() once; toggle entries → effect() per key (≤6) or loop (>6).
 */
export type ClassListBinding = BaseBinding & {
  kind: 'classlist'
  entries: readonly ClassListEntry[]
}

// ── StyleVarBinding (v0.4.2) ─────────────────────────────────────────────────

// Reactive CSS custom property binding. expr() written via el.style.setProperty;
// null/undefined → removeProperty. Wired in interpreter (wireStyleVar) + emitted-mount.
export type StyleVarBinding = BaseBinding & {
  kind: 'style-var'
  /** CSS custom property name, e.g. '--nv-1a2b3c4d' */
  varName: string
  expr: ReactiveExpr<string | number | null | undefined>
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
  | ClassListBinding
  | StyleVarBinding
