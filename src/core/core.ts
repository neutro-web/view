/**
 * nv Reactive Core — Runtime Implementation
 * Contract: nv-reactive-core-contract.md v0.4
 * Workstream: (1) Runtime — correctness phase, no perf tuning
 *
 * Key design points:
 *  §2       Single ReactiveNode struct, kind-distinguished (not class hierarchy)
 *  §9       Intrusive doubly-linked list edges; no Array/Set/Map in hot path
 *  §5       Iterative updateIfNecessary via _walkParent/_walkCursor temp fields
 *  §4       Iterative BFS propagate via _markNext temp field
 *  §8.7     Syncs drain before effects; up-walk handles intra-sync ordering
 *  §8.5.4   Cascade cap covers both sync and effect phases
 *  §10      Compiler hooks are inert stub fields in this phase
 */

// ============================================================================
// §3: State constants
// ============================================================================

const CLEAN = 0
const CHECK = 1
const DIRTY = 2
type State = 0 | 1 | 2

// ============================================================================
// §2: ReactiveNode kind constants
// ============================================================================

const KIND_SIGNAL = 0
const KIND_DERIVED = 1
const KIND_EFFECT = 2
const KIND_SYNC = 3

// ============================================================================
// §9: Intrusive edge (Link)
// Each Link lives simultaneously in:
//   • the observer's source list   (prevSource / nextSource)
//   • the source's observer list   (prevObserver / nextObserver)
// Add/remove is O(1) given the link pointer.
// ============================================================================

interface Link {
  source: ReactiveNode
  observer: ReactiveNode
  prevSource: Link | null
  nextSource: Link | null
  prevObserver: Link | null
  nextObserver: Link | null
}

function makeLink(source: ReactiveNode, observer: ReactiveNode): Link {
  return {
    source,
    observer,
    prevSource: null,
    nextSource: null,
    prevObserver: null,
    nextObserver: null,
  }
}

// ============================================================================
// §2.1: ReactiveNode struct — shared across all kinds, distinguished by `kind`
// ============================================================================

interface ReactiveNode {
  kind: 0 | 1 | 2 | 3

  // §3: state machine + orthogonal error flag (§5.4.2)
  state: State
  hasError: boolean
  isDisposed: boolean
  isScheduled: boolean // guards against double-enqueue in sync/effect queues

  value: unknown // Signal, Derived
  error: unknown // cached thrown value (§5.4.2)
  compute: ((...args: unknown[]) => unknown) | null // Derived, Effect, Sync

  // §9: intrusive edge lists
  firstSource: Link | null // head of "I read these" list
  lastSource: Link | null // tail (O(1) append)
  firstObserver: Link | null // head of "these nodes read me" list
  lastObserver: Link | null // tail

  // §7: per-node equality predicate
  equals: ((a: unknown, b: unknown) => boolean) | false

  // §6: ownership tree (intrusive)
  owner: ReactiveNode | null
  firstChild: ReactiveNode | null
  lastChild: ReactiveNode | null
  nextSibling: ReactiveNode | null
  prevSibling: ReactiveNode | null
  cleanups: Array<() => void> | null // cold path; Array OK per §9's intent

  // §5.4.4: error boundary
  errorHandler: ((e: unknown) => void) | null

  // §8.5: Sync-specific
  syncTarget: ReactiveNode | (() => unknown) | null
  externalUnsub: (() => void) | null

  // intrusive singly-linked list used by both sync and effect queues
  nextScheduled: ReactiveNode | null

  // §4: BFS mark-phase temp (zeroed after each propagation)
  _markNext: ReactiveNode | null

  // §5: iterative up-walk temp (zeroed when frame pops)
  _walkParent: ReactiveNode | null
  _walkCursor: Link | null

  // §10: compiler hook stubs — inert in this phase
  _compilerEquals?: ((a: unknown, b: unknown) => boolean) | false
  _compilerEager?: boolean
}

function makeNode(kind: 0 | 1 | 2 | 3): ReactiveNode {
  return {
    kind,
    state: CLEAN,
    hasError: false,
    isDisposed: false,
    isScheduled: false,
    value: undefined,
    error: undefined,
    compute: null,
    firstSource: null,
    lastSource: null,
    firstObserver: null,
    lastObserver: null,
    equals: Object.is,
    owner: null,
    firstChild: null,
    lastChild: null,
    nextSibling: null,
    prevSibling: null,
    cleanups: null,
    errorHandler: null,
    syncTarget: null,
    externalUnsub: null,
    nextScheduled: null,
    _markNext: null,
    _walkParent: null,
    _walkCursor: null,
  }
}

