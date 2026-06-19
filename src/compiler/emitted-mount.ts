/**
 * nv Compiler Back-End — Phase 1b-1: Emission (Text/Attr/Prop/Event slice)
 * Stream:   (2) compiler / (3) renderer seam
 * Spec:     Phase 1b spec 2026-06-19; Invariant BE (IR v0.2 §6.2)
 * Consumes: Phase 1a verdicts (BindingErasureVerdict from read-write-erasure-analyzer)
 *
 * Produces an in-memory executable — a specialized mount function — that is
 * observably equivalent to the interpreter's mount() on the same TemplateIR.
 * The differential gate (emitted vs. interpreter) is the proof.
 *
 * "Compiler = interpreter partially evaluated" (Invariant BE):
 *   - EMIT TIME: resolve IR walk, binding-kind dispatch, and NodePath traversals
 *     into specialized WireSpec closures. No IR or path data accessed at mount time.
 *   - MOUNT TIME: one cloneNode + two-phase setup (resolve all nodes, then wire all
 *     bindings) + call pre-emitted WireSpecs. No walkPath call, no per-kind switch.
 *
 * Two-phase mount (mirrors interpreter's mountFragment):
 *   Phase 1: resolve ALL target nodes from the cloned fragment (before any mutation).
 *   Phase 2: wire each binding with its pre-resolved target.
 *   Order is load-bearing: TextBinding replaces a Comment with a Text node; resolving
 *   paths after that mutation could corrupt adjacent binding paths that share a parent.
 *
 * Soundness invariants:
 *   1. DECLINE verdict → diagnostic collected + binding wired identically to interpreter.
 *      Never suppresses a binding. The diagnostic surfaces the conflict; the binding
 *      still works (the DOM is correct, the write is just not blessed).
 *   2. PLAIN verdict → wired identically to ACCEPT. PLAIN is an optimizer hint only;
 *      for 1b-1, it never changes wiring behavior. An effect is always created.
 *   3. Out-of-slice binding kinds (child, conditional, list, sync) → throw at EMIT time
 *      with a clear scope message. Not a silent wrong result at mount time.
 *   4. No core.ts change. Emitted code calls the existing public API only.
 *
 * Slice 1b-1 scope: TextBinding, AttrBinding, PropBinding, EventBinding.
 * Slice 1b-2 (follow-up): ChildBinding, ConditionalBinding (§6-heavy disposal).
 */

import { createRoot, effect, onCleanup } from '../core/core.js'
import type { Binding, NodePath, TemplateIR } from '../renderer/ir.js'
import type { BindingErasureVerdict } from './types.js'

// ── Node accessor — path partially evaluated at emit time ─────────────────────

type NodeAccessor = (frag: DocumentFragment) => Node

/**
 * Specialize a NodePath into a direct traversal closure.
 *
 * Emit time: the path indices are captured into the closure's scope.
 * Mount time: the returned function traverses those indices directly —
 * no call to the general-purpose walkPath(root, path) function, no IR-level
 * path lookup, no generic runtime `path` argument.
 *
 * For typical PoC template depths (1–3 levels), the per-step overhead is:
 * one array index read + one childNodes lookup, without the function-call cost
 * of walkPath or the IR-binding lookup of ir.shape.bindingPaths[b.pathIndex].
 */
function makeNodeAccessor(path: NodePath): NodeAccessor {
  const steps = Array.from(path) // capture at emit time
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
  /** Node accessor resolved at emit time — no walkPath at mount time. */
  readonly accessor: NodeAccessor
  /**
   * Wiring closure resolved at emit time. Called at mount time with the pre-resolved
   * target node. All binding info (expr, name, eventName, etc.) captured at emit time.
   */
  readonly wire: (targetNode: Node, doc: Document) => void
}

// ── Emit result ───────────────────────────────────────────────────────────────

export interface EmitResult {
  /**
   * The specialized mount function.
   * Identical contract to interpreter mount(ir, parent, doc):
   *   - Effects enqueued but not yet run. Caller must flushSync() before asserting DOM.
   *   - Returns a disposer. Calling it: runs cleanups (DOM removal) + severs all edges.
   *   - Idempotent via isDisposed guard.
   */
  mountFn: (parent: Element, doc: Document) => () => void
  /**
   * Diagnostics from DECLINE verdicts (sync-target write conflicts, per Phase 1a).
   * Empty when no verdicts are DECLINE. Never empty when a DECLINE is present.
   * The binding is still wired even for DECLINE — diagnostic only.
   */
  diagnostics: ReadonlyArray<string>
}

