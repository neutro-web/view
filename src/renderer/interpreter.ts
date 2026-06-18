/**
 * nv Runtime Interpreter Back-End
 * Stream: (3) Renderer/templating
 * IR contract: nv-template-ir.md v0.2
 *
 * This is the semantic ground truth implementation. The "compiler = interpreter
 * partially evaluated" framing means every observable behavior here is the spec
 * the compiler back-end must match. Be deliberate about observable semantics:
 *
 * - Effect creation order: effects are created in bindings[] order (index 0 first).
 * - Initial run: effects run on their first flush after createRoot. They do not
 *   run synchronously during mount; the caller must flush to get the initial DOM.
 * - Disposal: createRoot's dispose() calls disposeNodeFull(root) which:
 *     (a) runs root's cleanups LIFO — including onCleanup(() => rootEl.remove())
 *     (b) disposes root's owned children (each binding's effect node)
 *         → severs each effect's source edges → signal observerCounts → 0
 *   No manual edge tracking in the interpreter. Ownership is entirely via the
 *   §6 owner tree: effects own = root because they are created inside createRoot.
 *
 * Owner-tree wiring (§6, confirmed before this implementation):
 *   createRoot sets currentOwner = root during its callback.
 *   Every effect(compute) call inside the callback sets node.owner = currentOwner
 *   and calls addChild(root, node). onCleanup(fn) also registers on root.
 *   Disposal of root: cleanups LIFO → disposeChildrenOf(root) → all effects
 *   disposed → all signal edges removed. No manual tracking needed; the §6
 *   contract handles it.
 *
 * ConditionalBinding disposal note (designed, deferred — included here for
 * future reference):
 *   ConditionalBinding does NOT use auto-dispose via owned children, because
 *   we need to dispose only the branch on condition change, not the conditional
 *   effect itself. Pattern: explicit branchDisposer variable + createRoot per
 *   branch + onCleanup to bridge parent teardown. See IR §3.6.
 *
 * jsdom-vs-browser scope:
 *   - Uses only standard DOM APIs: createElement, createTextNode, cloneNode,
 *     insertBefore, replaceChild, appendChild, removeAttribute, setAttribute,
 *     addEventListener, removeEventListener.
 *   - Assumption: <template> element + innerHTML parsing works correctly in jsdom.
 *   - Flag if jsdom diverges from real browsers on any of these.
 */

import { createRoot, effect, onCleanup } from '../core/core'
import type {
  AttrBinding,
  Binding,
  ChildBinding,
  ConditionalBinding,
  EventBinding,
  NodePath,
  PropBinding,
  TemplateIR,
  TextBinding,
} from './ir'

// ── DOM utilities ─────────────────────────────────────────────────────────────

/**
 * Walk `path` from `root`, returning the node at that position.
 * Throws if any step in the path is out of bounds.
 */
export function walkPath(root: Node, path: NodePath): Node {
  let current: Node = root
  for (let depth = 0; depth < path.length; depth++) {
    const idx = path[depth]
    const child = current.childNodes[idx]
    if (child === undefined) {
      throw new Error(
        `[nv/interpreter] walkPath: no child at index ${idx} (depth ${depth}). ` +
          `Node has ${current.childNodes.length} children. Path: [${path.join(', ')}]`,
      )
    }
    current = child
  }
  return current
}

// ── Binding wiring ────────────────────────────────────────────────────────────

/**
 * Wire a single binding to its resolved DOM target node.
 * Called inside a createRoot callback (currentOwner = root).
 * Each wired effect is automatically owned by the root.
 *
 * Target node types per binding kind (IR §2.2):
 *   text        → Comment sentinel, replaced here with an empty Text node
 *   attr, prop, event → the Element itself
 *   child       → Comment anchor, content inserted before it
 *   conditional → Comment anchor
 */
function wireBinding(binding: Binding, targetNode: Node, doc: Document): void {
  switch (binding.kind) {
    case 'text': {
      wireText(binding, targetNode, doc)
      break
    }
    case 'attr': {
      wireAttr(binding, targetNode)
      break
    }
    case 'prop': {
      wireProp(binding, targetNode)
      break
    }
    case 'event': {
      wireEvent(binding, targetNode)
      break
    }
    case 'child': {
      wireChild(binding, targetNode, doc)
      break
    }
    case 'conditional': {
      wireConditional(binding, targetNode, doc)
      break
    }
    case 'list':
    case 'sync': {
      throw new Error(
        `[nv/interpreter] v0: '${binding.kind}' binding is designed but not yet implemented in the interpreter. Deferred per IR §9.2.`,
      )
    }
    default: {
      const _exhaustive: never = binding
      throw new Error(`[nv/interpreter] Unknown binding kind: ${(_exhaustive as Binding).kind}`)
    }
  }
}