// ============================================================================
// §8: Global runtime state
// ============================================================================

let currentObserver: ReactiveNode | null = null // tracking context (§5.1)
let currentOwner: ReactiveNode | null = null // ownership context (§6)

// §8.7: Two queues — syncs drain before effects
let syncQHead: ReactiveNode | null = null
let syncQTail: ReactiveNode | null = null
let effQHead: ReactiveNode | null = null
let effQTail: ReactiveNode | null = null

// External sync entries: one per publish call.
// Can't be intrusive — same node may be queued multiple times (§8.7).
interface ExtEntry {
  node: ReactiveNode
  value: unknown
  next: ExtEntry | null
}
let extQHead: ExtEntry | null = null
let extQTail: ExtEntry | null = null

let batchDepth = 0
let flushScheduled = false
let flushRunning = false

const MAX_CASCADE = 100 // §8.5.4

// WeakMap from public Signal/Derived getter functions → underlying ReactiveNode.
// Used by sync() to resolve the target from a function reference.
const nodeForFn = new WeakMap<object, ReactiveNode>()

// Test-only instrumentation counter (§B1 fuzzer). Incremented in runRecompute.
let _recomputeCount = 0

// ── test-only per-node recompute instrumentation ──
// Enabled only by __test.enablePerNode(); off in production (single bool check).
let _perNodeOn = false
let _perNodeCounts: WeakMap<ReactiveNode, number> | null = null

// ============================================================================
// §9: Intrusive list operations — all O(1)
// ============================================================================

function appendToSourceList(link: Link, observer: ReactiveNode): void {
  if (observer.lastSource === null) {
    observer.firstSource = link
    observer.lastSource = link
  } else {
    link.prevSource = observer.lastSource
    observer.lastSource.nextSource = link
    observer.lastSource = link
  }
}

function appendToObserverList(link: Link, source: ReactiveNode): void {
  if (source.lastObserver === null) {
    source.firstObserver = link
    source.lastObserver = link
  } else {
    link.prevObserver = source.lastObserver
    source.lastObserver.nextObserver = link
    source.lastObserver = link
  }
}

function removeFromObserverList(link: Link, source: ReactiveNode): void {
  if (link.prevObserver !== null) link.prevObserver.nextObserver = link.nextObserver
  else source.firstObserver = link.nextObserver
  if (link.nextObserver !== null) link.nextObserver.prevObserver = link.prevObserver
  else source.lastObserver = link.prevObserver
  link.prevObserver = null
  link.nextObserver = null
}

function removeFromSourceList(link: Link, observer: ReactiveNode): void {
  if (link.prevSource !== null) link.prevSource.nextSource = link.nextSource
  else observer.firstSource = link.nextSource
  if (link.nextSource !== null) link.nextSource.prevSource = link.prevSource
  else observer.lastSource = link.prevSource
  link.prevSource = null
  link.nextSource = null
}

// ============================================================================
// §5.1: Tracking — register a read in the current computation
// ============================================================================

function trackRead(source: ReactiveNode): void {
  if (currentObserver === null || currentObserver.isDisposed) return
  const observer = currentObserver

  // Dedup: same source read twice in one run → one edge only.
  // O(k) scan; acceptable for correctness phase.
  let cur = observer.firstSource
  while (cur !== null) {
    if (cur.source === source) return
    cur = cur.nextSource
  }

  const link = makeLink(source, observer)
  appendToSourceList(link, observer)
  appendToObserverList(link, source)
}

// ============================================================================
// §4: Write path — propagate (BFS: direct observers → DIRTY, transitive → CHECK)
// Uses _markNext as intrusive BFS queue link (zeroed on dequeue).
// No data-dependent recursion (§9).
// ============================================================================