// ── Emitter ────────────────────────────────────────────────────────────────────

/**
 * Emit a specialized mount function for the given TemplateIR.
 *
 * Resolves the IR into a WireSpec array at emit time. The returned mountFn
 * does no IR traversal, no per-kind dispatch, no walkPath — only cloneNode +
 * two-phase setup using pre-resolved WireSpecs.
 *
 * @param ir       The TemplateIR to specialize.
 * @param verdicts Phase 1a verdicts keyed by pathIndex. DECLINE → diagnostic.
 *                 PLAIN → wired as ACCEPT (same effect, no change in behavior).
 */
export function emitMount(
  ir: TemplateIR,
  verdicts: ReadonlyMap<number, BindingErasureVerdict> = new Map(),
): EmitResult {
  const diagnostics: string[] = []
  const shapeHtml = ir.shape.html // captured at emit time; mount time never reads ir.shape

  // ── Emit time: resolve each binding → WireSpec ──────────────────────────────
  const wireSpecs: WireSpec[] = []

  for (const binding of ir.bindings) {
    const path = ir.shape.bindingPaths[binding.pathIndex]
    if (path === undefined) {
      throw new Error(`[nv/emit] No path for binding at pathIndex ${binding.pathIndex}`)
    }

    // Partially evaluate path → specialized accessor (no walkPath at mount time)
    const accessor = makeNodeAccessor(path)

    // Collect DECLINE diagnostics. Binding is still wired regardless.
    const verdict = verdicts.get(binding.pathIndex)
    if (verdict?.kind === 'DECLINE') {
      diagnostics.push(verdict.diagnostic)
    }

    switch (binding.kind) {
      case 'text': {
        // Capture expr at emit time. Wire creates textNode + effect at mount time.
        const expr = binding.expr
        wireSpecs.push({
          accessor,
          wire(commentNode, doc) {
            const parent = commentNode.parentNode
            if (parent === null) {
              throw new Error('[nv/emit] TextBinding: sentinel comment has no parent')
            }
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
        // Capture name + expr at emit time. No binding object in the closure.
        const name = binding.name
        const expr = binding.expr
        wireSpecs.push({
          accessor,
          wire(targetNode) {
            const el = targetNode as Element
            effect(() => {
              const v = expr()
              if (v == null || v === false) {
                el.removeAttribute(name)
              } else {
                el.setAttribute(name, v === true ? '' : String(v))
              }
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
        // DECLINE diagnostic already collected above. Binding wired normally.
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

      default: {
        // Out-of-scope binding kinds throw at EMIT TIME — not silently wrong at mount time.
        // Child/Conditional are slice 1b-2. ListBinding/SyncBinding are deferred.
        const kind = (binding as Binding).kind
        throw new Error(
          `[nv/emit] Binding kind '${kind}' is not in slice 1b-1 scope. ChildBinding/ConditionalBinding are in slice 1b-2; ListBinding/SyncBinding are deferred.`,
        )
      }
    }
  }

  // ── The specialized mount function — fully resolved above ────────────────────
  const mountFn = (parent: Element, doc: Document): (() => void) => {
    return createRoot((dispose) => {
      // One cloneNode of the static shape — same as interpreter.
      const tmpl = doc.createElement('template')
      tmpl.innerHTML = shapeHtml
      const frag = tmpl.content.cloneNode(true) as DocumentFragment

      // PHASE 1: Resolve ALL target nodes before any DOM mutation.
      // Load-bearing: TextBinding replaces its comment target; if adjacent bindings
      // share a parent, resolving their paths AFTER the replacement would find wrong
      // nodes. Matches the interpreter's mountFragment two-phase approach.
      const targets: Node[] = wireSpecs.map(({ accessor }) => accessor(frag))

      // PHASE 2: Wire each binding using the pre-resolved target node.
      // No IR walk, no per-kind dispatch, no walkPath — all resolved at emit time.
      for (let i = 0; i < wireSpecs.length; i++) {
        wireSpecs[i]?.wire(targets[i] as Node, doc)
      }

      const firstChild = frag.firstChild
      if (firstChild === null) {
        throw new Error('[nv/emit] Template produced an empty fragment')
      }

      parent.appendChild(frag)
      onCleanup(() => {
        if (firstChild.parentNode !== null) firstChild.parentNode.removeChild(firstChild)
      })

      return dispose
    })
  }

  return { mountFn, diagnostics }
}
