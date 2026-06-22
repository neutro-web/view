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
  ComponentBinding,
  EventBinding,
  HandlerExpr,
  NodePath,
  PropBinding,
  PropEntry,
  ReactiveExpr,
  SlotEntry,
  SlotOutletBinding,
  TemplateIR,
  TemplateShape,
  TextBinding,
} from './ir.js'

// ── Slot outlet sentinel (B2 fix) ─────────────────────────────────────────────

/** Opaque sentinel returned by `slots(name)` — the tagged-template outlet form. */
export interface SlotSentinel {
  readonly __nvSlotOutlet: string
}

/**
 * Create a slot outlet sentinel for the tagged-template side.
 * Write `${slots('header')}` where the child component renders the named slot.
 * Mirrors `.nv`'s `{slots.header}` bare-read; both produce `SlotOutletBinding`.
 */
export function slots(name: string): SlotSentinel {
  return { __nvSlotOutlet: name }
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

/** Slot-walk hole info — tracks kind + origIdx so the shared walk can use buildHtmlHoleBinding. */
type SlotHoleInfo =
  | { kind: 'text'; origIdx: number }
  | { kind: 'attr'; origIdx: number; name: string }
  | { kind: 'prop'; origIdx: number; name: string }
  | { kind: 'event'; origIdx: number; name: string }

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
  // Attr hole: attrName="
  const m = prevString.match(/\s([\w:-]+)=["']$/)
  if (m !== null && closingQuote) {
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
    return { kind: 'attr', name: m[1]! }
  }
  return { kind: 'text' }
}

// ── Shared per-hole binding constructor ───────────────────────────────────────

/**
 * Build one Binding from a classified hole. Used by BOTH the main hole loop
 * and the slot content builder so the two cannot produce divergent kinds.
 */
function buildHtmlHoleBinding(holeKind: HoleKind, pathIndex: number, origExpr: unknown): Binding {
  type PrimitiveExpr = ReactiveExpr<string | number | boolean | null | undefined>
  const expr = origExpr as PrimitiveExpr
  if (holeKind.kind === 'text') {
    if (isSlotSentinel(origExpr)) {
      const b: SlotOutletBinding = {
        kind: 'slot-outlet',
        pathIndex,
        name: origExpr.__nvSlotOutlet,
      }
      return b
    }
    const b: TextBinding = { kind: 'text', pathIndex, expr }
    return b
  }
  if (holeKind.kind === 'attr') {
    const b: AttrBinding = { kind: 'attr', pathIndex, name: holeKind.name, expr }
    return b
  }
  if (holeKind.kind === 'prop') {
    const b: PropBinding = { kind: 'prop', pathIndex, name: holeKind.name, expr }
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

  function walk(node: Node): void {
    if (node.nodeType === 8 /* COMMENT_NODE */) {
      const m = (node as Comment).data.match(/^nv-(\d+)$/)
      if (m !== null) {
        // biome-ignore lint/style/noNonNullAssertion: regex match guarantees group
        const idx = Number.parseInt(m[1]!, 10)
        holeInfos.push({ kind: 'text', origIdx: idx })
        holePaths.push(computePath(node, root))
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

        // Gather reactive prop holes (data-nv-attr-N, data-nv-prop-N, data-nv-event-N)
        for (let k = 0; k < exprs.length; k++) {
          for (const atype of ['attr', 'prop', 'event'] as const) {
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
        if (el.childNodes.length > 0) {
          const defaultNodes: Node[] = []
          const namedGroups = new Map<string, Node[]>()

          for (const child of Array.from(el.childNodes)) {
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
            slots.push({ name: 'default', content: defaultIR })
            for (const idx of holeIndices) consumed.add(idx)
          }

          for (const [slotName, slotChildNodes] of namedGroups) {
            const { ir: namedIR, holeIndices } = buildSlotContentIR(
              slotChildNodes,
              exprs,
              doc,
              `slot:${tagName}:${slotName}`,
            )
            slots.push({ name: slotName, content: namedIR })
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
        for (const atype of ['attr', 'prop', 'event'] as const) {
          const name = el.getAttribute(`data-nv-${atype}-${k}`)
          if (name !== null) {
            holeInfos.push(
              atype === 'attr'
                ? { kind: 'attr', origIdx: k, name }
                : atype === 'prop'
                  ? { kind: 'prop', origIdx: k, name }
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
  return { holeInfos, holePaths, components, consumed }
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

  const { holeInfos, holePaths, components, consumed } = walkNodeList(
    Array.from(fragWrapper.childNodes),
    exprs,
    fragWrapper,
    doc,
  )

  // shape.html: serialize post-walk subtree (components now replaced by anchors),
  // strip remaining hole sentinels.
  const rawHtml = fragWrapper.innerHTML.replace(
    /\s+data-nv-(?:attr|prop|event|component)-\d+="[^"]*"/g,
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

  const holeIndices = [...holeInfos.map((h) => h.origIdx), ...consumed].filter(
    (v, i, a) => a.indexOf(v) === i,
  )

  return {
    ir: { id: slotId, shape: { html: rawHtml, bindingPaths: allPaths }, bindings },
    holeIndices,
  }
}

/** Build a ComponentBinding whose factory throws if invoked (tagged-template can't resolve imports). */
function makeUnresolvedComponentBinding(pathIndex: number, c: WalkedComponent): ComponentBinding {
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
    /\s+data-nv-(?:attr|event|prop|component)-\d+="[^"]*"|\s+data-nv-component="[^"]*"/g,
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
    // Validate: all expressions must be functions (thunks) OR slot sentinels.
    for (let i = 0; i < exprs.length; i++) {
      if (typeof exprs[i] !== 'function' && !isSlotSentinel(exprs[i])) {
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