// ── TextBinding ───────────────────────────────────────────────────────────────

function wireText(binding: TextBinding, commentNode: Node, doc: Document): void {
  // Replace the <!--nv-N--> sentinel comment with an empty Text node at the same position.
  // The Text node's position in childNodes is identical to the comment's was.
  const parent = commentNode.parentNode
  if (parent === null) {
    throw new Error('[nv/interpreter] TextBinding: sentinel comment has no parent')
  }

  const textNode = doc.createTextNode('')
  parent.replaceChild(textNode, commentNode)

  // Effect: reads expr() in a tracking context, writes textNode.data.
  // Owned by the enclosing createRoot (currentOwner at call time).
  effect(() => {
    const v = binding.expr()
    textNode.data = v == null ? '' : String(v)
  })
}

// ── AttrBinding ───────────────────────────────────────────────────────────────

function wireAttr(binding: AttrBinding, el: Node): void {
  if (el.nodeType !== 1 /* ELEMENT_NODE */) {
    throw new Error(
      `[nv/interpreter] AttrBinding expects an Element node; got nodeType ${el.nodeType}`,
    )
  }
  const element = el as Element
  const name = binding.name

  effect(() => {
    const v = binding.expr()
    if (v == null || v === false) {
      element.removeAttribute(name)
    } else {
      element.setAttribute(name, v === true ? '' : String(v))
    }
  })
}

// ── PropBinding ───────────────────────────────────────────────────────────────

function wireProp(binding: PropBinding, el: Node): void {
  if (el.nodeType !== 1 /* ELEMENT_NODE */) {
    throw new Error(
      `[nv/interpreter] PropBinding expects an Element node; got nodeType ${el.nodeType}`,
    )
  }
  const element = el as Element
  const name = binding.name

  effect(() => {
    ;(element as unknown as Record<string, unknown>)[name] = binding.expr()
  })
}

// ── EventBinding ──────────────────────────────────────────────────────────────

function wireEvent(binding: EventBinding, el: Node): void {
  if (el.nodeType !== 1 /* ELEMENT_NODE */) {
    throw new Error(
      `[nv/interpreter] EventBinding expects an Element node; got nodeType ${el.nodeType}`,
    )
  }
  const element = el as Element

  // Handler wrapper: one listener registered; effect tracks the handler expression.
  // v0: always uses the wrapper-effect even for handlerKind: 'stable' (§3.4, §10).
  // The 'stable' skip-the-effect optimization is a deferred performance hypothesis.
  let current: ((e: Event) => void) | null = null
  const listener = (e: Event): void => {
    if (current !== null) current(e)
  }

  effect(() => {
    current = binding.handler()
  })

  element.addEventListener(binding.eventName, listener, binding.options)
  onCleanup(() => element.removeEventListener(binding.eventName, listener, binding.options))
}

// ── ChildBinding ──────────────────────────────────────────────────────────────

function wireChild(binding: ChildBinding, anchorNode: Node, doc: Document): void {
  // v0: primitive values only → single Text node managed next to the anchor.
  // Anchor is the <!--nv-N--> comment node; we insert a Text node before it.

  const parent = anchorNode.parentNode
  if (parent === null) {
    throw new Error('[nv/interpreter] ChildBinding: anchor comment has no parent')
  }

  const textNode = doc.createTextNode('')
  parent.insertBefore(textNode, anchorNode)
  onCleanup(() => textNode.remove())

  effect(() => {
    const v = binding.expr()
    // v0: primitive values only
    if (v !== null && v !== undefined && typeof v === 'object') {
      throw new Error(
        `[nv/interpreter] v0: ChildBinding received non-primitive value (${Object.prototype.toString.call(v)}). DOM Node / TemplateIR values are designed but not yet implemented. Expected: string | number | null | undefined.`,
      )
    }
    textNode.data = v == null ? '' : String(v)
  })
}

// ── ConditionalBinding ────────────────────────────────────────────────────────

