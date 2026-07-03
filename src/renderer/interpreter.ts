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
  harvestInertChildren,
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
  RecycledListBinding,
  SlotContent,
  SlotOutletBinding,
  StyleVarBinding,
  SwitchBinding,
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
    case 'switch': {
      wireSwitch(binding, targetNode, doc)
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
    case 'recycled-list': {
      // wireRecycledList is the HWM-pooling implementation (Follow-up B', collapsed
      // from a separate wireRecycledListHWM prototype — see decision log). The
      // optional 4th (onPoolReady) param is test-only introspection, unused here.
      wireRecycledList(binding, targetNode, doc)
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

type RecycledRecord = {
  valueSig: WritableSignal<unknown>
  indexSig: WritableSignal<number>
  rootEl: Node
  dispose: () => void
}

type ItemRecord = {
  valueSig: WritableSignal<unknown>
  indexSig?: WritableSignal<number> // absent when elided (itemReadsIndex === false)
  lastValue: unknown
  lastIndex?: number // absent when elided (itemReadsIndex === false)
  rootEl: Node
  dispose: () => void
}

function wireList(binding: ListBinding, anchorNode: Node, doc: Document): void {
  // Anchor is a Comment node; items are inserted before it (same pattern as ChildBinding).
  const parent = anchorNode.parentNode
  if (parent === null) {
    throw new Error('[nv/interpreter] ListBinding: anchor has no parent')
  }

  // Decide once per list instance whether this list reads the index signal.
  // This is FIXED per binding — not re-evaluated on each reconcile.
  const readsIndex = binding.itemReadsIndex !== false
  // Hoist the index-update closure out of the per-row loop.
  // For elided lists (readsIndex === false) this is a no-op — no compare, no field write, no .set().
  const updateIndex = readsIndex
    ? (rec: ItemRecord, i: number) => {
        if (rec.lastIndex !== i) {
          // biome-ignore lint/style/noNonNullAssertion: indexSig is allocated when readsIndex === true
          rec.indexSig!.set(i)
          rec.lastIndex = i
        }
      }
    : (_rec: ItemRecord, _i: number) => {}

  const records = new Map<string | number, ItemRecord>()

  // Capture the outer owner (the mount region's createRoot scope) so item roots can be
  // created as its CHILDREN rather than as children of the reconcile effect. If item
  // roots were children of the reconcile effect, preRunCleanup would dispose them on every
  // re-run, destroying per-item reactive signals before op 3/4 could update them.
  const listOwner = getOwner()

  // Tracks the key sequence from the previous reconcile in DOM order.
  // Map insertion order never reorders, so this must be maintained separately.
  let prevKeys: Array<string | number> = []
  // Tracks the item array from the previous reconcile; enables reference-compare in prefix/suffix skip (Task 2).
  let prevItems: readonly unknown[] = []
  const pendingSweep: Array<ReturnType<typeof getOwner>> = []

  effect(() => {
    const next = binding.items() // the only tracked read in this effect

    // prevKeys holds the key sequence as it was after the last reconcile (= current DOM order).
    // Used by the LIS ordering pass to derive each kept node's prior relative position.
    const prevKeyOrder = prevKeys

    // Compute nextKeys once — reused by collision check, Op 2 lookup, pos[] build, and reverse-walk.
    // A parallel collision-check Set is built in the same pass so duplicate detection stays O(n).
    const nextKeys: Array<string | number> = new Array(next.length)
    const nextKeySet = new Set<string | number>()
    for (let i = 0; i < next.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by next.length
      const item = next[i]!
      const k = binding.key(item, i)
      if (nextKeySet.has(k)) {
        throw new Error(`[nv/interpreter] ListBinding: duplicate key "${String(k)}" at index ${i}`)
      }
      nextKeys[i] = k
      nextKeySet.add(k)
    }

    // Band computation: skip unchanged prefix and suffix rows (key AND reference must match).
    // A key-only skip would silently drop content updates (new object, same key).
    let start = 0
    const minLen = Math.min(prevKeys.length, nextKeys.length)
    while (
      start < minLen &&
      prevKeys[start] === nextKeys[start] &&
      prevItems[start] === next[start]
    )
      start++
    let prevEnd = prevKeys.length - 1
    let nextEnd = nextKeys.length - 1
    while (
      prevEnd >= start &&
      nextEnd >= start &&
      prevKeys[prevEnd] === nextKeys[nextEnd] &&
      prevItems[prevEnd] === next[nextEnd]
    ) {
      prevEnd--
      nextEnd--
    }

    // Capture the active element before any DOM mutations (Op 2 removes nodes, blurring focus).
    // If the focused element is inside a row being deleted, we restore focus to a sibling row.
    const activeBefore = doc.activeElement as HTMLElement | null

    // Op 2: remove stale records — only band rows can be absent from next.
    // Prefix/suffix keys are present in next by construction (they matched key+ref above).
    for (let bi = start; bi <= prevEnd; bi++) {
      // biome-ignore lint/style/noNonNullAssertion: bi is within prevKeys bounds
      const k = prevKeys[bi]!
      if (!nextKeySet.has(k)) {
        // biome-ignore lint/style/noNonNullAssertion: key was in records from prior reconcile
        records.get(k)!.dispose()
        records.delete(k)
      }
    }

    // Focus fallback: if the focused element was inside a disposed row, restore focus.
    // The disposed element is no longer connected; find the nearest surviving row in DOM order.
    if (activeBefore !== null && !activeBefore.isConnected) {
      // Sort surviving connected rows by DOM position (document order) and pick the first.
      const survivors = [...records.values()].filter((r) => r.rootEl.isConnected)
      survivors.sort((a, b) =>
        a.rootEl.compareDocumentPosition(b.rootEl) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
      const target = survivors[0]
      if (target !== undefined && typeof (target.rootEl as HTMLElement).focus === 'function') {
        ;(target.rootEl as HTMLElement).focus()
      } else if (typeof (parent as HTMLElement).focus === 'function') {
        // Fall back to the list container (parent), then document.body.
        ;(parent as HTMLElement).focus()
      } else {
        doc.body?.focus()
      }
    }

    // Ops 1/3/4: create new items; update value/index for kept items (band only).
    // Prefix rows are reference-identical and at the same absolute positions → no update needed.
    // Suffix rows are reference-identical in value but their absolute positions shift when the
    // band inserts or removes rows; index updates are handled after this loop.
    for (let i = start; i <= nextEnd; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by next.length
      const item = next[i]!
      // biome-ignore lint/style/noNonNullAssertion: nextKeys[i] set in the pass above
      const k = nextKeys[i]!
      const existing = records.get(k)

      if (existing === undefined) {
        // Op 1: new key — create per-item signals and a dedicated root scope.
        // runWithOwner(listOwner) ensures the item root is a sibling of the reconcile
        // effect (child of the outer mount scope), not a child of the reconcile effect.
        // This prevents preRunCleanup from disposing item roots on every reconcile re-run.
        const valueSig = signal<unknown>(item)
        const indexSig = readsIndex ? signal<number>(i) : undefined
        let mountedRoot!: Node

        let itemRootOwner: ReturnType<typeof getOwner> = null
        const dispose = runWithOwner(listOwner, () =>
          createRoot((d) => {
            itemRootOwner = getOwner()
            const itemIR = readsIndex
              ? binding.itemTemplate(valueSig, indexSig)
              : binding.itemTemplate(valueSig)
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
          indexSig, // undefined when elided
          lastValue: item,
          lastIndex: readsIndex ? i : undefined, // undefined when elided
          rootEl: mountedRoot,
          dispose,
        })
        if (itemRootOwner !== null) pendingSweep.push(itemRootOwner)
      } else {
        // Op 3: value changed (immutable-item contract; compare by reference, not valueSig() read)
        // NOT reading valueSig() here — that would subscribe the reconcile effect to per-item
        // signals, creating a dependency that re-runs reconcile on every item value change.
        if (!Object.is(existing.lastValue, item)) {
          existing.valueSig.set(item)
          existing.lastValue = item
        }
        // Op 4: index changed — delegate to hoisted updateIndex closure (no per-row branch)
        updateIndex(existing, i)
      }
    }

    // Suffix index fixup: suffix rows keep their values (reference-identical) but their
    // absolute positions shift by (nextEnd - prevEnd) when the band inserts or removes rows.
    // Prefix rows are always at positions 0..start-1 on both sides — no fixup needed.
    if (readsIndex && nextEnd !== prevEnd) {
      for (let i = nextEnd + 1; i < next.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: i is within nextKeys bounds
        const suffixKey = nextKeys[i]!
        const rec = records.get(suffixKey)
        if (rec) updateIndex(rec, i)
      }
    }

    // DOM ordering: LIS-Ivi move-minimization.
    // Keeps the longest stable subsequence of kept nodes in place; only nodes
    // outside the LIS (and newly-mounted nodes) are repositioned with insertBefore.
    // A jfb swap (index 1 ↔ n-2) costs 2 moves instead of ~N.
    //
    // Position source: prevKeyOrder (snapshot taken at top of this effect, before
    // Op 2/1 mutate records). Maps each key → its prior relative index in records.
    // New keys (Op 1) have no prior index — they are never in the stable run.

    // Build prev-index map from the snapshot.
    const prevIndex = new Map<string | number, number>()
    for (let i = 0; i < prevKeyOrder.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by prevKeyOrder.length
      prevIndex.set(prevKeyOrder[i]!, i)
    }

    // For each band position in next, record its previous index (-1 = new key, always moved).
    // Only band rows need ordering; prefix/suffix are already in place.
    const n = next.length
    const pos = new Array<number>(n)
    for (let i = start; i <= nextEnd; i++) {
      // biome-ignore lint/style/noNonNullAssertion: nextKeys[i] set in the first pass above
      pos[i] = prevIndex.get(nextKeys[i]!) ?? -1
    }

    // O(n log n) patience-sort LIS over band portion of pos[], ignoring new keys (pos === -1).
    // tails[i] = smallest tail value of any increasing subsequence of length i+1.
    // pred[i] = predecessor index in next[] for reconstructing the LIS.
    const tails: number[] = []
    const tailIdx: number[] = [] // index into next[] for each tail
    const pred = new Array<number>(n).fill(-1)
    const posInLis = new Array<number>(n).fill(-1) // tails[] slot this next-position occupies

    for (let i = start; i <= nextEnd; i++) {
      const p = pos[i]
      if (p === undefined || p === -1) continue // new key — not eligible for stable run

      // Binary search for leftmost tail >= p
      let lo = 0
      let hi = tails.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        // biome-ignore lint/style/noNonNullAssertion: tails[mid] set above; mid is in-bounds by binary search
        if ((tails[mid] ?? 0) < p) lo = mid + 1
        else hi = mid
      }
      tails[lo] = p
      tailIdx[lo] = i
      posInLis[i] = lo
      if (lo > 0) {
        const prevTailIdx = tailIdx[lo - 1]
        if (prevTailIdx !== undefined) pred[i] = prevTailIdx
      }
    }

    // Reconstruct the LIS index set (indices into next[]).
    const lisSet = new Set<number>()
    const lastTailIdx = tailIdx[tails.length - 1]
    if (tails.length > 0 && lastTailIdx !== undefined) {
      let idx: number = lastTailIdx
      while (idx !== -1) {
        lisSet.add(idx)
        const nextIdx = pred[idx]
        if (nextIdx === undefined) break
        idx = nextIdx
      }
    }

    // Reverse walk: insertBefore band nodes NOT in the LIS that aren't already in position.
    // ref starts at the first DOM node of the suffix (prevKeyOrder[prevEnd+1]), or anchorNode
    // if there is no suffix. Suffix nodes are guaranteed still in records (matched key+ref above).
    const suffixStartKey = prevEnd + 1 < prevKeyOrder.length ? prevKeyOrder[prevEnd + 1] : undefined
    let ref: Node =
      suffixStartKey !== undefined
        ? // biome-ignore lint/style/noNonNullAssertion: suffix key was present in prev and unchanged
          records.get(suffixStartKey)!.rootEl
        : anchorNode

    // activeBefore was captured before Op-2 (above). Re-use it here for the DOM-move
    // focus-restore path (insertBefore blurs the element being relocated).
    let focusHostMoved: HTMLElement | null = null

    for (let i = nextEnd; i >= start; i--) {
      // biome-ignore lint/style/noNonNullAssertion: nextKeys[i] set in the first pass above
      const k = nextKeys[i]!
      // biome-ignore lint/style/noNonNullAssertion: key was just set above (op1) or existed
      const rec = records.get(k)!
      if (!lisSet.has(i) && rec.rootEl.nextSibling !== ref) {
        // Track whether the focused element is inside this node being moved.
        if (activeBefore !== null && focusHostMoved === null && rec.rootEl.contains(activeBefore)) {
          focusHostMoved = activeBefore
        }
        parent.insertBefore(rec.rootEl, ref)
      }
      ref = rec.rootEl
    }

    // Restore focus on the element that traveled with its keyed data node.
    if (focusHostMoved !== null && doc.activeElement !== focusHostMoved) {
      focusHostMoved.focus()
    }

    // Record the new DOM sequence and item array for the next reconcile.
    // Reuse already-computed nextKeys — avoids a redundant key pass + allocation.
    prevKeys = nextKeys
    prevItems = next

    // P-2c-A1: schedule post-flush harvest of inert per-binding effects.
    if (pendingSweep.length > 0) {
      const toSweep = pendingSweep.splice(0)
      queueMicrotask(() => {
        for (const owner of toSweep) harvestInertChildren(owner)
      })
    }
  })

  // Parent teardown: dispose all item roots when the list region unmounts (§6 cascade)
  onCleanup(() => {
    for (const rec of records.values()) rec.dispose()
    records.clear()
  })
}

/**
 * High-water-mark pooling for <recycle> (positional list), bounded by a cap. On
 * shrink, retains rows (detaches DOM, stops feeding signals) instead of disposing
 * immediately — but retained-inactive rows are capped at RETENTION_CAP_MULTIPLE x
 * the current active count; rows beyond the cap are disposed (evicted), not kept.
 * On regrow, retained slots within the cap are reused before allocating new ones.
 *
 * Retention (for rows within the cap) is sound only because nv's effects are
 * demand/change-driven: an unwritten signal drives no scheduler work, so a
 * detached, unfed row costs nothing at rest (verified against src/core/core.ts's
 * propagate/flush path, Follow-up B' semantics-fork ruling). If nv's effects ever
 * become eager or polling, this inertness guarantee breaks silently — this
 * function's correctness is coupled to that core scheduling semantic.
 *
 * The cap also bounds a second cost: a retained row whose item template reads an
 * EXTERNAL signal (not its own row signal) keeps a live, still-subscribed effect
 * that re-runs on every external write, even while detached — cost proportional
 * to retained-row count. The cap bounds this to RETENTION_CAP_MULTIPLE x active
 * count rather than the historical high-water-mark (Gate-P ruling: bounding, not
 * quiescing, resolves this — genuine quiescing would require threading an active-
 * gate through the generic binding-wiring machinery, a materially larger change
 * this defect doesn't warrant).
 */
// B'-cap: retained-inactive rows are bounded to this multiple of the current
// active count (Gate-P ruling, docs/decision-log.md [2026-07-03]). A hypothesis
// to measure, not a locked constant — see Task 2 of the B'-cap plan for the
// win-retention measurement this value was chosen against.
const RETENTION_CAP_MULTIPLE = 2

export function wireRecycledList(
  binding: RecycledListBinding,
  anchorNode: Node,
  doc: Document,
  onPoolReady?: (pool: readonly RecycledRecord[]) => void,
): void {
  const parent = anchorNode.parentNode
  if (parent === null) {
    throw new Error('[nv/interpreter] RecycledListBinding (HWM): anchor has no parent')
  }

  const pool: RecycledRecord[] = []
  onPoolReady?.(pool)
  let activeCount = 0
  const listOwner = getOwner()

  effect(() => {
    const next = binding.items()
    const N = next.length
    const P = pool.length

    // Rebind already-active slots that remain active — pure Op-3, unchanged.
    const rebindCount = Math.min(N, activeCount)
    for (let i = 0; i < rebindCount; i++) {
      // biome-ignore lint/style/noNonNullAssertion: i < activeCount <= pool.length
      const rec = pool[i]!
      rec.valueSig.set(next[i])
      rec.indexSig.set(i)
    }

    if (N > activeCount) {
      // Reuse retained-inactive slots [activeCount, min(N,P)) before allocating.
      // activeCount is committed per-iteration (not once after the loop): if a
      // reuse or allocation throws partway through (e.g. the itemTemplate below
      // throws — the reactive core swallows this via routeErrorFrom and does not
      // propagate it out of flushSync, so the caller never sees it), activeCount
      // must reflect exactly what was actually committed so far. Committing only
      // after the whole loop would leave activeCount understating the real DOM
      // state on a partial failure — later resizes would then be unable to tell
      // which rows are genuinely active, leaving the ones the failed run did
      // manage to create permanently un-reclaimable (they'd never fall inside
      // any future shrink's [N, activeCount) range).
      const reuseEnd = Math.min(N, P)
      for (let i = activeCount; i < reuseEnd; i++) {
        // biome-ignore lint/style/noNonNullAssertion: i < P = pool.length, in-bounds
        const rec = pool[i]!
        rec.valueSig.set(next[i])
        rec.indexSig.set(i)
        parent.insertBefore(rec.rootEl, anchorNode)
        activeCount = i + 1
      }

      // Allocate brand new slots [P, N) — mirrors wireRecycledList's grow path exactly.
      for (let i = P; i < N; i++) {
        const valueSig = signal<unknown>(next[i])
        const indexSig = signal<number>(i)
        let mountedRoot!: Node

        // biome-ignore lint/style/noNonNullAssertion: runWithOwner returns non-null when owner is non-null
        const dispose = runWithOwner(listOwner, () =>
          createRoot((d) => {
            const itemIR = binding.itemTemplate(valueSig, indexSig)
            const { roots } = mountFragment(itemIR, parent, doc, anchorNode)
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
              if (mountedRoot.parentNode !== null) mountedRoot.parentNode.removeChild(mountedRoot)
            })
            return d
          }),
        )!

        pool.push({ valueSig, indexSig, rootEl: mountedRoot, dispose })
        activeCount = pool.length
      }
    } else if (N < activeCount) {
      // Shrink: deactivate [N, activeCount) — detach DOM, stop feeding. DO NOT DISPOSE
      // deactivated rows outright — retain them up to the cap (see eviction below).
      for (let i = N; i < activeCount; i++) {
        // biome-ignore lint/style/noNonNullAssertion: i < activeCount <= pool.length
        const rec = pool[i]!
        if (rec.rootEl.parentNode !== null) rec.rootEl.parentNode.removeChild(rec.rootEl)
      }
      activeCount = N

      // B'-cap: bound retained-inactive rows to RETENTION_CAP_MULTIPLE x activeCount.
      // Evaluated fresh on every shrink (no floor, no history-smoothing — ruled
      // in-session at Gate-P; see this function's own history in git log for the
      // rationale, since it isn't recorded elsewhere). Eviction only needs to run
      // here, in the shrink branch — growth (whether it allocates or purely
      // reuses retained slots) can never violate the cap. Proof: after every
      // shrink, this line enforces pool.length <= 2*activeCount. Any later grow
      // to N' > activeCount can only RAISE the cap (2*N' > 2*activeCount >=
      // pool.length), so pool.length is always strictly below the new cap right
      // after a grow — whether or not that grow allocated fresh rows. (It is NOT
      // generally true that activeCount === pool.length after a grow — that only
      // holds when the grow required allocation; a pure-reuse grow into already-
      // retained slots leaves pool.length at its unchanged, larger value.)
      const maxPoolLength = N * RETENTION_CAP_MULTIPLE
      if (pool.length > maxPoolLength) {
        for (let i = maxPoolLength; i < pool.length; i++) {
          // biome-ignore lint/style/noNonNullAssertion: i < pool.length, in-bounds
          pool[i]!.dispose()
        }
        pool.length = maxPoolLength
      }
    }
  })

  onCleanup(() => {
    for (const rec of pool) rec.dispose()
    pool.length = 0
    activeCount = 0
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

// ── SwitchBinding ─────────────────────────────────────────────────────────────

function wireSwitch(binding: SwitchBinding, anchorNode: Node, doc: Document): void {
  // Anchor is a Comment node; branches mount before it. Direct generalization of
  // wireConditional: same single-effect/single-disposer pattern, N ordered branches
  // instead of 2, first-match-wins instead of boolean toggle.
  const parent = anchorNode.parentNode
  if (parent === null) {
    throw new Error('[nv/interpreter] SwitchBinding: anchor has no parent')
  }

  let branchDisposer: (() => void) | null = null

  effect(() => {
    if (branchDisposer !== null) {
      branchDisposer()
      branchDisposer = null
    }

    let template: TemplateIR | null = null
    for (const branch of binding.branches) {
      if (branch.when()) {
        template = branch.body
        break
      }
    }
    if (template === null) template = binding.fallback

    if (template === null) return

    branchDisposer = createRoot((dispose) => {
      const { roots } = mountFragment(template as TemplateIR, parent, doc, anchorNode)
      onCleanup(() => {
        for (const n of roots) {
          if (n.parentNode !== null) n.parentNode.removeChild(n)
        }
      })
      return dispose
    })

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