function propagate(source: ReactiveNode): void {
  let qHead: ReactiveNode | null = null
  let qTail: ReactiveNode | null = null

  const enqBFS = (n: ReactiveNode): void => {
    n._markNext = null
    if (qTail === null) {
      qHead = n
      qTail = n
    } else {
      qTail._markNext = n
      qTail = n
    }
  }

  // Phase 1: direct observers → DIRTY
  let link: Link | null = source.firstObserver
  while (link !== null) {
    const obs = link.observer
    if (!obs.isDisposed && obs.state !== DIRTY) {
      const wasClean = obs.state === CLEAN
      obs.state = DIRTY
      if (obs.kind === KIND_EFFECT) enqueueEffect(obs)
      else if (obs.kind === KIND_SYNC) enqueueSync(obs)
      // Enqueue for CHECK propagation only if was Clean (if was Check, subtree already marked)
      if (wasClean && obs.firstObserver !== null) enqBFS(obs)
    }
    link = link.nextObserver
  }

  // Phase 2: transitive observers → CHECK (BFS)
  // Use fresh `bfs` / `bfsLink` variables (not reusing Phase 1's `link`) so
  // TypeScript's control-flow narrowing for `bfs` stays clean across both phases.
  // IMPORTANT: capture `bfsNext` AFTER processing observers (not before). When `bfs`
  // is the queue tail, enqBFS() during processing sets bfs._markNext to the newly
  // queued node; saving beforehand would capture null and exit early. (Deep-chain bug.)
  // `const node` re-pins the type each iteration: TypeScript can lose the ReactiveNode
  // narrowing on `bfs` when qHead/qTail are mutated by the enqBFS closure above.
  let bfs: ReactiveNode | null = qHead
  while (bfs !== null) {
    const node: ReactiveNode = bfs // pin concrete type; `never` is assignable to any type
    let bfsLink: Link | null = node.firstObserver
    while (bfsLink !== null) {
      const obs = bfsLink.observer
      if (!obs.isDisposed && obs.state === CLEAN) {
        obs.state = CHECK
        if (obs.kind === KIND_EFFECT) enqueueEffect(obs)
        else if (obs.kind === KIND_SYNC) enqueueSync(obs)
        if (obs.firstObserver !== null) enqBFS(obs)
      }
      bfsLink = bfsLink.nextObserver
    }
    const bfsNext: ReactiveNode | null = node._markNext
    node._markNext = null
    bfs = bfsNext
  }
}

// ============================================================================
// §5: Read path — updateIfNecessary
// Iterative DFS using _walkParent / _walkCursor temp fields on nodes.
// Satisfies §9 no-data-dependent-recursion requirement.
//
// The `break` in §5 ("stop the loop at first confirmed-dirty source") is
// implemented by clearing the cursor when a parent becomes DIRTY from a child
// recompute, skipping further source checks.
// ============================================================================

function updateIfNecessary(startNode: ReactiveNode): void {
  if (startNode.isDisposed) return

  if (startNode.state === CLEAN) return

  if (startNode.state === DIRTY) {
    runRecompute(startNode)
    return
  }

  // state === CHECK: iterative walk
  startNode._walkParent = null
  startNode._walkCursor = startNode.firstSource
  let frame: ReactiveNode = startNode

  while (true) {
    // ── DIRTY: recompute, then pop ──────────────────────────────────────────
    if (frame.state === DIRTY) {
      runRecompute(frame)
      // frame is now CLEAN (or CLEAN+Error)
      const parent = frame._walkParent
      frame._walkParent = null
      frame._walkCursor = null
      if (parent === null) return
      frame = parent
      if (frame.state === DIRTY) {
        // Parent was marked DIRTY by our recompute's propagation (§5.1.6).
        // §5 "break": stop checking remaining sources; it will recompute.
        frame._walkCursor = null
        continue
      }
      // Parent still CHECK: advance cursor past the source we just resolved.
      frame._walkCursor = (frame._walkCursor as Link | null)?.nextSource ?? null
      continue
    }

    // ── CLEAN: pop ──────────────────────────────────────────────────────────
    if (frame.state === CLEAN) {
      const parent = frame._walkParent
      frame._walkParent = null
      frame._walkCursor = null
      if (parent === null) return
      frame = parent
      frame._walkCursor = (frame._walkCursor as Link | null)?.nextSource ?? null
      continue
    }

    // ── CHECK: scan sources for first non-Clean ─────────────────────────────
    let cursor = frame._walkCursor as Link | null
    while (cursor !== null && cursor.source.state === CLEAN) {
      cursor = cursor.nextSource
    }
    frame._walkCursor = cursor

    if (cursor === null) {
      // All sources Clean → this node is now Clean.
      frame.state = CLEAN
      // Loop will hit the CLEAN case above on next iteration.
      continue
    }

    // cursor.source is CHECK or DIRTY: push frame and descend.
    const child = cursor.source
    child._walkParent = frame
    child._walkCursor = child.state === CHECK ? child.firstSource : null
    frame = child
  }
}

// ============================================================================
// §5.1: Recompute procedure
// ============================================================================

