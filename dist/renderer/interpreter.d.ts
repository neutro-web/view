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
import type { NodePath, TemplateIR } from './ir';
/**
 * Walk `path` from `root`, returning the node at that position.
 * Throws if any step in the path is out of bounds.
 */
export declare function walkPath(root: Node, path: NodePath): Node;
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
export declare function mount(ir: TemplateIR, parent: Element, doc: Document): () => void;
//# sourceMappingURL=interpreter.d.ts.map