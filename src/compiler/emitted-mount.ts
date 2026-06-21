/**
 * nv Compiler Back-End — Phase 1b (Text/Attr/Prop/Event/Child/Conditional)
 * Stream:   (2) compiler / (3) renderer seam
 * Spec:     Phase 1b-1 (2026-06-19) + Phase 1b-2 (Child/Conditional)
 * Consumes: Phase 1a verdicts (BindingErasureVerdict)
 *
 * "Compiler = interpreter partially evaluated" (Invariant BE, IR v0.2 §6.2):
 *   EMIT TIME: resolve IR walk, binding-kind dispatch, and NodePath traversals
 *     into specialized WireSpec closures. ConditionalBinding branches are
 *     recursively emitted at emit time via emitSetup().
 *   MOUNT TIME: one cloneNode + two-phase setup (resolve all nodes, then wire
 *     all bindings). No IR traversal, no per-kind dispatch, no walkPath.
 *
 * Structural design (required for ConditionalBinding):
 *   emitSetup(ir, verdicts) → { setup: SetupFn, diagnostics }
 *     Sets up wiring within the CURRENT reactive scope (no createRoot).
 *     Used by ConditionalBinding to mount branches inside their own branch root.
 *   emitMount(ir, verdicts) → EmitResult
 *     Wraps emitSetup in a createRoot — the public API matching interpreter mount().
 *
 * Two-phase mount (load-bearing — matches interpreter's mountFragment):
 *   Phase 1: resolve ALL target nodes before any DOM mutation.
 *   Phase 2: wire all bindings with pre-resolved targets.
 *   TextBinding replaces its comment target; ChildBinding inserts before its anchor.
 *   Resolving paths after those mutations would corrupt sibling-path lookups.
 *
 * Carry-forward rules from 1b-1:
 *   - Direct-capture closures: capture expr/name/condition directly, NOT the binding object.
 *   - DECLINE verdict: diagnostic collected + binding still wired (correctness preserved).
 *   - PLAIN verdict: wired identically to ACCEPT (effect always created, no skip).
 *   - No core.ts change. Emitted code calls createRoot/effect/onCleanup only.
 *   - List/Sync bindings: throw at emit time.
 */

import { createRoot, effect, getOwner, onCleanup, runWithOwner, signal } from '../core/core.js'
import type {
  Binding,
  ComponentBinding,
  NodePath,
  ReactiveExpr,
  SlotOutletBinding,
  TemplateIR,
} from '../renderer/ir.js'
import type { BindingErasureVerdict } from './types.js'

// ── Node accessor — path partially evaluated at emit time ─────────────────────

type NodeAccessor = (frag: DocumentFragment) => Node

/**
 * Specialize a NodePath into a direct traversal closure.
 * Path indices captured at emit time; traversal at mount time avoids walkPath.
 */
function makeNodeAccessor(path: NodePath): NodeAccessor {
  const steps = Array.from(path)
  if (steps.length === 0) return (frag) => frag
  return (frag: DocumentFragment): Node => {
    let n: Node = frag
    for (let i = 0; i < steps.length; i++) {
      const idx = steps[i] as number
      const child = n.childNodes[idx]
      if (child === undefined) {
        throw new Error(
          `[nv/emit] path step ${i}: no child at index ${idx} (node has ${n.childNodes.length} children). Path: [${steps.join(', ')}]`,
        )
      }
      n = child
    }
    return n
  }
}

// ── WireSpec — all emit-time state for one binding ────────────────────────────

type WireSpec = {
  /** Specialized accessor for this binding's target node — no walkPath at mount time. */
  readonly accessor: NodeAccessor
  /**
   * Wiring closure resolved at emit time; called in Phase 2 with the pre-resolved
   * target node. All binding fields (expr, name, condition, etc.) captured directly
   * at emit time — never the binding object itself (carry-forward direct-capture rule).
   */
  readonly wire: (targetNode: Node, doc: Document) => void
}

// ── SetupFn — internal mount primitive ───────────────────────────────────────

/**
 * Internal: mount a template fragment within the CURRENT reactive scope.
 * Does NOT createRoot — effects are owned by whatever root is active when called.
 * Used by ConditionalBinding to mount branches inside their branch createRoot.
 *
 * Returns ALL child nodes of the inserted fragment (for onCleanup DOM removal).
 * Multi-root templates are fully supported.
 */