function runRecompute(node: ReactiveNode): void {
  if (node.compute === null) {
    node.state = CLEAN
    return
  }
  _recomputeCount++ // §B1: test-only instrumentation (tree-shaken in prod)
  if (_perNodeOn) {
    // JIT-removable when false
    _perNodeCounts?.set(node, (_perNodeCounts?.get(node) ?? 0) + 1)
  }

  // §6: dispose children and run cleanups from previous run before new run
  preRunCleanup(node)

  // §5.4.3: track whether we're recovering from error (always-propagate on recovery)
  const wasError = node.hasError
  node.hasError = false
  const prevValue = node.value

  // §5.2: save old source list; reset for fresh collection
  const oldFirst = node.firstSource
  node.firstSource = null
  node.lastSource = null

  // §5.1.1: enter tracking + ownership context
  const prevObserver = currentObserver
  const prevOwner = currentOwner
  currentObserver = node
  currentOwner = node

  let threw = false
  let thrownValue: unknown
  let newValue: unknown

  try {
    newValue = node.compute()
  } catch (e) {
    threw = true
    thrownValue = e
  } finally {
    // §5.1.4 + §5.4.1: ALWAYS exit tracking and reconcile, even on throw
    currentObserver = prevObserver
    currentOwner = prevOwner
    reconcileEdges(oldFirst)
  }

  if (threw) {
    // §5.4.2: enter CLEAN + Error state
    node.hasError = true
    node.error = thrownValue
    node.value = undefined
    node.state = CLEAN
    if (node.kind !== KIND_DERIVED) {
      // Effect/Sync: route to boundary (§5.4.4); Derived re-throws on read (§5.4.2)
      routeErrorFrom(node.owner, thrownValue)
    }
    return
  }

  node.state = CLEAN

  if (node.kind === KIND_DERIVED) {
    // §5.1.6: propagate only on change (or recovery from error §5.4.3)
    const changed = wasError || node.equals === false || !node.equals(newValue, prevValue)
    node.value = newValue
    if (changed) propagate(node)
  } else if (node.kind === KIND_EFFECT) {
    // Side effect ran; no value comparison needed.
  } else if (node.kind === KIND_SYNC) {
    // §5.1.6 for Sync: write to declared target via normal signal-write path (§4)
    const target = resolveTarget(node)
    if (target !== null) nodeSet(target, newValue)
  }
}

// §5.4.1: Remove all stale observer edges after a recompute.
// Old links are already absent from node.firstSource (we reset it before compute).
// We only need to remove them from each source's observer list.
// This is correct for both successful and throwing computes.
function reconcileEdges(oldFirst: Link | null): void {
  let link = oldFirst
  while (link !== null) {
    const next = link.nextSource
    removeFromObserverList(link, link.source)
    link = next
  }
}

// ============================================================================
// §6: Ownership helpers
// ============================================================================

function addChild(parent: ReactiveNode, child: ReactiveNode): void {
  child.owner = parent
  if (parent.lastChild === null) {
    parent.firstChild = child
    parent.lastChild = child
  } else {
    child.prevSibling = parent.lastChild
    parent.lastChild.nextSibling = child
    parent.lastChild = child
  }
}

function removeFromParent(node: ReactiveNode): void {
  const p = node.owner
  if (p === null) return
  if (node.prevSibling !== null) node.prevSibling.nextSibling = node.nextSibling
  else p.firstChild = node.nextSibling
  if (node.nextSibling !== null) node.nextSibling.prevSibling = node.prevSibling
  else p.lastChild = node.prevSibling
  node.prevSibling = null
  node.nextSibling = null
  node.owner = null
}

// Called at the START of each recompute (§6: dispose before new run)
function preRunCleanup(node: ReactiveNode): void {
  runCleanups(node)
  disposeChildrenOf(node)
}

function runCleanups(node: ReactiveNode): void {
  if (node.cleanups === null) return
  // §6: LIFO order
  for (let i = node.cleanups.length - 1; i >= 0; i--) {
    try {
      node.cleanups[i]!()
    } catch (_) {
      /* §5.4.5: don't let cleanup abort */
    }
  }
  node.cleanups = null
}

function disposeChildrenOf(node: ReactiveNode): void {
  // Save firstChild/lastChild before resetting (children link back via owner)
  let child = node.firstChild
  node.firstChild = null
  node.lastChild = null
  while (child !== null) {
    const next = child.nextSibling
    child.prevSibling = null
    child.nextSibling = null
    child.owner = null
    disposeNodeFull(child) // recursion OK on cold path (§9)
    child = next
  }
}

