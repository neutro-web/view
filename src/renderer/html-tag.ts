/**
 * nv Tagged-Template Front-End
 * Stream: (3) Renderer/templating
 * IR contract: nv-template-ir.md v0.3.1
 *
 * Produces a TemplateIR from a tagged template literal. Handles TextBinding
 * and AttrBinding for the PoC slice. Other binding kinds are added as the
 * interpreter increments grow.
 *
 * Usage:
 *   const html = createHtmlTag(document)
 *   const ir = html`<span class="${() => cls()}">${() => count()}</span>`
 *
 * All expression holes MUST be wrapped in `() => ...` (thunks). Passing a
 * raw value (not a function) throws at template construction time.
 *
 * Front-end equivalence invariant (IR §6.1): this front-end and the .nv file
 * front-end must produce structurally identical TemplateIRs for semantically
 * equivalent templates. Source span metadata (meta.source) is excluded from
 * equivalence — it is diagnostic only.
 *
 * jsdom-vs-browser note: template element + innerHTML parsing is the standard
 * mechanism in all major browsers. jsdom uses parse5 as its HTML parser; real
 * browsers use their platform parsers. For the simple, well-formed templates
 * expected in this PoC, parse5 and platform parsers produce identical DOM trees.
 * Flag if you encounter a case where they diverge — do not silently code to
 * the jsdom behavior.
 */

import type {
  AttrBinding,
  Binding,
  ClassListBinding,
  ComponentBinding,
  ConditionalBinding,
  EventBinding,
  HandlerExpr,
  ListBinding,
  NodePath,
  PropBinding,
  PropEntry,
  ReactiveExpr,
  RecycledListBinding,
  SlotContent,
  SlotEntry,
  SlotOutletBinding,
  SyncBinding,
  TemplateIR,
  TemplateShape,
  TextBinding,
  WritableSignal,
} from './ir.js'

// ── Sentinel kind alternation ─────────────────────────────────────────────────

/** Complete set of nv sentinel attribute kinds — used in sentinel-strip regexes. */
const NV_SENTINEL_KINDS = '(?:attr|prop|sync|event|component)'

// ── Slot outlet sentinel (B2 fix) ─────────────────────────────────────────────

/** Opaque sentinel returned by `slots(name)` — the tagged-template outlet form. */
export interface SlotSentinel {
  readonly __nvSlotOutlet: string
  readonly __nvFallback?: TemplateIR
  readonly __nvProps?: readonly PropEntry[]
}

type SlotsOpts = { fallback?: TemplateIR } & {
  [propName: string]: ReactiveExpr | TemplateIR | undefined
}

/**
 * Create a slot outlet sentinel for the tagged-template side.
 * Write `${slots('header')}` where the child component renders the named slot.
 * Mirrors `.nv`'s `{slots.header}` bare-read; both produce `SlotOutletBinding`.
 * An optional `fallback` TemplateIR renders when the slot is absent (increment 1).
 * Additional non-`fallback` function values become slot props (scoped slots).
 */
export function slots(name: string, opts?: SlotsOpts): SlotSentinel {
  const propEntries: PropEntry[] = []
  if (opts) {
    for (const [key, val] of Object.entries(opts)) {
      if (key === 'fallback') continue
      if (typeof val === 'function') {
        propEntries.push({ name: key, expr: val as ReactiveExpr })
      }
    }
  }
  return {
    __nvSlotOutlet: name,
    ...(opts?.fallback !== undefined && { __nvFallback: opts.fallback }),
    ...(propEntries.length > 0 && { __nvProps: propEntries }),
  }
}

// ── Slot fill sentinel ────────────────────────────────────────────────────────

/** Opaque sentinel returned by `slot(name, factory)` — the tagged-template scoped fill form. */
export interface SlotFillSentinel {
  readonly __nvSlotFill: string
  readonly factory: SlotContent
}

function isSlotFillSentinel(v: unknown): v is SlotFillSentinel {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).__nvSlotFill === 'string' &&
    typeof (v as Record<string, unknown>).factory === 'function'
  )
}

/**
 * Create a scoped-slot fill for the tagged-template parent side.
 * Write `${slot('row', ({ item, index }) => html`...`)}` inside a component hole.
 * The factory receives the child-exposed SlotProps and returns the slot content IR.
 * Mirrors `.nv`'s `<slot name="row" let={item, index}>...</slot>`.
 */
export function slot(name: string, factory: SlotContent): SlotFillSentinel {
  return { __nvSlotFill: name, factory }
}

// ── Classes sentinel ──────────────────────────────────────────────────────────

/** Opaque sentinel returned by `classes(...)` — carries structured class entries. */
export interface ClassesSentinel {
  readonly __nvClasses: true
  readonly entries: ReadonlyArray<
    { kind: 'static'; token: string } | { kind: 'toggle'; key: string; expr: () => unknown }
  >
}

function isClassesSentinel(v: unknown): v is ClassesSentinel {
  return typeof v === 'object' && v !== null && (v as ClassesSentinel).__nvClasses === true
}

/**
 * Build a ClassesSentinel from a mix of strings, object toggle-maps, arrays, or falsy values.
 *
 * - String args: split on whitespace → static entries
 * - Object args: each key (split on whitespace for multi-token) → toggle entry; value must be `() => boolean`
 * - Array args: recursively process each element (same rules as above)
 * - Falsy args (null, undefined, false): skipped
 *
 * Usage inside html``:
 *   html`<div class="${classes('btn', { active: () => isActive() })}">`
 */