type SetupFn = (parent: Node, doc: Document, before: Node | null) => { roots: Node[] }

// ── Emit result ───────────────────────────────────────────────────────────────

export interface EmitResult {
  /**
   * The specialized mount function — identical contract to interpreter mount(ir, parent, doc).
   * Effects enqueued but not yet run; caller must flushSync() before asserting DOM.
   * Returns a disposer: runs cleanups (DOM removal) + severs all reactive edges.
   * Idempotent via the runtime's isDisposed guard.
   */
  mountFn: (parent: Element, doc: Document) => () => void
  /**
   * Diagnostics from DECLINE verdicts (sync-target write conflicts, per Phase 1a).
   * The binding is still wired (correctness preserved) — diagnostic only.
   */
  diagnostics: ReadonlyArray<string>
}

// ── Core emitter (recursive) ──────────────────────────────────────────────────

/**
 * Resolve the IR into a SetupFn at emit time.
 *
 * Called at emit time — synchronously — to pre-resolve the IR walk, per-kind
 * dispatch, and NodePath traversals into WireSpecs. For ConditionalBinding, the
 * branch templates are recursively emitted at emit time; branch verdicts use an
 * empty map (branch pathIndices are independent of the outer template's).
 *
 * The returned setup function, when called at mount time within a reactive scope,
 * clones the shape, resolves all target nodes (Phase 1), wires all bindings
 * (Phase 2), inserts the fragment, and returns the first child for cleanup.
 */