// External-facing disposer (removes from parent, then fully disposes)
function disposeNode(node: ReactiveNode): void {
  if (node.isDisposed) return
  removeFromParent(node)
  disposeNodeFull(node)
}

// Core disposal: marks disposed, runs cleanups, severs all edges (§6)
function disposeNodeFull(node: ReactiveNode): void {
  if (node.isDisposed) return
  node.isDisposed = true

  runCleanups(node)
  disposeChildrenOf(node)

  // Sever all source edges (unsubscribe this observer from its sources)
  let link = node.firstSource
  while (link !== null) {
    const next = link.nextSource
    removeFromObserverList(link, link.source)
    link = next
  }
  node.firstSource = null
  node.lastSource = null

  // Sever all observer edges (remove node from each observer's source list)
  link = node.firstObserver
  while (link !== null) {
    const next = link.nextObserver
    removeFromSourceList(link, link.observer)
    link = next
  }
  node.firstObserver = null
  node.lastObserver = null

  // Tear down external subscription (§8.6, §6)
  if (node.externalUnsub !== null) {
    node.externalUnsub()
    node.externalUnsub = null
  }
}

// ============================================================================
// §5.4.4: Error routing — walk owner tree for nearest errorBoundary handler
// ============================================================================

function routeErrorFrom(startOwner: ReactiveNode | null, error: unknown): void {
  let owner = startOwner
  let currentError = error
  while (owner !== null) {
    if (owner.errorHandler !== null) {
      const h = owner.errorHandler
      try {
        h(currentError)
        return
      } catch (e2) {
        // §5.4.6: error inside handler escalates; do NOT re-enter same boundary
        owner = owner.owner
        currentError = e2
        continue
      }
    }
    owner = owner.owner
  }
  // Global fallback (§5.4.4)
  console.error('[nv] Unhandled reactive error:', currentError)
}

// ============================================================================
// §8.7: Sync / Effect queue management
// ============================================================================

function enqueueSync(node: ReactiveNode): void {
  if (node.isScheduled || node.isDisposed) return
  node.isScheduled = true
  node.nextScheduled = null
  if (syncQTail === null) {
    syncQHead = node
    syncQTail = node
  } else {
    syncQTail.nextScheduled = node
    syncQTail = node
  }
}

function enqueueEffect(node: ReactiveNode): void {
  if (node.isScheduled || node.isDisposed) return
  node.isScheduled = true
  node.nextScheduled = null
  if (effQTail === null) {
    effQHead = node
    effQTail = node
  } else {
    effQTail.nextScheduled = node
    effQTail = node
  }
}

function enqueueExt(entry: ExtEntry): void {
  entry.next = null
  if (extQTail === null) {
    extQHead = entry
    extQTail = entry
  } else {
    extQTail.next = entry
    extQTail = entry
  }
}

// ============================================================================
// §8: Scheduler
// ============================================================================

function scheduleFlush(): void {
  if (flushScheduled || flushRunning) return
  flushScheduled = true
  Promise.resolve().then(flushAll)
}

// §8.7: Drain sync phase until both reactive-sync and external-entry queues empty.
// Reactive syncs self-order via the up-walk (no separate topo pass needed).
// CASCADE CAP NOTE: process ONE entry per outer iteration so that a cyclic pair
// (sync A→B, sync B→A) increments the cap counter on every step rather than
// spinning the former inner while(syncQHead) loop indefinitely. (§8.5.4)
function drainSyncPhase(): void {
  let iterations = 0
  while ((syncQHead !== null || extQHead !== null) && iterations < MAX_CASCADE) {
    if (syncQHead !== null) {
      // Reactive sync: resolve via up-walk (may trigger more syncs/effects via §4 write)
      const n = syncQHead
      syncQHead = n.nextScheduled
      if (syncQHead === null) syncQTail = null
      n.nextScheduled = null
      n.isScheduled = false
      if (!n.isDisposed) {
        try {
          updateIfNecessary(n)
        } catch (e) {
          routeErrorFrom(n.owner, e)
        }
      }
    } else if (extQHead !== null) {
      // External entry: untracked compute + write (may trigger reactive syncs → outer loop catches)
      const entry = extQHead
      extQHead = entry.next
      if (extQHead === null) extQTail = null
      if (!entry.node.isDisposed) {
        try {
          runExtEntry(entry.node, entry.value)
        } catch (e) {
          routeErrorFrom(entry.node.owner, e)
        }
      }
    }
    iterations++
  }
  if (iterations >= MAX_CASCADE) {
    console.error(`[nv] Sync cascade cap (${MAX_CASCADE}) reached.`)
    syncQHead = null
    syncQTail = null
    extQHead = null
    extQTail = null
  }
}