function wireConditional(binding: ConditionalBinding, anchorNode: Node, doc: Document): void {
  // Anchor is a Comment node; branches mount before it.
  const parent = anchorNode.parentNode
  if (parent === null) {
    throw new Error('[nv/interpreter] ConditionalBinding: anchor has no parent')
  }

  let branchDisposer: (() => void) | null = null

  effect(() => {
    // Dispose previous branch (removes its DOM and reactive edges)
    if (branchDisposer !== null) {
      branchDisposer()
      branchDisposer = null
    }

    const template = binding.condition() ? binding.consequent : binding.alternate
    if (template === null) return

    // Mount branch in its own root scope.
    // The branch's effects are owned by the branch root (not by this effect),
    // so toggling the condition disposes only the branch, not this effect.
    branchDisposer = createRoot((dispose) => {
      const { rootEl } = mountFragment(template, parent, doc, anchorNode)
      onCleanup(() => {
        if (rootEl.parentNode !== null) rootEl.parentNode.removeChild(rootEl)
      })
      return dispose
    })

    // Bridge: if THIS effect is disposed (parent region teardown), clean up branch.
    onCleanup(() => {
      if (branchDisposer !== null) {
        branchDisposer()
        branchDisposer = null
      }
    })
  })
}

// ── Mount (the public API) ────────────────────────────────────────────────────

/**
 * Internal: mount a TemplateIR fragment into `parent`, inserting before `before`
 * (or appending if null). Returns the first child of the mounted fragment (for
 * onCleanup removal). Assumes single-root template for the PoC.
 *
 * Called inside a createRoot callback by both mount() and wireConditional().
 */
function mountFragment(
  ir: TemplateIR,
  parent: Element | Node,
  doc: Document,
  before: Node | null = null,
): { rootEl: Node } {
  // 1. Parse shape.html into a fresh DocumentFragment via <template>.
  //    jsdom supports <template> element; real browsers also support this.
  const tmpl = doc.createElement('template')
  tmpl.innerHTML = ir.shape.html
  const frag = tmpl.content.cloneNode(true) as DocumentFragment

  // 2. Walk bindingPaths to locate target nodes.
  //    Text binding targets (<!--nv-N--> comments) are located and replaced here.
  const targets: Node[] = ir.bindings.map((b) => {
    const path = ir.shape.bindingPaths[b.pathIndex]
    if (path === undefined) {
      throw new Error(`[nv/interpreter] No path for binding at pathIndex ${b.pathIndex}`)
    }
    return walkPath(frag, path)
  })

  // 3. Wire each binding (creates effects owned by the enclosing root).
  for (let i = 0; i < ir.bindings.length; i++) {
    wireBinding(ir.bindings[i], targets[i], doc)
  }

  // 4. Insert fragment into the parent.
  //    PoC constraint: template is assumed to have a single root element.
  //    The rootEl is the first child for cleanup reference.
  const firstChild = frag.firstChild
  if (firstChild === null) {
    throw new Error('[nv/interpreter] Template produced an empty fragment')
  }
  if (before !== null) {
    parent.insertBefore(frag, before)
  } else {
    parent.appendChild(frag)
  }

  // After appendChild/insertBefore, frag is empty (nodes moved to parent).
  // firstChild is now in parent; it's safe to reference for removal.
  return { rootEl: firstChild }
}

/**
 * Mount a TemplateIR into `parent`. Returns a disposer.
 *
 * The disposer:
 *   1. Runs DOM cleanup (removes the mounted root element from parent).
 *   2. Disposes all binding effects (severs reactive edges, no leaks).
 *
 * Calling the disposer a second time is safe (idempotent via isDisposed guard).
 *
 * IMPORTANT: effects are enqueued but not yet run when mount() returns. Call
 * flushSync() before asserting DOM state.
 *
 * Owner-tree wiring: all effects created during mount are owned by the root
 * scope established by createRoot. Disposal tears down the entire owned subtree
 * automatically via §6 disposeChildrenOf(root).
 */
export function mount(ir: TemplateIR, parent: Element, doc: Document): () => void {
  return createRoot((dispose) => {
    const { rootEl } = mountFragment(ir, parent, doc)
    onCleanup(() => {
      // Remove the mounted DOM from parent.
      // rootEl.remove() is safe even if rootEl is already detached.
      if (rootEl.parentNode !== null) rootEl.parentNode.removeChild(rootEl)
    })
    return dispose
  })
}