export function classes(
  ...args: Array<
    | string
    | Record<string, () => unknown>
    | Array<string | Record<string, () => unknown>>
    | null
    | undefined
    | false
  >
): ClassesSentinel {
  const entries: Array<
    { kind: 'static'; token: string } | { kind: 'toggle'; key: string; expr: () => unknown }
  > = []

  function processArg(
    arg:
      | string
      | Record<string, () => unknown>
      | Array<string | Record<string, () => unknown>>
      | null
      | undefined
      | false,
  ): void {
    if (!arg) return
    if (typeof arg === 'string') {
      for (const token of arg.split(/\s+/).filter(Boolean)) {
        entries.push({ kind: 'static', token })
      }
    } else if (Array.isArray(arg)) {
      for (const element of arg) {
        processArg(element)
      }
    } else {
      for (const [key, expr] of Object.entries(arg)) {
        if (!expr) continue
        for (const token of key.split(/\s+/).filter(Boolean)) {
          entries.push({ kind: 'toggle', key: token, expr })
        }
      }
    }
  }

  for (const arg of args) {
    processArg(arg)
  }

  return { __nvClasses: true, entries }
}

// ── Each sentinel ─────────────────────────────────────────────────────────────

/** Opaque sentinel returned by `each(items, key, factory)` — the tagged-template list form. */
export interface EachSentinel {
  readonly __nvEach: true
  readonly items: () => readonly unknown[]
  readonly key: (item: unknown, i: number) => string | number
  readonly factory: SlotContent
}

function isEachSentinel(v: unknown): v is EachSentinel {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as Record<string, unknown>).__nvEach === true &&
    typeof (v as EachSentinel).items === 'function' &&
    typeof (v as EachSentinel).key === 'function' &&
    typeof (v as EachSentinel).factory === 'function'
  )
}

/**
 * Create an each-list sentinel for the tagged-template side.
 * Write `${each(() => items(), key, ({ item, index }) => html`...`)}` for a keyed list.
 */
export function each(
  items: () => readonly unknown[],
  key: (item: unknown, i: number) => string | number,
  factory: SlotContent,
): EachSentinel {
  return { __nvEach: true, items, key, factory }
}

// ── Conditional sentinel ──────────────────────────────────────────────────────

/** Opaque sentinel returned by `iff(condition, consequent, alternate)` — the tagged-template if/else form. */
export interface ConditionalSentinel {
  readonly __nvConditional: true
  readonly condition: () => boolean
  readonly consequent: () => TemplateIR
  readonly alternate: (() => TemplateIR) | null
}

function isConditionalSentinel(v: unknown): v is ConditionalSentinel {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as Record<string, unknown>).__nvConditional === true &&
    typeof (v as ConditionalSentinel).condition === 'function' &&
    typeof (v as ConditionalSentinel).consequent === 'function' &&
    ((v as ConditionalSentinel).alternate === null ||
      typeof (v as ConditionalSentinel).alternate === 'function')
  )
}

/**
 * Create a conditional (if/else) sentinel for the tagged-template side.
 * Write `${iff(() => cond(), () => html\`<p>yes</p>\`, () => html\`<p>no</p>\`)}` for a reactive
 * structural if/else. Both branches MUST be thunks — a raw ternary is evaluated before `html()`
 * ever sees it, so it cannot be detected as conditional; wrapping preserves reactivity.
 * Mirrors `.nv`'s ternary-with-html-branches form; both produce `ConditionalBinding`.
 */
export function iff(
  condition: () => boolean,
  consequent: () => TemplateIR,
  alternate?: (() => TemplateIR) | null,
): ConditionalSentinel {
  return { __nvConditional: true, condition, consequent, alternate: alternate ?? null }
}

// ── Recycled-list sentinel ─────────────────────────────────────────────────────

/**
 * Opaque sentinel returned by `recycle(items, factory)` — the tagged-template
 * recycled-list form (position identity, NOT keyed identity — no `key`, unlike
 * `each()`). Mirrors `.nv`'s `<recycle>`; both produce `RecycledListBinding`.
 */
export interface RecycledSentinel {
  readonly __nvRecycled: true
  readonly items: () => readonly unknown[]
  readonly factory: (item: () => unknown, index: () => number) => TemplateIR
}

function isRecycledSentinel(v: unknown): v is RecycledSentinel {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as Record<string, unknown>).__nvRecycled === true &&
    typeof (v as RecycledSentinel).items === 'function' &&
    typeof (v as RecycledSentinel).factory === 'function'
  )
}

/**
 * Create a recycled-list sentinel for the tagged-template side.
 * Write `${recycle(() => items(), (item, index) => html`...`)}` for a
 * position-identity list — rows are reused by slot position, not by data
 * identity. No `key` parameter (contrast `each()`, which is keyed). Use only
 * for rows whose entire visible state derives from `item()`.
 */
export function recycle(
  items: () => readonly unknown[],
  factory: (item: () => unknown, index: () => number) => TemplateIR,
): RecycledSentinel {
  return { __nvRecycled: true, items, factory }
}

// ── Class name builder ────────────────────────────────────────────────────────

/**
 * Pure class-string builder: concatenates truthy class tokens, space-joined.
 *
 * Args are: string | Record<string, unknown> | Array<...> | null | undefined | false | 0
 * - Strings: include if non-empty
 * - Objects: include each key whose value is truthy
 * - Arrays: recurse (flatten/process each element)
 * - Falsy (null, undefined, false, 0, ''): skip entirely
 *
 * Returns a single space-joined string of truthy tokens.
 *
 * Usage:
 *   cx('btn', { primary: true, disabled: false }) // 'btn primary'
 *   cx('a', ['b', { c: true }]) // 'a b c'
 *   cx({ active: true }, null, false, undefined) // 'active'
 */
type CxArg = string | Record<string, unknown> | CxArg[] | null | undefined | false | 0