function emitSetup(
  ir: TemplateIR,
  verdicts: ReadonlyMap<number, BindingErasureVerdict>,
  slotContext?: {
    slotsObj: Record<string, TemplateIR>
    capturedParentOwner: ReturnType<typeof getOwner>
  },
): { setup: SetupFn; diagnostics: string[] } {
  const shapeHtml = ir.shape.html
  const diagnostics: string[] = []
  const wireSpecs: WireSpec[] = []

  for (const binding of ir.bindings) {
    const path = ir.shape.bindingPaths[binding.pathIndex]
    if (path === undefined) {
      throw new Error(`[nv/emit] No path for binding at pathIndex ${binding.pathIndex}`)
    }

    const accessor = makeNodeAccessor(path)

    // Collect DECLINE diagnostics. Binding still wired regardless (soundness invariant).
    const verdict = verdicts.get(binding.pathIndex)
    if (verdict?.kind === 'DECLINE') {
      diagnostics.push(verdict.diagnostic)
    }

    switch (binding.kind) {
      case 'text': {
        const expr = binding.expr
        wireSpecs.push({
          accessor,
          wire(commentNode, doc) {
            const parent = commentNode.parentNode
            if (parent === null) throw new Error('[nv/emit] TextBinding: comment has no parent')
            const textNode = doc.createTextNode('')
            parent.replaceChild(textNode, commentNode)
            effect(() => {
              const v = expr()
              textNode.data = v == null ? '' : String(v)
            })
          },
        })
        break
      }

      case 'attr': {
        const name = binding.name
        const expr = binding.expr
        wireSpecs.push({
          accessor,
          wire(targetNode) {
            const el = targetNode as Element
            effect(() => {
              const v = expr()
              if (v == null || v === false) el.removeAttribute(name)
              else el.setAttribute(name, v === true ? '' : String(v))
            })
          },
        })
        break
      }

      case 'prop': {
        const name = binding.name
        const expr = binding.expr
        wireSpecs.push({
          accessor,
          wire(targetNode) {
            const el = targetNode as Element
            effect(() => {
              ;(el as unknown as Record<string, unknown>)[name] = expr()
            })
          },
        })
        break
      }

      case 'event': {
        const eventName = binding.eventName
        const handler = binding.handler
        const options = binding.options
        wireSpecs.push({
          accessor,
          wire(targetNode) {
            const el = targetNode as Element
            let current: ((e: Event) => void) | null = null
            const listener = (e: Event): void => {
              if (current !== null) current(e)
            }
            effect(() => {
              current = handler()
            })
            el.addEventListener(eventName, listener, options)
            onCleanup(() => el.removeEventListener(eventName, listener, options))
          },
        })
        break
      }

      case 'child': {
        // Direct-capture: capture expr at emit time, never the binding object.
        // Interpreter semantics (ground truth):
        //   - Insert a text node BEFORE the anchor comment (not replace).
        //   - Update = mutate textNode.data, never node-replace.
        //   - Non-primitive values: throw identically to interpreter (v0 spec).
        const expr = binding.expr
        wireSpecs.push({
          accessor,
          wire(anchorNode, doc) {
            const parent = anchorNode.parentNode
            if (parent === null) throw new Error('[nv/emit] ChildBinding: anchor has no parent')

            const textNode = doc.createTextNode('')
            parent.insertBefore(textNode, anchorNode)
            onCleanup(() => {
              if (textNode.parentNode !== null) textNode.parentNode.removeChild(textNode)
            })

            effect(() => {
              const v = expr()
              if (v !== null && v !== undefined && typeof v === 'object') {
                throw new Error(
                  `[nv/emit] v0: ChildBinding received non-primitive value (${Object.prototype.toString.call(v)}). DOM Node / TemplateIR values are designed but not yet implemented. Expected: string | number | null | undefined.`,
                )
              }
              textNode.data = v == null ? '' : String(v)
            })
          },
        })
        break
      }

      case 'conditional': {
        // Recursively emit branch templates at emit time.
        // Branch verdicts use an empty map: branch bindings have independent pathIndices
        // and would receive wrong verdicts if the outer map were passed through.
        const emptyVerdicts = new Map<number, BindingErasureVerdict>()

        const { setup: consequentSetup, diagnostics: cDiags } = binding.consequent
          ? emitSetup(binding.consequent, emptyVerdicts)
          : { setup: null, diagnostics: [] as string[] }

        const { setup: alternateSetup, diagnostics: aDiags } = binding.alternate
          ? emitSetup(binding.alternate, emptyVerdicts)
          : { setup: null, diagnostics: [] as string[] }

        // Bubble any branch diagnostics upward.
        for (const d of cDiags) diagnostics.push(d)
        for (const d of aDiags) diagnostics.push(d)

        // Direct-capture: condition, branch setup fns. Never the binding object.
        const condition = binding.condition

        wireSpecs.push({
          accessor,
          wire(anchorNode, doc) {
            // Interpreter semantics (ground truth, wireConditional):
            //   - condition effect: dispose old branch → mount new branch in its OWN createRoot
            //   - branch root onCleanup: removes branch DOM
            //   - condition effect onCleanup: disposes branch (bridge for parent teardown)
            // The emitted structure must produce the SAME owner-tree shape or
            // flip-no-leak (gate case 4, 1000 flips) will diverge.
            const parent = anchorNode.parentNode
            if (parent === null) {
              throw new Error('[nv/emit] ConditionalBinding: anchor has no parent')
            }

            let branchDisposer: (() => void) | null = null

            effect(() => {
              // Dispose previous branch before mounting new one.
              if (branchDisposer !== null) {
                branchDisposer()
                branchDisposer = null
              }

              const branchSetup = condition() ? consequentSetup : alternateSetup
              if (branchSetup === null) return

              // Mount branch in its own root scope.
              // The branch's effects are owned by the branch root, NOT by this
              // condition effect — so flipping the condition disposes only the branch.
              branchDisposer = createRoot((dispose) => {
                const { roots } = branchSetup(parent, doc, anchorNode)
                onCleanup(() => {
                  for (const n of roots) {
                    if (n.parentNode !== null) n.parentNode.removeChild(n)
                  }
                })
                return dispose
              })

              // Bridge: if THIS condition effect is disposed (parent region teardown),
              // propagate disposal to the current branch.
              onCleanup(() => {
                if (branchDisposer !== null) {
                  branchDisposer()
                  branchDisposer = null
                }
              })
            })
          },
        })
        break
      }

      case 'list': {
        // Direct-capture: items, key, itemTemplate factory captured at emit time.
        const items = binding.items
        const keyFn = binding.key
        const makeItemTemplate = binding.itemTemplate
        // Item templates are emitted dynamically per item (per-item signals aren't
        // known at emit time), so pass empty verdicts to the per-item emitSetup call.
        const listEmptyVerdicts = new Map<number, BindingErasureVerdict>()

        wireSpecs.push({
          accessor,
          wire(anchorNode, doc) {
            const parent = anchorNode.parentNode
            if (parent === null) throw new Error('[nv/emit] ListBinding: anchor has no parent')

            const listOwner = getOwner()

            type EmitItemRecord = {
              valueSig: ReturnType<typeof signal<unknown>>
              indexSig: ReturnType<typeof signal<number>>
              lastValue: unknown
              lastIndex: number
              rootEl: Node
              dispose: () => void
            }
            const records = new Map<string | number, EmitItemRecord>()

            effect(() => {
              const next = items()

              const nextKeys = new Map<string | number, number>()
              for (let i = 0; i < next.length; i++) {
                // biome-ignore lint/style/noNonNullAssertion: bounded by next.length
                const item = next[i]!
                const k = keyFn(item, i)
                if (nextKeys.has(k)) {
                  throw new Error(
                    `[nv/emit] ListBinding: duplicate key "${String(k)}" at index ${i}`,
                  )
                }
                nextKeys.set(k, i)
              }

              for (const [k, rec] of records) {
                if (!nextKeys.has(k)) {
                  rec.dispose()
                  records.delete(k)
                }
              }

              for (let i = 0; i < next.length; i++) {
                // biome-ignore lint/style/noNonNullAssertion: bounded by next.length
                const item = next[i]!
                const k = keyFn(item, i)
                const existing = records.get(k)

                if (existing === undefined) {
                  const valueSig = signal<unknown>(item)
                  const indexSig = signal<number>(i)
                  let mountedRoot!: Node

                  const dispose = runWithOwner(listOwner, () =>
                    createRoot((d) => {
                      const itemIR = makeItemTemplate(valueSig, indexSig)
                      const { setup } = emitSetup(itemIR, listEmptyVerdicts)
                      const { roots } = setup(parent, doc, anchorNode)
                      if (roots.length !== 1) {
                        throw new Error(
                          '[nv] Multi-root list items are not supported in v1. Wrap the item template in a single root element.',
                        )
                      }
                      mountedRoot = roots[0] as Node
                      onCleanup(() => {
                        if (mountedRoot.parentNode !== null)
                          mountedRoot.parentNode.removeChild(mountedRoot)
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
                  if (!Object.is(existing.lastValue, item)) {
                    existing.valueSig.set(item)
                    existing.lastValue = item
                  }
                  if (existing.lastIndex !== i) {
                    existing.indexSig.set(i)
                    existing.lastIndex = i
                  }
                }
              }

              let ref: Node = anchorNode
              for (let i = next.length - 1; i >= 0; i--) {
                // biome-ignore lint/style/noNonNullAssertion: bounded by next.length
                const k = keyFn(next[i]!, i)
                // biome-ignore lint/style/noNonNullAssertion: key inserted/existed above
                const rec = records.get(k)!
                if (rec.rootEl.nextSibling !== ref) {
                  parent.insertBefore(rec.rootEl, ref)
                }
                ref = rec.rootEl
              }
            })

            onCleanup(() => {
              for (const rec of records.values()) rec.dispose()
              records.clear()
            })
          },
        })
        break
      }

      case 'component': {
        // Direct-capture: component factory + prop/slot entries. Never the binding object.
        const emptyVerdicts = new Map<number, BindingErasureVerdict>()
        const componentFactory = binding.component
        const propEntries = binding.props
        const slotEntries = binding.slots

        wireSpecs.push({
          accessor,
          wire(anchorNode, doc) {
            const parent = anchorNode.parentNode
            if (parent === null) throw new Error('[nv/emit] ComponentBinding: anchor has no parent')

            // Build PropsObject from captured propEntries.
            const propsObj: Record<string, ReactiveExpr> = {}
            for (const p of propEntries) {
              propsObj[p.name] = p.expr
            }

            // Build slotsObj: pass slot TemplateIRs through to the factory.
            const slotsObj: Record<string, TemplateIR> = {}
            for (const s of slotEntries) {
              slotsObj[s.name] = s.content
            }

            // Capture parent owner BEFORE child's createRoot (D-slot-1).
            const capturedParentOwner = getOwner()

            const childDisposer = createRoot((dispose) => {
              const childIR = componentFactory(propsObj, slotsObj)
              const childSlotContext = { slotsObj, capturedParentOwner }
              const { setup: childSetup } = emitSetup(childIR, emptyVerdicts, childSlotContext)
              const { roots } = childSetup(parent, doc, anchorNode)
              onCleanup(() => {
                for (const n of roots) {
                  if (n.parentNode !== null) n.parentNode.removeChild(n)
                }
              })
              return dispose
            })

            onCleanup(() => childDisposer())
          },
        })
        break
      }

      case 'slot-outlet': {
        // slotContext is captured from the emitSetup closure (set when called from case 'component').
        const slotName = (binding as SlotOutletBinding).name

        wireSpecs.push({
          accessor,
          wire(anchorNode, doc) {
            if (!slotContext) return // no slot context = unfilled
            const slotIR = slotContext.slotsObj[slotName]
            if (slotIR === undefined) return // unfilled slot: render nothing

            const parent = anchorNode.parentNode
            if (parent === null)
              throw new Error('[nv/emit] SlotOutletBinding: anchor has no parent')

            runWithOwner(slotContext.capturedParentOwner, () => {
              const slotDisposer = createRoot((dispose) => {
                const emptyVerdicts = new Map<number, BindingErasureVerdict>()
                const { setup: slotSetup } = emitSetup(slotIR, emptyVerdicts)
                const { roots } = slotSetup(parent, doc, anchorNode)
                onCleanup(() => {
                  for (const n of roots) {
                    if (n.parentNode !== null) n.parentNode.removeChild(n)
                  }
                })
                return dispose
              })
              onCleanup(() => slotDisposer())
            })
          },
        })
        break
      }

      default: {
        const kind = (binding as Binding).kind
        throw new Error(
          `[nv/emit] Binding kind '${kind}' is not implemented. SyncBinding is deferred.`,
        )
      }
    }
  }

  // ── The setup function — called at mount time within a reactive scope ──────
  const setup: SetupFn = (parent, doc, before) => {
    // One cloneNode of the static shape — same as interpreter.
    const tmpl = doc.createElement('template')
    tmpl.innerHTML = shapeHtml
    const frag = tmpl.content.cloneNode(true) as DocumentFragment

    // PHASE 1: Resolve ALL target nodes before any DOM mutation.
    // Load-bearing: TextBinding replaces its comment target; ChildBinding inserts
    // before its anchor. Both happen in Phase 2. Resolving paths after those
    // mutations could corrupt sibling-path lookups that share the same parent.
    const targets: Node[] = wireSpecs.map(({ accessor }) => accessor(frag))

    // PHASE 2: Wire each binding with its pre-resolved target.
    // No IR traversal, no per-kind dispatch, no walkPath — resolved at emit time.
    for (let i = 0; i < wireSpecs.length; i++) {
      wireSpecs[i]?.wire(targets[i] as Node, doc)
    }

    // Snapshot all fragment children BEFORE inserting (after insert the fragment is empty).
    // Multi-root templates are fully supported — all roots are tracked for cleanup.
    const roots = Array.from(frag.childNodes)
    if (roots.length === 0) throw new Error('[nv/emit] Template produced an empty fragment')

    if (before !== null) parent.insertBefore(frag, before)
    else parent.appendChild(frag)

    return { roots }
  }

  return { setup, diagnostics }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Emit a specialized mount function for the given TemplateIR.
 *
 * Wraps emitSetup in a createRoot to produce the public EmitResult.
 * The mountFn has the same contract as interpreter mount(ir, parent, doc).
 */
export function emitMount(
  ir: TemplateIR,
  verdicts: ReadonlyMap<number, BindingErasureVerdict> = new Map(),
): EmitResult {
  const { setup, diagnostics } = emitSetup(ir, verdicts)

  const mountFn = (parent: Element, doc: Document): (() => void) => {
    return createRoot((dispose) => {
      const { roots } = setup(parent, doc, null)
      onCleanup(() => {
        for (const n of roots) {
          if (n.parentNode !== null) n.parentNode.removeChild(n)
        }
      })
      return dispose
    })
  }

  return { mountFn, diagnostics }
}