function flushAll(): void {
  if (flushRunning) return
  flushScheduled = false
  flushRunning = true

  try {
    let cycles = 0
    while (cycles < MAX_CASCADE) {
      // §8.7: drain syncs first
      drainSyncPhase()
      if (effQHead === null) break

      // §5.4.5: process effect queue with flush isolation (one failing effect
      // does not abort the rest; errors route to boundaries)
      const batchHead = effQHead
      effQHead = null
      effQTail = null

      let eff: ReactiveNode | null = batchHead
      while (eff !== null) {
        const next: ReactiveNode | null = eff.nextScheduled
        eff.nextScheduled = null
        eff.isScheduled = false
        if (!eff.isDisposed) {
          try {
            updateIfNecessary(eff)
          } catch (e) {
            routeErrorFrom(eff.owner, e)
          }
        }
        eff = next
      }

      cycles++
      if (syncQHead === null && extQHead === null && effQHead === null) break
    }
    if (cycles >= MAX_CASCADE) {
      console.error(`[nv] Effect cascade cap (${MAX_CASCADE}) reached.`)
      syncQHead = null
      syncQTail = null
      extQHead = null
      extQTail = null
      effQHead = null
      effQTail = null
    }
  } finally {
    flushRunning = false
  }
}

// ============================================================================
// §8.5: External-source sync — run one queued entry
// Compute runs UNTRACKED (currentObserver = null); no reactive source to track.
// Sequential same-target reduces read prior in-flush writes via §4 write path (§8.7).
// The node.compute wrapper handles map vs. reduce internally; runExtEntry just
// passes `incoming` and lets the wrapper resolve `current` from the target.
// ============================================================================

function runExtEntry(node: ReactiveNode, incoming: unknown): void {
  preRunCleanup(node)

  const prevObserver = currentObserver
  const prevOwner = currentOwner
  currentObserver = null // §5.1: external → untracked
  currentOwner = node

  let threw = false
  let thrownValue: unknown
  let result: unknown

  try {
    // Wrapper handles map vs. reduce; calling with incoming is sufficient.
    result = node.compute?.(incoming)
    const target = resolveTarget(node)
    if (target !== null) nodeSet(target, result)
    node.state = CLEAN
    node.hasError = false
  } catch (e) {
    threw = true
    thrownValue = e
  } finally {
    currentObserver = prevObserver
    currentOwner = prevOwner
  }

  if (threw) {
    node.hasError = true
    node.error = thrownValue
    node.state = CLEAN
    routeErrorFrom(node.owner, thrownValue)
  }
}

// ============================================================================
// §8.5: Resolve the sync write target (direct ReactiveNode or conditional function)
// INVARIANT: target resolution must NOT create dependency edges. The conditional
// thunk is called untracked. Callers may be in a tracked context; this function
// is responsible for its own untracking (do not remove the save/restore below).
// ============================================================================

function resolveTarget(node: ReactiveNode): ReactiveNode | null {
  const t = node.syncTarget
  if (t === null) return null
  if (typeof t === 'function') {
    // Conditional target: call UNTRACKED, then look up resulting Signal
    const prevObs = currentObserver
    currentObserver = null
    let sig: unknown
    try {
      sig = (t as () => unknown)()
    } finally {
      currentObserver = prevObs
    }
    return typeof sig === 'function' ? (nodeForFn.get(sig as object) ?? null) : null
  }
  return t as ReactiveNode
}

// ============================================================================
// §4: Signal write — equality guard then propagate
// A1: KIND_SIGNAL guard ensures writes only land on writable roots, never on
// Derived nodes (whose .value is compute-owned). §8.5 forbids Derived targets.
// ============================================================================

function nodeSet(node: ReactiveNode, newValue: unknown): void {
  if (node.isDisposed) return
  if (node.kind !== KIND_SIGNAL) {
    throw new Error('[nv] write target is not a signal — sync targets must be signals (§8.5)')
  }
  if (node.equals !== false && node.equals(newValue, node.value)) return
  node.value = newValue
  propagate(node)
  if (batchDepth === 0 && !flushRunning) scheduleFlush()
}

// ============================================================================
// §8: untrack helper
// ============================================================================