export function cx(...args: CxArg[]): string {
  const tokens: string[] = []

  for (const arg of args) {
    if (arg === null || arg === undefined || arg === false || arg === 0 || arg === '') {
      continue
    }
    if (typeof arg === 'string') {
      if (arg.length > 0) {
        tokens.push(arg)
      }
    } else if (Array.isArray(arg)) {
      // Recurse into arrays
      const nested = cx(...(arg as CxArg[]))
      if (nested.length > 0) {
        tokens.push(nested)
      }
    } else if (typeof arg === 'object') {
      // Record: include keys whose values are truthy
      for (const [key, value] of Object.entries(arg)) {
        if (value) {
          tokens.push(key)
        }
      }
    }
  }

  return tokens.join(' ')
}

// ── Binding-kind exhaustiveness guard ─────────────────────────────────────────

/**
 * Compile-time (and light runtime) forcing function: every `Binding['kind']`
 * must be represented here. If ir.ts's `Binding` union gains a new kind, the
 * `default` branch below narrows to `never` and `tsc` fails at THIS site —
 * mirroring emitted-mount.ts's switch + default-never-guard idiom (see
 * emitSetup's `switch (binding.kind)` there).
 *
 * The tagged-template front-end (html-tag.ts) can't funnel all binding
 * construction through one switch — kinds are resolved incrementally across
 * several independent detection paths (classifyHole/buildHtmlHoleBinding for
 * text/attr/prop/event/sync/classlist/slot-outlet; walkNodeList's sentinel
 * detection for list/conditional/recycled-list/component). This function is
 * the single point where every resolved kind is funneled through the
 * completeness check, called from each construction site below.
 */
function assertAllBindingKindsHandled(kind: Binding['kind']): void {
  switch (kind) {
    case 'text': // buildHtmlHoleBinding: classifyHole 'text' branch (incl. isSlotSentinel handled below)
    case 'attr': // buildHtmlHoleBinding: 'attr' branch (class + classes() routes to 'classlist' instead)
    case 'prop': // buildHtmlHoleBinding: 'prop' branch (.propName= hole)
    case 'event': // buildHtmlHoleBinding: fallthrough default branch (@eventName= hole)
    case 'sync': // buildHtmlHoleBinding: 'sync' branch (:propName= hole)
    case 'classlist': // buildHtmlHoleBinding: attr branch + isClassesSentinel(origExpr)
    case 'slot-outlet': // buildHtmlHoleBinding: text branch + isSlotSentinel(origExpr), via slots()
    case 'list': // each() sentinel — walkNodeList detection, wired in html()/buildSlotContentIR
    case 'conditional': // iff() sentinel — walkNodeList detection, wired in html()/buildSlotContentIR
    case 'recycled-list': // recycle() sentinel — buildRecycledListBinding, wired in html()/buildSlotContentIR
    case 'component': // data-nv-component element — makeUnresolvedComponentBinding
      break
    case 'child':
      // Deferred — manual IR only (v0 primitive-only), both front-ends symmetric.
      // See ir.ts ChildBinding doc comment.
      break
    case 'style-var':
      // .nv-only by design — $style compile-time feature, no tagged-template form.
      // See docs/design/ir-frontend-parity-audit.md.
      break
    default: {
      const exhaustive: never = kind
      throw new Error(`[nv/html] Unhandled Binding kind: ${exhaustive as string}`)
    }
  }
}

function isSlotSentinel(v: unknown): v is SlotSentinel {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).__nvSlotOutlet === 'string'
  )
}

// ── Hole classification ───────────────────────────────────────────────────────

type HoleKind =
  | { kind: 'text' }
  | { kind: 'attr'; name: string }
  | { kind: 'event'; name: string }
  | { kind: 'prop'; name: string }
  | { kind: 'sync'; name: string }

/** Slot-walk hole info — tracks kind + origIdx so the shared walk can use buildHtmlHoleBinding. */
type SlotHoleInfo =
  | { kind: 'text'; origIdx: number }
  | { kind: 'attr'; origIdx: number; name: string }
  | { kind: 'prop'; origIdx: number; name: string }
  | { kind: 'event'; origIdx: number; name: string }
  | { kind: 'sync'; origIdx: number; name: string }

/**
 * Determine the binding kind for the hole between strings[i] and strings[i+1].
 *
 * Attribute value position: strings[i] ends with `attrName="` (or single-quote
 * variant), AND strings[i+1] begins with the matching closing quote.
 * Text/content position: everything else.
 *
 * Scope: PoC handles pure-attribute-value holes (the entire attribute value is
 * the expression) and text-content holes. Mixed-static-dynamic within one
 * attribute value (e.g. class="prefix ${expr}") is not supported in v0 — the
 * regex will not match and the hole falls through to text classification,
 * producing incorrect output. Add support when required.
 */
