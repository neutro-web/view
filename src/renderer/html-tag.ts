/**
 * nv Tagged-Template Front-End
 * Stream: (3) Renderer/templating
 * IR contract: nv-template-ir.md v0.2
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
  NodePath,
  ReactiveExpr,
  TemplateIR,
  TemplateShape,
  TextBinding,
} from './ir'

// ── Hole classification ───────────────────────────────────────────────────────

type HoleKind = { kind: 'text' } | { kind: 'attr'; name: string }

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
  const m = prevString.match(/\s([\w:-]+)=["']$/)
  if (m !== null && (nextString.startsWith('"') || nextString.startsWith("'"))) {
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
    return { kind: 'attr', name: m[1]! }
  }
  return { kind: 'text' }
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
      } else {
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
      }
    } else {
      sentinelHtml += raw
    }
  }

  // shapeHtml: remove data-nv-attr-N sentinel attributes.
  const shapeHtml = sentinelHtml.replace(/\s+data-nv-attr-\d+="[^"]*"/g, '')

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
    // Validate: all expressions must be functions (thunks)
    for (let i = 0; i < exprs.length; i++) {
      if (typeof exprs[i] !== 'function') {
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

    // DFS walk to find sentinels
    ;(function walk(node: Node): void {
      if (node.nodeType === 8 /* COMMENT_NODE */) {
        const comment = node as Comment
        const m = comment.data.match(/^nv-(\d+)$/)
        if (m !== null) {
          // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
          const idx = Number.parseInt(m[1]!, 10)
          bindingPaths[idx] = computePath(node, frag)
        }
      } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
        const el = node as Element
        for (let k = 0; k < exprs.length; k++) {
          const attrVal = el.getAttribute(`data-nv-attr-${k}`)
          if (attrVal !== null) {
            // k-th hole is an attr binding on this element
            bindingPaths[k] = computePath(el, frag)
            el.removeAttribute(`data-nv-attr-${k}`)
          }
        }
      }
      let child = node.firstChild
      while (child !== null) {
        walk(child)
        child = child.nextSibling
      }
    })(frag)

    // Verify all holes were found
    for (let i = 0; i < exprs.length; i++) {
      if (bindingPaths[i] === null) {
        throw new Error(
          `[nv/html] Could not locate sentinel for hole ${i} in template. ` +
            `Sentinel HTML: ${sentinelHtml.slice(0, 200)}`,
        )
      }
    }

    // Build bindings
    const bindings: Binding[] = []
    for (let i = 0; i < exprs.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
      const hole = holes[i]!
      // The tagged-template front-end can only validate that exprs[i] is a function
      // (checked above). The generic type parameter is asserted here — the runtime
      // effect will produce wrong output (non-string in a DOM text position) if the
      // caller passes a thunk that returns a non-primitive, but that is a caller error,
      // not a type system error. The TextBinding/AttrBinding expr types narrow to
      // primitives; we cast to satisfy tsc while keeping the guard above.
      type PrimitiveExpr = ReactiveExpr<string | number | boolean | null | undefined>
      const expr = exprs[i] as PrimitiveExpr
      if (hole.kind === 'text') {
        const b: TextBinding = { kind: 'text', pathIndex: i, expr }
        bindings.push(b)
      } else {
        const b: AttrBinding = { kind: 'attr', pathIndex: i, name: hole.name, expr }
        bindings.push(b)
      }
    }

    const shape: TemplateShape = {
      html: shapeHtml,
      bindingPaths: bindingPaths as NodePath[],
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