function doUntrack<T>(fn: () => T): T {
  const prev = currentObserver
  currentObserver = null
  try {
    return fn()
  } finally {
    currentObserver = prev
  }
}

// ============================================================================
// §11: Public API
// ============================================================================

// ── signal ──────────────────────────────────────────────────────────────────

export interface SignalAccessor<T> {
  (): T
  set(v: T): void
}

export function signal<T>(
  initial: T,
  opts?: { equals?: ((a: T, b: T) => boolean) | false },
): SignalAccessor<T> {
  const node = makeNode(KIND_SIGNAL)
  node.value = initial
  if (opts?.equals !== undefined) node.equals = opts.equals as (a: unknown, b: unknown) => boolean

  const fn = (): T => {
    trackRead(node)
    return node.value as T
  }
  fn.set = (v: T): void => nodeSet(node, v)
  nodeForFn.set(fn, node)
  return fn
}

// ── derived ──────────────────────────────────────────────────────────────────

export type DerivedAccessor<T> = () => T

export function derived<T>(
  compute: () => T,
  opts?: { equals?: ((a: T, b: T) => boolean) | false },
): DerivedAccessor<T> {
  const node = makeNode(KIND_DERIVED)
  node.compute = compute as () => unknown
  node.state = DIRTY // lazy: will compute on first read
  node.owner = currentOwner
  if (opts?.equals !== undefined) node.equals = opts.equals as (a: unknown, b: unknown) => boolean
  if (currentOwner !== null) addChild(currentOwner, node)

  const fn = (): T => {
    if (node.isDisposed) {
      if (node.hasError) throw node.error
      return node.value as T
    }
    trackRead(node)
    updateIfNecessary(node)
    if (node.hasError) throw node.error // §5.4.2: re-throw cached error
    return node.value as T
  }
  nodeForFn.set(fn, node)
  return fn
}

// ── effect ───────────────────────────────────────────────────────────────────

export function effect(compute: () => void): () => void {
  const node = makeNode(KIND_EFFECT)
  node.compute = compute as () => unknown
  node.state = DIRTY
  node.owner = currentOwner
  if (currentOwner !== null) addChild(currentOwner, node)
  enqueueEffect(node)
  if (batchDepth === 0 && !flushRunning) scheduleFlush()
  return () => disposeNode(node)
}

// ── sync ─────────────────────────────────────────────────────────────────────

export interface ExternalSource {
  subscribe(cb: (v: unknown) => void): () => void
}

function isExtSource(v: unknown): v is ExternalSource {
  return (
    typeof v === 'object' && v !== null && typeof (v as ExternalSource).subscribe === 'function'
  )
}

export function sync<S = unknown, T = unknown>(
  source: (() => S) | ExternalSource,
  target: SignalAccessor<T> | (() => SignalAccessor<T>),
  compute: ((incoming: S) => T) | ((incoming: S, current: T) => T),
): () => void {
  const node = makeNode(KIND_SYNC)
  node.owner = currentOwner
  if (currentOwner !== null) addChild(currentOwner, node)

  // Resolve syncTarget: direct Signal → store ReactiveNode; conditional fn → store fn
  if (typeof target === 'function') {
    const directNode = nodeForFn.get(target as object)
    node.syncTarget = directNode !== undefined ? directNode : (target as () => unknown)
  }

  if (isExtSource(source)) {
    // ── External-source sync (§8.5, §8.6) ──────────────────────────────────
    const isReduce = compute.length >= 2
    node.compute = (incoming: unknown): unknown => {
      if (isReduce) {
        const t = resolveTarget(node)
        const current = t !== null ? t.value : undefined
        return (compute as (i: unknown, c: unknown) => unknown)(incoming, current)
      }
      return (compute as (i: unknown) => unknown)(incoming)
    }
    // Each publish call creates one ExtEntry (§8.7 — N publishes → N runs)
    const unsub = source.subscribe((v: unknown): void => {
      if (node.isDisposed) return
      enqueueExt({ node, value: v, next: null })
      if (batchDepth === 0 && !flushRunning) scheduleFlush()
    })
    node.externalUnsub = unsub
    // No initial run for external syncs (no value to compute until first publish)
  } else {
    // ── Reactive-source sync (tracked like an effect) ─────────────────────
    const sourceThunk = source as () => S
    const isReduce = compute.length >= 2
    node.compute = (): unknown => {
      const incoming = sourceThunk() // TRACKED (registers reactive sources)
      if (isReduce) {
        // §8.5: current read UNTRACKED by construction (self-accumulator safe)
        const t = resolveTarget(node)
        const current = doUntrack(() => (t !== null ? t.value : undefined))
        return (compute as (i: unknown, c: unknown) => unknown)(incoming, current)
      }
      return (compute as (i: unknown) => unknown)(incoming)
    }
    node.state = DIRTY
    enqueueSync(node)
    if (batchDepth === 0 && !flushRunning) scheduleFlush()
  }

  return () => disposeNode(node)
}