function classifyHole(prevString: string, nextString: string): HoleKind {
  const closingQuote = nextString.startsWith('"') || nextString.startsWith("'")
  // Event hole: @eventName="
  const evtMatch = prevString.match(/\s@([\w:-]+)=["']$/)
  if (evtMatch !== null && closingQuote) {
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
    return { kind: 'event', name: evtMatch[1]! }
  }
  // Prop hole: .propName="
  const propMatch = prevString.match(/\s\.([\w:-]+)=["']$/)
  if (propMatch !== null && closingQuote) {
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
    return { kind: 'prop', name: propMatch[1]! }
  }
  // Sync hole: :propName=" — MUST precede bare-attr ([\w:-]+ matches colons)
  const syncMatch = prevString.match(/\s:([\w-]+)=["']$/)
  if (syncMatch !== null && closingQuote) {
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
    return { kind: 'sync', name: syncMatch[1]! }
  }
  // Attr hole: attrName="
  const m = prevString.match(/\s([\w:-]+)=["']$/)
  if (m !== null && closingQuote) {
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
    return { kind: 'attr', name: m[1]! }
  }
  return { kind: 'text' }
}

/** Per-prop default DOM event for sync bindings (tagged-template path). */
function defaultHtmlEventForProp(prop: string): string {
  if (prop === 'checked') return 'change'
  return 'input'
}

// ── Shared per-hole binding constructor ───────────────────────────────────────

/**
 * Build one Binding from a classified hole. Used by BOTH the main hole loop
 * and the slot content builder so the two cannot produce divergent kinds.
 */
function buildHtmlHoleBinding(holeKind: HoleKind, pathIndex: number, origExpr: unknown): Binding {
  const b = buildHtmlHoleBindingImpl(holeKind, pathIndex, origExpr)
  assertAllBindingKindsHandled(b.kind)
  return b
}

function buildHtmlHoleBindingImpl(
  holeKind: HoleKind,
  pathIndex: number,
  origExpr: unknown,
): Binding {
  type PrimitiveExpr = ReactiveExpr<string | number | boolean | null | undefined>
  const expr = origExpr as PrimitiveExpr
  if (holeKind.kind === 'text') {
    if (isSlotSentinel(origExpr)) {
      const b: SlotOutletBinding = {
        kind: 'slot-outlet',
        pathIndex,
        name: origExpr.__nvSlotOutlet,
        ...(origExpr.__nvFallback !== undefined && { fallback: origExpr.__nvFallback }),
        ...(origExpr.__nvProps !== undefined &&
          origExpr.__nvProps.length > 0 && { props: origExpr.__nvProps }),
      }
      return b
    }
    const b: TextBinding = { kind: 'text', pathIndex, expr }
    return b
  }
  if (holeKind.kind === 'attr') {
    if (holeKind.name === 'class' && isClassesSentinel(origExpr)) {
      return {
        kind: 'classlist',
        pathIndex,
        entries: (origExpr as ClassesSentinel).entries,
      } satisfies ClassListBinding
    }
    // existing AttrBinding path unchanged
    const b: AttrBinding = { kind: 'attr', pathIndex, name: holeKind.name, expr }
    return b
  }
  if (holeKind.kind === 'prop') {
    const b: PropBinding = { kind: 'prop', pathIndex, name: holeKind.name, expr }
    return b
  }
  if (holeKind.kind === 'sync') {
    // Conditional-target form (:value="${() => cond ? a : b}") is deferred (small debt).
    // The interpreter handles it natively via sync's thunk resolution (core.ts:1075-1077).
    // The read direction for a conditional thunk is non-trivial to derive in the tagged path.
    // Single-accessor form (`:value="${val}"`) covers the primary use case.
    const accessor = origExpr as WritableSignal<unknown>
    const b: SyncBinding = {
      kind: 'sync',
      pathIndex,
      propName: holeKind.name,
      readExpr: () => accessor(),
      eventName: defaultHtmlEventForProp(holeKind.name),
      writeTarget: accessor,
    }
    return b
  }
  // event
  const b: EventBinding = {
    kind: 'event',
    pathIndex,
    eventName: holeKind.name,
    handler: expr as unknown as HandlerExpr,
    handlerKind: 'reactive',
  }
  return b
}

// ── DOM path utilities ────────────────────────────────────────────────────────

/**
 * Compute the NodePath from `root` to `node` by walking parentNode links and
 * recording childNodes indices. Returns [] if node === root.
 */
function computePath(node: Node, root: Node): NodePath {
  const path: number[] = []
  let current: Node = node
  while (current !== root) {
    const parent = current.parentNode
    if (parent === null) {
      throw new Error('[nv/html] Node is not a descendant of root — cannot compute path')
    }
    // Find index in parent.childNodes
    let index = 0
    let sibling: ChildNode | null = parent.firstChild
    while (sibling !== null && sibling !== current) {
      index++
      sibling = sibling.nextSibling
    }
    path.unshift(index)
    current = parent
  }
  return path
}

// ── Shared node-list walk (GATE-2 collapse) ───────────────────────────────────

/** A list anchor discovered during the walk — the hole's expr was an EachSentinel. */
interface WalkedList {
  anchorPath: NodePath
  origIdx: number
  sentinel: EachSentinel
}

/** A conditional anchor discovered during the walk — the hole's expr was a ConditionalSentinel. */
interface WalkedConditional {
  anchorPath: NodePath
  origIdx: number
  sentinel: ConditionalSentinel
}

/** A recycled-list anchor discovered during the walk — the hole's expr was a RecycledSentinel. */
interface WalkedRecycled {
  anchorPath: NodePath
  origIdx: number
  sentinel: RecycledSentinel
}

/**
 * A component element discovered during the walk, with its anchor path (relative
 * to the walk root) and captured slot content. Recorded by walkNodeList; each
 * call site assembles it into a ComponentBinding per its path-index convention.
 */
interface WalkedComponent {
  anchorPath: NodePath
  tagName: string
  props: PropEntry[]
  propNames: string[]
  slots: SlotEntry[]
}

/**
 * Result of walking a list of DOM nodes (the full top-level fragment OR a slot's
 * subtree). The SAME walk drives both — the GATE-2 collapse removed the bespoke
 * slot sub-walker, so component-as-slot-child falls out for free.
 *
 * - `holeInfos` / `holePaths` are index-aligned, in encounter order (compact).
 * - `components` records each component element (anchor + captured slots).
 * - `consumed` is the set of GLOBAL hole indices consumed by component elements
 *   (their reactive prop holes and any holes inside their slot content).
 */
interface WalkResult {
  holeInfos: SlotHoleInfo[]
  holePaths: NodePath[]
  components: WalkedComponent[]
  consumed: Set<number>
  lists: WalkedList[]
  conditionals: WalkedConditional[]
  recycledLists: WalkedRecycled[]
}

/**
 * Walk a list of DOM nodes for sentinels, relative to `root` (used for path
 * computation). Detects:
 *   - <!--nv-N--> text holes,
 *   - data-nv-{attr,prop,event}-N sentinels on elements,
 *   - data-nv-component elements (capturing their props + slot content recursively).
 *
 * This is the single walk shared by the top-level template and slot content.
 * Hole indices in the returned infos are GLOBAL (origIdx into `exprs`); call
 * sites map them to compact or global path-indices as they require.
 */
function walkNodeList(nodes: Node[], exprs: unknown[], root: Node, doc: Document): WalkResult {
  const holeInfos: SlotHoleInfo[] = []
  const holePaths: NodePath[] = []
  const components: WalkedComponent[] = []
  const consumed = new Set<number>()
  const lists: WalkedList[] = []
  const conditionals: WalkedConditional[] = []
  const recycledLists: WalkedRecycled[] = []

  function walk(node: Node): void {
    if (node.nodeType === 8 /* COMMENT_NODE */) {
      const m = (node as Comment).data.match(/^nv-(\d+)$/)
      if (m !== null) {
        // biome-ignore lint/style/noNonNullAssertion: regex match guarantees group
        const idx = Number.parseInt(m[1]!, 10)
        if (isEachSentinel(exprs[idx])) {
          // Each sentinel: the comment IS the list anchor — record path, skip text-hole.
          lists.push({
            anchorPath: computePath(node, root),
            origIdx: idx,
            sentinel: exprs[idx] as EachSentinel,
          })
          consumed.add(idx)
        } else if (isConditionalSentinel(exprs[idx])) {
          // Conditional sentinel: the comment IS the conditional anchor — record path, skip text-hole.
          conditionals.push({
            anchorPath: computePath(node, root),
            origIdx: idx,
            sentinel: exprs[idx] as ConditionalSentinel,
          })
          consumed.add(idx)
        } else if (isRecycledSentinel(exprs[idx])) {
          // Recycled-list sentinel: the comment IS the recycled-list anchor — record path, skip text-hole.
          recycledLists.push({
            anchorPath: computePath(node, root),
            origIdx: idx,
            sentinel: exprs[idx] as RecycledSentinel,
          })
          consumed.add(idx)
        } else {
          holeInfos.push({ kind: 'text', origIdx: idx })
          holePaths.push(computePath(node, root))
        }
      }
    } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
      const el = node as Element

      // Component element detection via data-nv-component sentinel.
      const compName = el.getAttribute('data-nv-component')
      if (compName !== null) {
        el.removeAttribute('data-nv-component')
        const tagName = compName
        const propEntries: PropEntry[] = []
        const propNames: string[] = []

        // Gather reactive prop holes (data-nv-attr-N, data-nv-prop-N, data-nv-event-N, data-nv-sync-N)
        for (let k = 0; k < exprs.length; k++) {
          for (const atype of ['attr', 'prop', 'event', 'sync'] as const) {
            const v = el.getAttribute(`data-nv-${atype}-${k}`)
            if (v !== null) {
              el.removeAttribute(`data-nv-${atype}-${k}`)
              const expr = exprs[k] as ReactiveExpr<unknown>
              propEntries.push({ name: v, expr })
              propNames.push(v)
              consumed.add(k)
            }
          }
        }

        // Gather static (plain) attributes.
        const staticAttrs = Array.from(el.attributes)
        for (const attr of staticAttrs) {
          const val = attr.value
          propEntries.push({ name: attr.name, expr: () => val })
          if (!propNames.includes(attr.name)) propNames.push(attr.name)
        }

        // Capture slot content via the SAME walk (recursion = component-as-slot-child).
        const slots: SlotEntry[] = []
        const consumedFillIndices = new Set<number>()
        if (el.childNodes.length > 0) {
          // First pass: detect slot-fill sentinels in direct-child holes of this component element.
          for (const child of Array.from(el.childNodes)) {
            if (child.nodeType === 8 /* COMMENT_NODE */) {
              const commentText = (child as Comment).data
              const holeMatch = /^nv-(\d+)$/.exec(commentText)
              if (holeMatch !== null) {
                // biome-ignore lint/style/noNonNullAssertion: regex match guarantees group
                const holeIdx = Number.parseInt(holeMatch[1]!, 10)
                const expr = exprs[holeIdx]
                if (isSlotFillSentinel(expr)) {
                  slots.push({ name: expr.__nvSlotFill, content: expr.factory })
                  consumedFillIndices.add(holeIdx)
                  consumed.add(holeIdx)
                }
              }
            }
          }

          const defaultNodes: Node[] = []
          const namedGroups = new Map<string, Node[]>()

          for (const child of Array.from(el.childNodes)) {
            // Skip comment nodes that were consumed as slot-fill sentinels
            if (child.nodeType === 8 /* COMMENT_NODE */) {
              const commentText = (child as Comment).data
              const holeMatch = /^nv-(\d+)$/.exec(commentText)
              if (holeMatch !== null) {
                // biome-ignore lint/style/noNonNullAssertion: regex match guarantees group
                const holeIdx = Number.parseInt(holeMatch[1]!, 10)
                if (consumedFillIndices.has(holeIdx)) continue
              }
            }
            if (
              child.nodeType === 1 &&
              (child as Element).tagName.toLowerCase() === 'slot' &&
              (child as Element).hasAttribute('name')
            ) {
              // biome-ignore lint/style/noNonNullAssertion: hasAttribute check above guarantees non-null
              const slotName = (child as Element).getAttribute('name')!
              namedGroups.set(slotName, Array.from((child as Element).childNodes))
            } else {
              defaultNodes.push(child)
            }
          }

          const hasDefaultContent = defaultNodes.some(
            (n) => n.nodeType !== 3 || (n as Text).data.trim() !== '',
          )
          if (hasDefaultContent || defaultNodes.some((n) => n.nodeType === 8)) {
            const { ir: defaultIR, holeIndices } = buildSlotContentIR(
              defaultNodes,
              exprs,
              doc,
              `slot:${tagName}:default`,
            )
            const defaultContent: SlotContent = (_props) => defaultIR
            slots.push({ name: 'default', content: defaultContent })
            for (const idx of holeIndices) consumed.add(idx)
          }

          for (const [slotName, slotChildNodes] of namedGroups) {
            const { ir: namedIR, holeIndices } = buildSlotContentIR(
              slotChildNodes,
              exprs,
              doc,
              `slot:${tagName}:${slotName}`,
            )
            const namedContent: SlotContent = (_props) => namedIR
            slots.push({ name: slotName, content: namedContent })
            for (const idx of holeIndices) consumed.add(idx)
          }
        }

        const compIndex = components.length
        const anchor = doc.createComment(`nv-comp-${compIndex}`)
        el.parentNode?.replaceChild(anchor, el)
        const anchorPath = computePath(anchor, root)
        components.push({ anchorPath, tagName, props: propEntries, propNames, slots })
        return // don't recurse into component children
      }

      for (let k = 0; k < exprs.length; k++) {
        for (const atype of ['attr', 'prop', 'event', 'sync'] as const) {
          const name = el.getAttribute(`data-nv-${atype}-${k}`)
          if (name !== null) {
            holeInfos.push(
              atype === 'attr'
                ? { kind: 'attr', origIdx: k, name }
                : atype === 'prop'
                  ? { kind: 'prop', origIdx: k, name }
                  : atype === 'sync'
                    ? { kind: 'sync', origIdx: k, name }
                    : { kind: 'event', origIdx: k, name },
            )
            holePaths.push(computePath(el, root))
            el.removeAttribute(`data-nv-${atype}-${k}`)
          }
        }
      }
    }
    let child = node.firstChild
    while (child !== null) {
      walk(child)
      child = child.nextSibling
    }
  }

  for (const n of nodes) walk(n)
  return { holeInfos, holePaths, components, consumed, lists, conditionals, recycledLists }
}

// ── Slot content IR builder (collapse: uses the shared walkNodeList) ───────────

/**
 * Build a TemplateIR from a set of DOM nodes (slot content), via the SAME
 * walkNodeList used for the top-level template. Component elements inside slot
 * content are detected and produce ComponentBindings (component-as-slot-child).
 *
 * pathIndex within the sub-IR is COMPACT (0-based in encounter order); hole
 * bindings come first, component bindings appended (matching top-level ordering
 * after compaction). Returns the GLOBAL hole indices consumed (to mark in parent).
 */
function buildSlotContentIR(
  slotNodes: Node[],
  exprs: unknown[],
  doc: Document,
  slotId: string,
): { ir: TemplateIR; holeIndices: number[] } {
  if (slotNodes.length === 0) {
    return {
      ir: { id: slotId, shape: { html: '', bindingPaths: [] }, bindings: [] },
      holeIndices: [],
    }
  }

  // Wrap the slot nodes in a fresh element so the walk has a stable root and the
  // anchor replacements for nested components mutate a detached subtree.
  const fragWrapper = doc.createElement('div')
  for (const n of slotNodes) {
    fragWrapper.appendChild(n.cloneNode(true))
  }

  const { holeInfos, holePaths, components, consumed, lists, conditionals, recycledLists } =
    walkNodeList(Array.from(fragWrapper.childNodes), exprs, fragWrapper, doc)

  // shape.html: serialize post-walk subtree (components now replaced by anchors),
  // strip remaining hole sentinels.
  const rawHtml = fragWrapper.innerHTML.replace(
    new RegExp(`\\s+data-nv-${NV_SENTINEL_KINDS}-\\d+="[^"]*"`, 'g'),
    '',
  )

  // Compact bindings: hole bindings (encounter order) then component bindings.
  const allPaths: NodePath[] = [...holePaths]
  const bindings: Binding[] = holeInfos.map((info, compactIdx) =>
    buildHtmlHoleBinding(
      info.kind === 'text' ? { kind: 'text' } : { kind: info.kind, name: info.name },
      compactIdx,
      exprs[info.origIdx],
    ),
  )
  for (const c of components) {
    const pathIndex = allPaths.length
    allPaths.push(c.anchorPath)
    bindings.push(makeUnresolvedComponentBinding(pathIndex, c))
  }
  // Wire <each>-in-slot: mirrors the main html() function list loop (L893-905).
  // buildSlotContentIR previously discarded `lists` — this closes the both-FE gap (G-SS-bothFE).
  for (const wl of lists) {
    const pathIndex = allPaths.length
    allPaths.push(wl.anchorPath)
    const { items, key, factory } = wl.sentinel
    assertAllBindingKindsHandled('list')
    bindings.push({
      kind: 'list',
      pathIndex,
      items,
      key,
      itemTemplate: (valueSig, indexSig?) =>
        // biome-ignore lint/style/noNonNullAssertion: tagged-template path never sets itemReadsIndex: false, so interpreter always allocates indexSig (§6 conservative-allocate default)
        factory({ item: () => valueSig(), index: () => indexSig!() }),
    } satisfies ListBinding)
  }
  // Wire <iff>-in-slot: mirrors the each-in-slot wiring above.
  for (const wc of conditionals) {
    const pathIndex = allPaths.length
    allPaths.push(wc.anchorPath)
    const { condition, consequent, alternate } = wc.sentinel
    assertAllBindingKindsHandled('conditional')
    bindings.push({
      kind: 'conditional',
      pathIndex,
      condition,
      consequent: consequent(),
      alternate: alternate !== null ? alternate() : null,
    } satisfies ConditionalBinding)
  }
  // Wire <recycle>-in-slot: mirrors the each-in-slot / iff-in-slot wiring above.
  for (const wr of recycledLists) {
    const pathIndex = allPaths.length
    allPaths.push(wr.anchorPath)
    bindings.push(buildRecycledListBinding(pathIndex, wr.sentinel))
  }

  const holeIndices = [...holeInfos.map((h) => h.origIdx), ...consumed].filter(
    (v, i, a) => a.indexOf(v) === i,
  )

  return {
    ir: { id: slotId, shape: { html: rawHtml, bindingPaths: allPaths }, bindings },
    holeIndices,
  }
}

/**
 * Build one RecycledListBinding from a walked recycle() sentinel. Shared by both
 * the top-level html() dispatch and the slot-content builder (mirrors the
 * each()/iff() wiring pattern above). indexSig is ALWAYS allocated (non-optional
 * per RecycledListBinding — position IS the identity and is always read; contrast
 * `list`, which can elide it). bodyIR is populated eagerly (stub thunks) so the
 * structural shortcut consumers (bindingEqual, emit) have a body to recurse into,
 * mirroring how `.nv`'s <recycle> always captures bodyIR at parse time.
 */
function buildRecycledListBinding(
  pathIndex: number,
  sentinel: RecycledSentinel,
): RecycledListBinding {
  assertAllBindingKindsHandled('recycled-list')
  const { items, factory } = sentinel
  const itemTemplate = (valueSig: WritableSignal<unknown>, indexSig: WritableSignal<number>) =>
    factory(
      () => valueSig(),
      () => indexSig(),
    )
  return {
    kind: 'recycled-list',
    pathIndex,
    items,
    itemTemplate,
    bodyIR: factory(
      () => undefined,
      () => 0,
    ),
  } satisfies RecycledListBinding
}

/** Build a ComponentBinding whose factory throws if invoked (tagged-template can't resolve imports). */
function makeUnresolvedComponentBinding(pathIndex: number, c: WalkedComponent): ComponentBinding {
  assertAllBindingKindsHandled('component')
  return {
    kind: 'component',
    pathIndex,
    component: (_props, _slots) => {
      throw new Error(
        `[nv] ComponentBinding for <${c.tagName}> has no resolved factory. The tagged-template front-end cannot resolve component imports at parse time. Pass a pre-resolved factory via the ComponentBinding directly.`,
      )
    },
    props: c.props,
    propNames: c.propNames,
    slots: c.slots,
  }
}

// ── Sentinel HTML builder ─────────────────────────────────────────────────────

/**
 * Build two things from strings + hole classifications:
 *
 * 1. sentinelHtml: HTML with detection sentinels at each hole:
 *    - text holes:  <!--nv-{i}-->  (comment preserved in shape.html for Text replacement)
 *    - attr holes:  data-nv-attr-{i}="{attrName}" on the element, PLUS the original
 *                   attribute is stripped from the string (it has no value in the shape)
 *
 * 2. shapeHtml: same as sentinelHtml but with data-nv-attr sentinels removed.
 *    Text-hole comments are kept (the interpreter uses them to locate + replace with
 *    empty Text nodes at instantiation time).
 */
function buildHtmlStrings(
  strings: TemplateStringsArray,
  holes: HoleKind[],
): { sentinelHtml: string; shapeHtml: string } {
  let sentinelHtml = ''

  // Track which strings[i] indices had their leading quote consumed by an attr hole.
  const quoteConsumedAt = new Set<number>()

  for (let i = 0; i < strings.length; i++) {
    // ALWAYS consume a leading quote first, regardless of whether this index is
    // inside the hole range or past it.  The prior version only consumed in the
    // `else` (i >= holes.length) branch, which produced a stray `"` when the
    // string after an attr hole is itself still within the holes range.
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
    let raw = strings[i]!
    if (quoteConsumedAt.has(i)) {
      raw = raw.replace(/^["']/, '')
    }

    if (i < holes.length) {
      // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
      const hole = holes[i]!
      if (hole.kind === 'text') {
        sentinelHtml += `${raw}<!--nv-${i}-->`
      } else if (hole.kind === 'attr') {
        // Attr hole: strip ` attrName="` from end, add data sentinel on the element.
        const m = raw.match(/(\s+)([\w:-]+)=["']$/)
        if (m === null) {
          throw new Error(
            `[nv/html] Internal: attr hole ${i} but no attr pattern at end of string "${raw}"`,
          )
        }
        // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
        const stripped = raw.slice(0, raw.length - m[0]!.length)
        sentinelHtml += `${stripped} data-nv-attr-${i}="${hole.name}"`
        // Mark the NEXT string to have its leading closing-quote consumed.
        quoteConsumedAt.add(i + 1)
      } else if (hole.kind === 'sync') {
        // Sync hole: strip ` :propName="` from end.
        const m = raw.match(/(\s+):([\w-]+)=["']$/)
        if (m === null) {
          throw new Error(
            `[nv/html] Internal: sync hole ${i} but no :propName pattern at end of string "${raw}"`,
          )
        }
        // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
        const stripped = raw.slice(0, raw.length - m[0]!.length)
        sentinelHtml += `${stripped} data-nv-sync-${i}="${hole.name}"`
        quoteConsumedAt.add(i + 1)
      } else {
        // Event or prop hole: strip ` @eventName="` / ` .propName="` from end.
        const prefix = hole.kind === 'event' ? '@' : '.'
        const m = raw.match(new RegExp(`(\\s+)\\${prefix}([\\w:-]+)=["']$`))
        if (m === null) {
          throw new Error(
            `[nv/html] Internal: ${hole.kind} hole ${i} but no ${prefix}attrName pattern at end of string "${raw}"`,
          )
        }
        // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
        const stripped = raw.slice(0, raw.length - m[0]!.length)
        sentinelHtml += `${stripped} data-nv-${hole.kind}-${i}="${hole.name}"`
        quoteConsumedAt.add(i + 1)
      }
    } else {
      sentinelHtml += raw
    }
  }

  // Inject data-nv-component sentinel for capitalized-tag elements so DFS walk can detect them.
  sentinelHtml = sentinelHtml.replace(
    /<([A-Z][\w-]*)(\s|\/|>)/g,
    (_, name: string, after: string) => `<${name} data-nv-component="${name}"${after}`,
  )

  // shapeHtml: remove data-nv-attr-N sentinel attributes.
  const shapeHtml = sentinelHtml.replace(
    new RegExp(`\\s+data-nv-${NV_SENTINEL_KINDS}-\\d+="[^"]*"`, 'g'),
    '',
  )

  return { sentinelHtml, shapeHtml }
}

// ── Main factory ──────────────────────────────────────────────────────────────

/**
 * Create an `html` tagged template function bound to `document`.
 *
 * The returned function parses tagged template literals into TemplateIRs.
 * It uses `document.createElement('template')` to parse HTML — this is the
 * standard mechanism in all modern browsers and jsdom.
 *
 * All expression holes must be thunks: `${() => signal()}` not `${signal()}`.
 * Passing a non-function throws at template construction time with a clear message.
 */
export function createHtmlTag(document: Document) {
  return function html(strings: TemplateStringsArray, ...exprs: unknown[]): TemplateIR {
    // Validate: all expressions must be functions (thunks) OR slot sentinels OR slot-fill sentinels OR classes sentinels.
    for (let i = 0; i < exprs.length; i++) {
      if (
        typeof exprs[i] !== 'function' &&
        !isSlotSentinel(exprs[i]) &&
        !isSlotFillSentinel(exprs[i]) &&
        !isEachSentinel(exprs[i]) &&
        !isConditionalSentinel(exprs[i]) &&
        !isRecycledSentinel(exprs[i]) &&
        !isClassesSentinel(exprs[i])
      ) {
        throw new TypeError(
          `[nv/html] Expression at hole ${i} is not a function. Wrap reactive values in thunks: \${() => signal()} not \${signal()}. Received: ${typeof exprs[i]}`,
        )
      }
    }

    // Classify holes
    const holes: HoleKind[] = []
    for (let i = 0; i < exprs.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
      holes.push(classifyHole(strings[i]!, strings[i + 1] ?? ''))
    }

    // Build HTML strings
    const { sentinelHtml, shapeHtml } = buildHtmlStrings(strings, holes)

    // Parse sentinel HTML → find paths
    const tmpl = document.createElement('template')
    tmpl.innerHTML = sentinelHtml
    const frag = tmpl.content // DocumentFragment — root for path computation

    const bindingPaths: NodePath[] = new Array(exprs.length).fill(null)

    // DFS walk to find sentinels — SAME walk used for slot content (GATE-2 collapse).
    const {
      holeInfos,
      holePaths,
      components,
      consumed: consumedByComponent,
      lists,
      conditionals,
      recycledLists,
    } = walkNodeList(Array.from(frag.childNodes), exprs, frag, document)
    // Map encounter-order hole paths back to GLOBAL hole indices (top-level convention).
    for (let h = 0; h < holeInfos.length; h++) {
      // biome-ignore lint/style/noNonNullAssertion: index-aligned arrays
      bindingPaths[holeInfos[h]!.origIdx] = holePaths[h]!
    }

    // Verify all non-component holes were found
    for (let i = 0; i < exprs.length; i++) {
      if (!consumedByComponent.has(i) && bindingPaths[i] === null) {
        throw new Error(
          `[nv/html] Could not locate sentinel for hole ${i} in template. ` +
            `Sentinel HTML: ${sentinelHtml.slice(0, 200)}`,
        )
      }
    }

    // Build allPaths: component anchors appended after hole paths
    const allPaths: NodePath[] = [...bindingPaths]

    // Build bindings — component bindings first
    const bindings: Binding[] = []
    for (const c of components) {
      const pathIndex = allPaths.length
      allPaths.push(c.anchorPath)
      bindings.push(makeUnresolvedComponentBinding(pathIndex, c))
    }

    for (let i = 0; i < exprs.length; i++) {
      if (consumedByComponent.has(i)) continue
      // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
      const hole = holes[i]!
      bindings.push(buildHtmlHoleBinding(hole, i, exprs[i]))
    }

    // Add list bindings (each() sentinels): anchor paths appended after component + hole paths.
    // The adapter wraps SlotContent factory → itemTemplate signature (Variant A).
    for (const wl of lists) {
      const pathIndex = allPaths.length
      allPaths.push(wl.anchorPath)
      const { items, key, factory } = wl.sentinel
      bindings.push({
        kind: 'list',
        pathIndex,
        items,
        key,
        itemTemplate: (valueSig, indexSig?) =>
          // biome-ignore lint/style/noNonNullAssertion: tagged-template path never sets itemReadsIndex: false, so interpreter always allocates indexSig (§6 conservative-allocate default)
          factory({ item: () => valueSig(), index: () => indexSig!() }),
      } satisfies ListBinding)
    }

    // Add conditional bindings (iff() sentinels): anchor paths appended after lists.
    for (const wc of conditionals) {
      const pathIndex = allPaths.length
      allPaths.push(wc.anchorPath)
      const { condition, consequent, alternate } = wc.sentinel
      bindings.push({
        kind: 'conditional',
        pathIndex,
        condition,
        consequent: consequent(),
        alternate: alternate !== null ? alternate() : null,
      } satisfies ConditionalBinding)
    }

    // Add recycled-list bindings (recycle() sentinels): anchor paths appended after conditionals.
    for (const wr of recycledLists) {
      const pathIndex = allPaths.length
      allPaths.push(wr.anchorPath)
      bindings.push(buildRecycledListBinding(pathIndex, wr.sentinel))
    }

    const shape: TemplateShape = {
      html: shapeHtml,
      bindingPaths: allPaths as NodePath[],
    }

    // Stable ID: use a short hash of the static structure for cross-session stability.
    // For PoC, a simple content-based ID is sufficient.
    const id = `html:${simpleHash(shapeHtml)}`

    return {
      id,
      shape,
      bindings,
      meta: { frontEnd: 'tagged-template' },
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Cheap non-cryptographic hash for template IDs. Not for security. */
function simpleHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
