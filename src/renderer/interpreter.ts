/**
 * nv Runtime Interpreter Back-End
 * Stream: (3) Renderer/templating
 * IR contract: nv-template-ir.md v0.4.2
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

import {
  createRoot,
  effect,
  getOwner,
  onCleanup,
  pubsub,
  runWithOwner,
  signal,
  sync,
} from '../core/core.js'
import type {
  AttrBinding,
  Binding,
  ChildBinding,
  ClassListBinding,
  ClassListEntry,
  ComponentBinding,
  ConditionalBinding,
  EventBinding,
  ListBinding,
  NodePath,
  PropBinding,
  ReactiveExpr,
  SlotContent,
  SlotOutletBinding,
  StyleVarBinding,
  SyncBinding,
  TemplateIR,
  TextBinding,
  WritableSignal,
} from './ir.js'
import { injectComponentStyle } from './style-inject.js'

// ── DOM utilities ─────────────────────────────────────────────────────────────

/**
 * Walk `path` from `root`, returning the node at that position.
 * Throws if any step in the path is out of bounds.
 */
export function walkPath(root: Node, path: NodePath): Node {
  let current: Node = root
  for (let depth = 0; depth < path.length; depth++) {
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
    const idx = path[depth]!
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
function wireBinding(
  binding: Binding,
  targetNode: Node,
  doc: Document,
  slotsObj?: Record<string, SlotContent>,
  capturedParentOwner?: ReturnType<typeof getOwner>,
): void {
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
    case 'list': {
      wireList(binding, targetNode, doc)
      break
    }
    case 'component': {
      wireComponent(binding, targetNode, doc)
      break
    }
    case 'slot-outlet': {
      if (slotsObj === undefined || capturedParentOwner === undefined) {
        throw new Error('[nv/interpreter] SlotOutletBinding encountered outside component context')
      }
      wireSlotOutlet(binding, targetNode, doc, slotsObj, capturedParentOwner)
      break
    }
    case 'classlist': {
      wireClassList(binding, targetNode)
      break
    }
    case 'style-var': {
      wireStyleVar(binding, targetNode)
      break
    }
    case 'sync': {
      wireSync(binding as SyncBinding, targetNode)
      break
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

// ── ClassListBinding ──────────────────────────────────────────────────────────

function wireClassList(binding: ClassListBinding, el: Node): void {
  if (el.nodeType !== 1 /* ELEMENT_NODE */) {
    throw new Error(
      `[nv/interpreter] ClassListBinding expects an Element node; got nodeType ${el.nodeType}`,
    )
  }
  const element = el as Element

  // Static entries: add once at setup (no effect needed)
  for (const entry of binding.entries) {
    if (entry.kind === 'static') {
      element.classList.add(entry.token)
    }
  }

  // Toggle entries: reactive
  const toggleEntries = binding.entries.filter(
    (e): e is Extract<ClassListEntry, { kind: 'toggle' }> => e.kind === 'toggle',
  )

  if (toggleEntries.length === 0) return

  // TODO(threshold): tune T=6 against real-app ReactiveNode-width evidence; see kind-split watch-item
  if (toggleEntries.length <= 6) {
    // One effect per key (fine-grained)
    for (const e of toggleEntries) {
      const key = e.key
      const expr = e.expr
      effect(() => {
        element.classList.toggle(key, !!expr())
      })
    }
  } else {
    // One looping effect for >6 toggles
    effect(() => {
      for (const e of toggleEntries) {
        element.classList.toggle(e.key, !!e.expr())
      }
    })
  }
}

// ── StyleVarBinding ───────────────────────────────────────────────────────────

function wireStyleVar(binding: StyleVarBinding, el: Node): void {
  if (el.nodeType !== 1 /* ELEMENT_NODE */) {
    throw new Error(
      `[nv/interpreter] StyleVarBinding expects an Element node; got nodeType ${el.nodeType}`,
    )
  }
  const element = el as HTMLElement
  const varName = binding.varName

  effect(() => {
    const v = binding.expr()
    if (v == null) {
      element.style.removeProperty(varName)
    } else {
      element.style.setProperty(varName, String(v))
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

// ── SyncBinding ───────────────────────────────────────────────────────────────

// Per-prop default DOM value extractor.
// 'checked' → event.target.checked (boolean) — a .value default would write "on"/undefined.
// Everything else → event.target.value (string).
function defaultExtractorForProp(prop: string): (ev: unknown) => unknown {
  if (prop === 'checked') {
    return (ev: unknown) => (ev as { target?: { checked?: unknown } } | null)?.target?.checked
  }
  return (ev: unknown) => (ev as { target?: { value?: unknown } } | null)?.target?.value
}

function wireSync(binding: SyncBinding, el: Node): void {
  if (el.nodeType !== 1 /* ELEMENT_NODE */) {
    throw new Error(
      `[nv/interpreter] SyncBinding expects an Element node; got nodeType ${el.nodeType}`,
    )
  }
  const element = el as Element

  // signal→DOM (read direction) — wireProp pattern
  effect(() => {
    ;(element as unknown as Record<string, unknown>)[binding.propName] = binding.readExpr()
  })

  // DOM→signal (write-back) — wireEvent pattern + external-source sync
  const ps = pubsub()
  const listener = (e: Event): void => ps.publish(e)
  element.addEventListener(binding.eventName, listener)
  onCleanup(() => element.removeEventListener(binding.eventName, listener))

  // Pass writeTarget straight to sync(). sync() handles both the direct-accessor
  // and conditional-thunk forms internally via nodeForFn (core.ts:1075-1077).
  const extractor = defaultExtractorForProp(binding.propName)
  let compute: ((ev: unknown) => unknown) | ((ev: unknown, cur: unknown) => unknown)
  if (binding.transform) {
    const t = binding.transform
    if (t.length >= 2) {
      // reduce mode: transform(extractedValue, currentSignalValue)
      compute = (ev: unknown, cur: unknown) => t(extractor(ev), cur)
    } else {
      // map mode: transform(extractedValue)
      compute = (ev: unknown) => (t as (v: unknown) => unknown)(extractor(ev))
    }
  } else {
    compute = extractor
  }

  // Guard: warn if writeTarget is a derived() (non-writable) signal.
  // signal() accessors have a .set method; derived() accessors do not.
  // Thunk forms (() => WritableSignal) are valid — resolve before checking.
  const wt = binding.writeTarget
  // Resolve thunk form: if wt is a function without .set, it may be a thunk
  // (() => WritableSignal) rather than a direct signal/derived accessor.
  const resolvedForGuard =
    typeof wt === 'function' && typeof (wt as unknown as { set?: unknown }).set !== 'function'
      ? (wt as () => WritableSignal<unknown>)()
      : (wt as WritableSignal<unknown>)
  if (typeof resolvedForGuard?.set !== 'function') {
    console.error(
      '[nv] sync: write target is not a writable signal. Use signal(), not derived(), as a :PROP sync target.',
    )
  }

  sync(
    ps,
    binding.writeTarget as WritableSignal<unknown> | (() => WritableSignal<unknown>),
    compute as (incoming: unknown) => unknown,
  )
  // sync's disposer is intentionally discarded — sync owns its node via
  // currentOwner (core.ts:1071-1072) and disposes with the enclosing createRoot.
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

// ── ListBinding ───────────────────────────────────────────────────────────────

type ItemRecord = {
  valueSig: WritableSignal<unknown>
  indexSig: WritableSignal<number>
  lastValue: unknown
  lastIndex: number
  rootEl: Node
  dispose: () => void
}

function wireList(binding: ListBinding, anchorNode: Node, doc: Document): void {
  // Anchor is a Comment node; items are inserted before it (same pattern as ChildBinding).
  const parent = anchorNode.parentNode
  if (parent === null) {
    throw new Error('[nv/interpreter] ListBinding: anchor has no parent')
  }

  const records = new Map<string | number, ItemRecord>()

  // Capture the outer owner (the mount region's createRoot scope) so item roots can be
  // created as its CHILDREN rather than as children of the reconcile effect. If item
  // roots were children of the reconcile effect, preRunCleanup would dispose them on every
  // re-run, destroying per-item reactive signals before op 3/4 could update them.
  const listOwner = getOwner()

  effect(() => {
    const next = binding.items() // the only tracked read in this effect

    // Key collision detection: duplicate key in one snapshot → error-route (§4.4)
    const nextKeys = new Map<string | number, number>()
    for (let i = 0; i < next.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by next.length
      const item = next[i]!
      const k = binding.key(item, i)
      if (nextKeys.has(k)) {
        throw new Error(`[nv/interpreter] ListBinding: duplicate key "${String(k)}" at index ${i}`)
      }
      nextKeys.set(k, i)
    }

    // Op 2: remove stale records (key absent from next snapshot)
    for (const [k, rec] of records) {
      if (!nextKeys.has(k)) {
        rec.dispose()
        records.delete(k)
      }
    }

    // Ops 1/3/4: create new items; update value/index for kept items
    for (let i = 0; i < next.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by next.length
      const item = next[i]!
      const k = binding.key(item, i)
      const existing = records.get(k)

      if (existing === undefined) {
        // Op 1: new key — create per-item signals and a dedicated root scope.
        // runWithOwner(listOwner) ensures the item root is a sibling of the reconcile
        // effect (child of the outer mount scope), not a child of the reconcile effect.
        // This prevents preRunCleanup from disposing item roots on every reconcile re-run.
        const valueSig = signal<unknown>(item)
        const indexSig = signal<number>(i)
        let mountedRoot!: Node

        const dispose = runWithOwner(listOwner, () =>
          createRoot((d) => {
            const itemIR = binding.itemTemplate(valueSig, indexSig)
            const { roots } = mountFragment(itemIR, parent, doc, anchorNode)
            // Strip whitespace-only text nodes — well-formatted templates have them
            // around the single root element (e.g. newlines between <each> and <tr>).
            const contentRoots = roots.filter(
              (n) => n.nodeType !== 3 /* TEXT_NODE */ || (n.textContent?.trim() ?? '') !== '',
            )
            const [root] = contentRoots
            if (root === undefined || contentRoots.length !== 1) {
              throw new Error(
                '[nv] Multi-root list items are not supported in v1. Wrap the item template in a single root element.',
              )
            }
            mountedRoot = root
            onCleanup(() => {
              // Remove the content root; whitespace siblings are harmless orphans.
              if (mountedRoot.parentNode !== null) mountedRoot.parentNode.removeChild(mountedRoot)
            })
            return d
          }),
        )

        records.set(k, {
          valueSig,
          indexSig,
          lastValue: item,
          lastIndex: i,
          rootEl: mountedRoot,
          dispose,
        })
      } else {
        // Op 3: value changed (immutable-item contract; compare by reference, not valueSig() read)
        // NOT reading valueSig() here — that would subscribe the reconcile effect to per-item
        // signals, creating a dependency that re-runs reconcile on every item value change.
        if (!Object.is(existing.lastValue, item)) {
          existing.valueSig.set(item)
          existing.lastValue = item
        }
        // Op 4: index changed — update indexSig and record
        if (existing.lastIndex !== i) {
          existing.indexSig.set(i)
          existing.lastIndex = i
        }
      }
    }

    // DOM ordering: walk next in reverse, insertBefore to enforce sequence.
    // Each item's rootEl is the single-root element (e.g. <li>) of its mounted fragment.
    // O(N) moves worst-case; correct for add/remove/reorder (LIS-Ivi move-minimization deferred).
    let ref: Node = anchorNode
    for (let i = next.length - 1; i >= 0; i--) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by next.length
      const k = binding.key(next[i]!, i)
      // biome-ignore lint/style/noNonNullAssertion: key was just set above (op1) or existed
      const rec = records.get(k)!
      if (rec.rootEl.nextSibling !== ref) {
        parent.insertBefore(rec.rootEl, ref)
      }
      ref = rec.rootEl
    }
  })

  // Parent teardown: dispose all item roots when the list region unmounts (§6 cascade)
  onCleanup(() => {
    for (const rec of records.values()) rec.dispose()
    records.clear()
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
      const { roots } = mountFragment(template, parent, doc, anchorNode)
      onCleanup(() => {
        for (const n of roots) {
          if (n.parentNode !== null) n.parentNode.removeChild(n)
        }
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

// ── SlotOutletBinding ─────────────────────────────────────────────────────────

function wireSlotOutlet(
  binding: SlotOutletBinding,
  anchorNode: Node,
  doc: Document,
  slotsObj: Record<string, SlotContent>,
  capturedParentOwner: ReturnType<typeof getOwner>,
): void {
  const content = slotsObj[binding.name] // SlotContent | undefined

  const parent = anchorNode.parentNode
  if (parent === null) {
    throw new Error('[nv/interpreter] SlotOutletBinding: anchor has no parent')
  }

  if (content === undefined) {
    // Unfilled slot: render fallback. D-slot-1 unchanged.
    const fallbackIR = binding.fallback
    if (fallbackIR !== undefined) {
      runWithOwner(capturedParentOwner, () => {
        const fallbackDisposer = createRoot((dispose) => {
          const { roots } = mountFragment(fallbackIR, parent, doc, anchorNode)
          onCleanup(() => {
            for (const n of roots) {
              if (n.parentNode !== null) n.parentNode.removeChild(n)
            }
          })
          return dispose
        })
        onCleanup(() => fallbackDisposer())
      })
    }
    return
  }

  // Build slotProps from binding.props (empty object when props absent)
  const slotProps: Record<string, ReactiveExpr> = {}
  for (const p of binding.props ?? []) {
    slotProps[p.name] = p.expr
  }
  const slotIR = content(slotProps)

  // Mount slotIR under capturedParentOwner — D-slot-1 path UNCHANGED
  runWithOwner(capturedParentOwner, () => {
    const slotDisposer = createRoot((dispose) => {
      const { roots } = mountFragment(slotIR, parent, doc, anchorNode)
      onCleanup(() => {
        for (const n of roots) {
          if (n.parentNode !== null) n.parentNode.removeChild(n)
        }
      })
      return dispose
    })
    onCleanup(() => slotDisposer())
  })
}

// ── ComponentBinding ──────────────────────────────────────────────────────────

function wireComponent(binding: ComponentBinding, anchorNode: Node, doc: Document): void {
  const parent = anchorNode.parentNode
  if (parent === null) {
    throw new Error('[nv/interpreter] ComponentBinding: anchor has no parent')
  }

  // Build PropsObject: name → accessor thunk (already in binding.props)
  const propsObj: Record<string, ReactiveExpr> = {}
  for (const p of binding.props) {
    propsObj[p.name] = p.expr
  }

  // Build SlotFns: name → SlotContent (factory)
  const slotsObj: Record<string, SlotContent> = {}
  for (const s of binding.slots) {
    slotsObj[s.name] = s.content // s.content is now SlotContent (factory)
  }

  // Capture parent owner BEFORE the child's createRoot (D-slot-1).
  // Slot content must be owned by the parent, not the child.
  const capturedParentOwner = getOwner()

  // Mount the child factory in its own createRoot scope.
  // Static component: owned by the current scope (no runWithOwner needed —
  // same pattern as wireConditional's branch mounting).
  const childDisposer = createRoot((dispose) => {
    const childIR = binding.component(propsObj, slotsObj)
    const { roots } = mountFragment(childIR, parent, doc, anchorNode, {
      slotsObj,
      capturedParentOwner,
    })
    if (childIR.styleArtifact) {
      if (roots.length > 1) {
        throw new Error('[nv/interpreter] $style on multi-root component is not supported')
      }
      if (childIR.styleArtifact.staticCss) {
        injectComponentStyle(doc, childIR.styleArtifact.scopeHash, childIR.styleArtifact.staticCss)
      }
      const scopeAttr = `data-nv-s-${childIR.styleArtifact.scopeHash}`
      const root = roots[0]
      if (root instanceof Element) root.setAttribute(scopeAttr, '')
    }
    onCleanup(() => {
      for (const n of roots) {
        if (n.parentNode !== null) n.parentNode.removeChild(n)
      }
    })
    return dispose
  })

  // Bridge: if the parent region is torn down, dispose the child root.
  onCleanup(() => childDisposer())
}

// ── Mount (the public API) ────────────────────────────────────────────────────

/**
 * Internal: mount a TemplateIR fragment into `parent`, inserting before `before`
 * (or appending if null). Returns ALL child nodes of the mounted fragment so
 * callers can remove every root on cleanup. Multi-root templates are fully supported.
 *
 * Called inside a createRoot callback by both mount() and wireConditional().
 */
function mountFragment(
  ir: TemplateIR,
  parent: Element | Node,
  doc: Document,
  before: Node | null = null,
  slotContext?: {
    slotsObj: Record<string, SlotContent>
    capturedParentOwner: ReturnType<typeof getOwner>
  },
): { roots: Node[] } {
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
    wireBinding(
      // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
      ir.bindings[i]!,
      // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
      targets[i]!,
      doc,
      slotContext?.slotsObj,
      slotContext?.capturedParentOwner,
    )
  }

  // 4. Snapshot all fragment children BEFORE inserting (after insert the fragment is empty).
  //    Multi-root templates are fully supported — all roots are tracked for cleanup.
  const roots = Array.from(frag.childNodes)
  if (roots.length === 0) {
    throw new Error('[nv/interpreter] Template produced an empty fragment')
  }

  if (before !== null) {
    parent.insertBefore(frag, before)
  } else {
    parent.appendChild(frag)
  }

  // roots are now in parent. Return all of them so callers can remove every node on teardown.
  return { roots }
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
    const { roots } = mountFragment(ir, parent, doc)
    if (ir.styleArtifact) {
      if (roots.length > 1) {
        throw new Error('[nv/interpreter] $style on multi-root template is not supported')
      }
      if (ir.styleArtifact.staticCss) {
        injectComponentStyle(doc, ir.styleArtifact.scopeHash, ir.styleArtifact.staticCss)
      }
      const scopeAttr = `data-nv-s-${ir.styleArtifact.scopeHash}`
      const root = roots[0]
      if (root instanceof Element) root.setAttribute(scopeAttr, '')
    }
    onCleanup(() => {
      // Remove ALL mounted root nodes from parent (multi-root template support).
      for (const n of roots) {
        if (n.parentNode !== null) n.parentNode.removeChild(n)
      }
    })
    return dispose
  })
}