// ── pubsub ───────────────────────────────────────────────────────────────────

export interface PubSub<T = unknown> extends ExternalSource {
  subscribe(cb: (v: T) => void): () => void
  publish(v: T): void
  clear(): void
}

export function pubsub<T = unknown>(): PubSub<T> {
  const subs = new Set<(v: T) => void>()
  return {
    subscribe: (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    publish: (v) => {
      for (const cb of subs) cb(v)
    },
    clear: () => subs.clear(),
  }
}

// ── batch ────────────────────────────────────────────────────────────────────

export function batch(fn: () => void): void {
  batchDepth++
  try {
    fn()
  } finally {
    batchDepth--
    // Outermost batch end: flush synchronously
    if (batchDepth === 0 && !flushRunning) flushAll()
  }
}

// ── untrack ──────────────────────────────────────────────────────────────────

export function untrack<T>(fn: () => T): T {
  return doUntrack(fn)
}

// ── createRoot ───────────────────────────────────────────────────────────────

export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const root = makeNode(KIND_EFFECT) // scope node — compute is null, never scheduled
  root.owner = currentOwner
  if (currentOwner !== null) addChild(currentOwner, root)
  const dispose = (): void => disposeNode(root)
  const prevOwner = currentOwner
  currentOwner = root
  let result!: T
  try {
    result = fn(dispose)
  } finally {
    currentOwner = prevOwner
  }
  return result
}

// ── onCleanup ────────────────────────────────────────────────────────────────

export function onCleanup(fn: () => void): void {
  if (currentOwner === null) throw new Error('[nv] onCleanup called outside a reactive scope')
  if (currentOwner.cleanups === null) currentOwner.cleanups = []
  currentOwner.cleanups.push(fn)
}

// ── errorBoundary ─────────────────────────────────────────────────────────────

export function errorBoundary(handler: (e: unknown) => void, fn: () => void): void {
  const scope = makeNode(KIND_EFFECT) // scope node with errorHandler
  scope.errorHandler = handler
  scope.owner = currentOwner
  if (currentOwner !== null) addChild(currentOwner, scope)
  const prevOwner = currentOwner
  currentOwner = scope
  try {
    fn()
  } finally {
    currentOwner = prevOwner
  }
}

// ============================================================================
// Test / internal helpers (not part of §11 public surface)
// ============================================================================

/** Force a synchronous flush. For tests and batch() internals only. */
export function flushSync(): void {
  if (flushRunning) return
  flushAll()
}

/**
 * Test-only instrumentation surface. Exposes recompute counts and edge-list
 * walks for property-based fuzz testing (§B1). Not part of the public API;
 * intended to be tree-shaken or stripped in production builds.
 */
export const __test = {
  get recomputeCount(): number {
    return _recomputeCount
  },
  resetCounts(): void {
    _recomputeCount = 0
    if (_perNodeOn) _perNodeCounts = new WeakMap()
  },

  /** Turn on per-node counting and start a fresh measurement window. */
  enablePerNode(): void {
    _perNodeOn = true
    _perNodeCounts = new WeakMap()
  },
  disablePerNode(): void {
    _perNodeOn = false
    _perNodeCounts = null
  },

  /** Recomputes for a node this window; 0 if never recomputed, -1 if unknown fn. */
  recomputesOf(fn: object): number {
    const n = nodeForFn.get(fn)
    if (!n) return -1
    return _perNodeCounts?.get(n) ?? 0
  },

  /** Walk source list; returns -1 if fn is not a known reactive node. */
  sourceCount(fn: object): number {
    const n = nodeForFn.get(fn)
    if (!n) return -1
    let c = 0
    let l = n.firstSource
    while (l) {
      c++
      l = l.nextSource
    }
    return c
  },

  /** Walk observer list; returns -1 if fn is not a known reactive node. */
  observerCount(fn: object): number {
    const n = nodeForFn.get(fn)
    if (!n) return -1
    let c = 0
    let l = n.firstObserver
    while (l) {
      c++
      l = l.nextObserver
    }
    return c
  },
}
