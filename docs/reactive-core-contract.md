# nv Reactive Core — Runtime Contract (v0.4.2)

> **Status:** Design contract. Pins the reactive-core semantics that everything
> else in `@neutro/view` (nv) depends on. This document is the fixed target for
> two downstream workstreams: (1) the runtime implementation + tuning, and (2)
> the compiler specialization layer. It deliberately specifies *behavior and
> structure*, not implementation code, so it survives tuning without churn.
>
> **Provenance:** Semantics derived from the published graph-coloring algorithm
> (Reactively, milomg) and the data-structure discipline proven in alien-signals
> / Preact Signals. No code is ported; this is an independent specification
> written in nv's terms. Algorithms are not the copyrightable part — the
> understanding is reimplemented from first principles.

---

## 0. Scope and non-goals

**In scope:** the node model (Signal/Derived/Effect plus the single constrained
Sync write construct), the three-state coloring machine, the push-dirty/pull-lazy
propagation, dynamic dependency re-tracking, error/throw semantics, the effect
scheduler, the `sync` construct and `pubsub` external-source protocol for
reactive→signal writes (§8.5–8.6), flush ordering (§8.7), ownership/disposal,
batching, equality semantics, and the compiler-hook markers that the
specialization layer attaches to.

**Out of scope (deliberately deferred, do not let them leak into the core):**
templating, DOM bindings, Web Component emission, SSR/hydration, the proxy
`store` primitive for deep objects. The core has **zero DOM dependencies** — it
must be usable in Node with no document. The renderer is a *consumer* of this
core (its bindings are effects), never the other way around.

---

## 1. Design invariants (the contract's promises)

These are the properties any conforming implementation MUST uphold. They are the
acceptance criteria; tuning may change *how* they are met but never *whether*.

1. **Efficient.** A reactive computation re-executes only if a source it
   actually read on its last run has changed value. It never over-executes.
2. **Glitch-free.** User code never observes a partially-updated graph. By the
   time any computation or effect runs, every source it reads is already at its
   final value for the current propagation.
3. **Run-once per propagation.** In a single propagation, no node recomputes
   more than once, regardless of graph shape (the diamond is the canonical test,
   not a special case).
4. **Dynamic-correct.** If a computation's set of read sources changes between
   runs (e.g. a branch reads different signals), the dependency edges are
   re-tracked each run; stale edges are removed and never trigger future
   recomputes. Correctness here does NOT depend on a static topological order.
5. **Lazy by default for values; eager for effects.** Derived values are pulled
   (computed on read). Effects are pushed (scheduled and flushed), because
   nothing reads them.
6. **Disposal is total.** Disposing a node removes all its incoming and outgoing
   edges and disposes its owned children. No dangling subscriptions, no leaks.
7. **Reentrancy-safe.** Reading a value during propagation is always safe and
   returns a consistent value. Writing during a computation is constrained
   (see §8, §8.5).
8. **Cycle-safe by construction where analyzable.** Reactive→signal writes whose
   target is statically enumerable are expressed via `sync`, whose cycles are
   rejected at build time (§8.5); only genuinely non-enumerable dynamic writes fall
   to `effect`, which is bounded at runtime by a cascade cap. No silent infinite
   loop is reachable from analyzable code.
9. **Error-safe.** A throw inside any `compute` leaves the graph structurally
   intact (edges reconciled, no leaks), is never silently swallowed, isolates to
   its node during a flush (one failing node does not abort the batch), and clears
   on successful recompute after a source change (§5.4).

---

## 2. Node model

Everything in the graph is a **Node**. There are four node *kinds*, sharing one
machine. Three are the core hats (Signal/Derived/Effect); the fourth, **Sync**,
is the single constrained construct for "write a signal when something happens,"
introduced so that the common reactive→signal write patterns are **cycle-safe by
construction** rather than by runtime guarding (§8.5). The runtime machine is
unchanged by it — a Sync is a scheduled node like an effect, distinguished only
by a *declared write target* the system treats as data.

> A fifth helper, `pubsub`, exists **outside** the graph (it is not a node, has no
> state machine, no value, no coloring). It is a minimal fan-out notification
> utility (§8.6) that produces a valid external *source* for `sync`. It is
> documented here only because `sync`'s external path consumes it.

| Kind        | Value? | Computation? | Tracked (reads sources)? | Observed (pulled)? | Scheduled (pushed)? | Declared write target? |
|-------------|--------|--------------|--------------------------|--------------------|---------------------|------------------------|
| **Signal**  | yes    | no           | no                       | yes                | no                  | —                      |
| **Derived** | yes    | yes (pure)   | yes                      | yes                | no                  | none (returns value)   |
| **Effect**  | no     | yes          | yes                      | no                 | yes                 | undeclared (opaque)    |
| **Sync**    | no     | yes (`compute`) | source-dependent (see below) | no             | yes                 | statically enumerable  |

- **Signal** — a writable root. Holds a value. No sources. Has observers.
- **Derived** — a pure computation of other nodes. Cached value. Has sources and
  observers. Lazy: recomputes only when read after being marked. **Never writes.**
- **Effect** — a computation run for side effects. Has sources, no observers, no
  cached value. Eager: scheduled when a source may have changed. May write any
  signal (opaque target) — the runtime-capped last resort for non-enumerable
  dynamic targets only (§8.5.4).
- **Sync** — "when `source` changes, write `target` via `compute`." The single
  reactive→signal-write construct (§8.5). It absorbs what would otherwise be
  separate map/reduce/external variants:
  - Its **source** is either a reactive thunk (tracked — the Sync re-runs when the
    thunk's sources change) **or** an external subscribe-able producer (untracked —
    no reactive source, so it cannot close a cycle). The *kind of source*
    determines whether a reactive source exists; the user does not declare it.
  - Its **target** is a single signal or a statically enumerable choice among known
    signals (`() => cond() ? a : b`). The compiler enumerates it for the build-time
    cycle check (§8.5.3).
  - Its **compute** arity selects map vs. reduce: `(incoming) => v` (map) or
    `(incoming, current) => v` (reduce), where `current` is the target's present
    value delivered **as data** (structurally untracked), so a self-accumulator
    cannot form a cycle (§8.5.2).
  - Because a Sync is a scheduled graph node, it runs **at most once per
    propagation** by the same coloring guarantee as everything else.

> **Derived ≡ Signal that reads instead of being written; Effect ≡ Derived whose
> output is a side effect; Sync ≡ Effect whose write target is declared (so the
> cycle hazard moves to compile time) and whose trigger may be external (so there
> may be no reactive source to cycle with at all).** Implementations should share
> one struct/shape across all kinds, distinguished by flags, not by class
> hierarchy. This keeps the machine uniform and lets the compiler treat them
> identically when attaching hooks (§10).

### 2.1 Node fields (logical, not a layout mandate)

Required logical state per node. Physical layout is a tuning decision (§9), but
these fields MUST exist in some form:

- `state` — one of `Clean | Check | Dirty` (§3); plus an `Error` flag dimension
  (§5.4) orthogonal to the three colors.
- `value` — cached value (Signal, Derived). Absent for Effect, Sync.
- `error` — cached error if the node's last computation threw (Derived; tracked
  diagnostically for Effect/Sync). See §5.4. Mutually exclusive with a valid
  `value`.
- `compute` — the computation closure (Derived, Effect, Sync). Absent for Signal.
- `sources` — ordered list of nodes this node read on its last run (Derived,
  Effect, Sync with a reactive source). The **order matters** (§5.2). Empty for
  Signal and for Sync with an external source.
- `observers` — list of nodes that read this node (Signal, Derived). Empty for
  Effect, Sync.
- `equals` — equality predicate for value-change detection (§7). Per-node;
  defaults defined in §7.
- `owner` — the owner that will dispose this node (§6).
- `ownedChildren` — nodes/cleanups this node owns (§6).
- `writeTarget` — for Sync: the declared target signal(s) — a single signal, or an
  ordered set of statically enumerable targets. Treated as **data** by the cycle
  analysis (§8.5), never as a reactive read.
- compiler-hook fields — see §10. These are inert at runtime unless set.

---

## 3. The three-state coloring machine

Each node is always in exactly one state:

- **Clean** — value is current; node is not in any pending propagation.
- **Check** — a transitive source *may* have changed; this node *might* need to
  recompute, but we don't yet know. Resolved lazily by walking up (§5).
- **Dirty** — a direct source definitely changed value; this node *will*
  recompute when next pulled (or, for effects, when flushed).

> Why three states and not two: the **Check** ("green") state is the entire
> point of the algorithm. It lets a write mark the whole transitive subtree
> cheaply (mark direct observers Dirty, all further descendants Check) without
> recomputing anything, and defers the expensive question "did the value
> *actually* change?" to read time, resolved by an up-walk. Two-state systems
> either over-notify or over-compute.

### 3.1 Legal transitions

```
Clean  --(direct source changed value)-->        Dirty
Clean  --(transitive source may have changed)-->  Check
Check  --(up-walk finds a changed source)-->      Dirty
Check  --(up-walk finds nothing changed)-->       Clean
Dirty  --(recompute completes)-->                 Clean
```

A node may be promoted `Check -> Dirty` mid-propagation (during an up-walk when
a source it depends on recomputes to a new value). A node is **never** demoted
`Dirty -> Check`.

---

## 4. Write path (the push / "down" phase)

When a **Signal** is written:

1. If the new value is equal to the current value under the signal's `equals`
   predicate, **stop** — no propagation. (See §7 for the signal-vs-derived
   asymmetry and its compiler override.)
2. Otherwise set the value, then **mark observers**:
   - Mark each *direct* observer **Dirty**.
   - Recursively mark each *transitive* observer **Check** (stopping descent at
     any node already in `Check`/`Dirty` for this propagation — re-marking is
     idempotent and must not re-walk).
   - Any **Effect** encountered during marking is added to the **effect queue**
     (§5.3). Effects are the only nodes that get scheduled here; values are not.
3. If not inside a batch, **flush** the effect queue (§8). If inside a batch,
   defer flush to batch end.

> The down phase does **no computation** and reads **no values**. It only colors
> the graph and enqueues effects. This is what makes writes cheap and is the
> precondition for glitch-freedom: nothing computes until every write in the
> current batch has finished coloring.

---

## 5. Read path (the pull / "up" phase) — `updateIfNecessary`

When a node's value is **read**, run `updateIfNecessary` before returning it.
This is the heart of the contract. Behavior by state:

- **Clean** — value is current. Return it. (No walk.)
- **Dirty** — recompute now (§5.1), then return.
- **Check** — we don't know yet. Walk sources to find out:
  - For each `source` **in `sources` order**:
    - Call `source.updateIfNecessary()` (recursive; this may flip *our* state to
      Dirty if the source recomputes to a new value and, as our observer-edge
      requires, marks us Dirty).
    - **If our state has become `Dirty`, stop the loop immediately** (the
      `break`). Do not visit remaining sources.
  - After the loop: if we are now `Dirty`, recompute (§5.1). Otherwise set
    `state = Clean` and return the cached value.

### 5.1 Recompute procedure (for Derived, Effect, and Sync)

Recomputing a node MUST:

1. **Enter a tracking context** for this node (push onto the tracking stack).
   (For a Sync with an *external* source, only the `compute` runs untracked over
   the delivered value; there is no reactive `from` to track. For a Sync with a
   *reactive* source, the source thunk is tracked exactly like a Derived/Effect.)
2. **Begin a fresh source-collection.** Do not reuse last run's `sources` as the
   new set — collect anew (§5.2).
3. Run `compute`. Every reactive read performed during the run registers the
   read node as a new source (and registers this node as that source's
   observer). (A Sync's reduce-arity `current` argument is delivered untracked, so
   it never registers the target as a source — §8.5.)
4. **Exit the tracking context.**
5. **Reconcile edges:** any source from the *previous* run that was **not** read
   this run must have its observer-edge to this node removed (so it can no longer
   mark this node). Sources read this run that are new get edges added.
6. For **Derived:** compare the new computed value to the old under `equals`.
   - If **changed**: store new value; mark direct observers `Dirty` (and their
     transitive observers `Check`, enqueuing effects) — i.e. propagate one hop.
   - If **unchanged**: keep old value; **do not** mark observers. This is how the
     equality-check problem is solved — an observer in `Check` that walks up to
     us will find us `Clean` and can itself go `Clean` without recomputing.
   For **Effect:** there is no value to compare; the side effect has run. Set
   `Clean`.
   For **Sync:** compute the value and write it to the declared `target` via the
   normal signal-write path (§4) — which applies the target's own `equals` guard,
   so a no-op write does not propagate. The Sync itself has no value; set `Clean`.
7. Set `state = Clean` (unless the compute threw — see §5.4).

### 5.2 Dynamic dependency correctness (the part topo-sort gets wrong)

Because step 2 collects sources fresh and step 5 reconciles edges every run, a
computation that reads different sources on different runs is automatically
correct: edges it no longer uses are severed and cannot cause future
recomputes. **No global topological order is maintained or required.** The
up-walk + coloring resolves ordering locally and on demand, which is precisely
why dynamic graphs (conditional dependencies, nodes whose existence depends on
other nodes' values) are handled without the unnecessary-recompute or exception
hazards that static topological sorting suffers.

> The `break` in §5 is **correctness, not optimization.** Once a node is known
> Dirty, visiting further old sources could (a) waste work and (b) re-touch a
> source the new computation will not even use, risking resurrecting a stale
> edge. Stop at the first confirmed-dirty source and let the recompute
> re-collect the true source set.

### 5.3 Effects: who pulls the leaves

Effects are never read, so the pull phase never reaches them on its own. The
write path enqueues them (§4). On flush (§8), each queued effect runs
`updateIfNecessary` on itself — which, if it is `Check`, performs the same
up-walk and only re-runs if a source genuinely changed. Thus effects also
respect the equality-check guarantee and never over-run.

### 5.4 Error semantics — what happens when a computation throws

User code inside a `compute` (Derived, Effect, Sync) may throw. The contract MUST
define the resulting graph state precisely, because a throw mid-recompute can
otherwise leave edges half-reconciled and corrupt all future propagation. This
section is a hard invariant, not a detail.

#### 5.4.1 Edge reconciliation always completes (the load-bearing rule)

A recompute (§5.1) enters a tracking context and collects new sources before the
`compute` returns. If `compute` throws, the node MUST still:

1. **Exit the tracking context** (in a `finally`), and
2. **Complete edge reconciliation (§5.1.5)** against whatever sources were
   collected *before* the throw — adding new edges, removing now-unused old edges.

If reconciliation is skipped on throw, the node retains stale observer-edges that
can mark it on changes it no longer depends on, *and* may have dangling
half-added edges. Therefore reconciliation is unconditional. A throw changes the
node's *value/error state*, never its structural integrity.

> Subtlety: a `compute` that throws may have read *fewer* sources than a
> successful run would (it threw early). Reconciliation against the partial set is
> still correct — on the next attempt the node recomputes and re-collects; the
> partial set only governs *what can wake it to retry*, which is acceptable
> because any of the read-so-far sources changing is a valid retry trigger.

#### 5.4.2 The Error state

`Error` is a flag orthogonal to `Clean/Check/Dirty`. A node whose last `compute`
threw is **Clean + Error**: it has settled (will not re-run until a source
changes) but holds an `error` instead of a `value`.

- **Derived:** caches the thrown `error`. Any read of the derived **re-throws the
  cached error** (it does not silently return a stale value — that would hide
  failure). The derived does **not** notify observers of a "value" because it has
  none; instead, observers that pull it receive the throw (propagation by
  exception, §5.4.3).
- **Effect / Sync:** has no readable value, so there is nothing to cache for
  re-throw. The error is routed to the error channel (§5.4.4) and recorded on the
  node for diagnostics. The flush continues (§5.4.5).

#### 5.4.3 Error propagation through reads (Derived chains)

When a Derived in Error state is pulled by another Derived's `compute`, the read
re-throws. That throw propagates up the *call stack* of the pulling computation —
which means the pulling Derived itself now throws, entering its own Error state,
and so on up the read chain. This is the correct, glitch-free behavior: an error
is just a value of a different kind flowing through the same pull mechanism. No
special error-propagation graph walk is needed; it rides the existing pull.

**Recovery:** when a source of an errored Derived later changes value, the errored
Derived is marked `Dirty` (Error flag cleared on the *next* recompute attempt).
If that recompute succeeds, the node transitions `Error → Clean(value)` and — because
its value went from "error" to "a value," which is a change — it **notifies
observers** so they re-pull and themselves recover. A node recovering from error
therefore always propagates, regardless of whether the new value equals any
pre-error value (there is no valid pre-error value to compare against).

#### 5.4.4 The error channel (boundaries)

Errors that reach a node with no reader to re-throw to (Effect, Sync, or an
errored Derived at the root of a pull with no further reader) are routed to the
nearest **error boundary** registered on the owner tree (§6), falling back to a
global handler, falling back to reporting on the host (e.g. `console.error` /
rethrow to the platform) — never silently swallowed. Error boundaries are
registered per owner scope so a subtree's failures can be contained without
taking down the whole graph. (The renderer maps UI error boundaries onto these.)

#### 5.4.5 Throw during flush does not abort the batch

When an Effect or Sync throws during a flush (§8), the failure is **isolated to
that node**: its error is routed (§5.4.4), and the scheduler **continues
processing the remaining queued effects/syncs**. One failing binding must never
freeze the rest of the UI. The cascade cap (§8.5.4) and the flush loop are
unaffected.

#### 5.4.6 Terminal behavior (no error loops)

- An error raised *inside an error boundary handler* is not re-fed into the same
  boundary; it escalates to the next boundary up, then the global handler, then
  the host. This guarantees error handling itself cannot loop.
- Recovery (§5.4.3) requires a *source change*; an errored node does not
  spontaneously retry, so a deterministically-throwing `compute` settles in Error
  and stops, rather than spinning.

#### 5.4.7 Disposal still runs on error

A node in Error state disposes normally (§6): its cleanups run, owned children are
disposed, edges are severed. An error never leaks resources.

---

## 6. Ownership and disposal (decoupled from DOM lifecycle)

nv maintains an **owner tree** separate from the dependency graph. The owner
tree governs *lifetime*; the dependency graph governs *propagation*. They are
orthogonal and MUST NOT be conflated.

- Every Derived/Effect created during a computation is **owned** by the nearest
  enclosing owner (the computation currently running, or an explicit root).
- When a node recomputes, its previously-owned children and registered cleanups
  are **disposed before** the new run (so each run starts with a clean slate of
  owned resources).
- Disposing a node: run its cleanups (LIFO), dispose owned children
  (recursively), remove all source edges (unsubscribe from each source's
  observer list), remove all observer edges, and detach from its owner.
- A **root owner** is created explicitly (the boundary of a mounted view, a
  standalone reactive scope). Disposing the root disposes the whole subtree.

> **Why decoupled from DOM connect/disconnect:** custom-element
> `disconnectedCallback`/`connectedCallback` can fire on DOM *moves*, not just
> teardown. Binding graph lifetime directly to these would tear down and rebuild
> the graph on a move. The contract: the renderer maps a DOM boundary to a
> *root owner*, and decides its disposal policy (e.g. dispose on a microtask
> after disconnect, cancel if reconnected). The core exposes create-root and
> dispose; it does not know about the DOM. (This keeps the agnostic core
> genuinely agnostic.)

### 6.1 Owner-context capture and redirection (`getOwner` / `runWithOwner`)

The ambient owner is normally the computation currently running. Some consumers
must create owned scopes under a *different* owner than the one running — the
canonical case is a **list reconciler**: its per-item roots are created inside a
reconcile `effect`, but they must outlive that effect's re-runs, so they must be
owned by the reconcile effect's *parent* (a sibling of the effect), not by the
effect itself. (If owned by the effect, §6's "dispose owned children before each
re-run" rule would tear down every item root on every reconcile — turning a keyed
update into a full rebuild.)

Two utilities expose the owner context for this:

- `getOwner()` → returns an opaque handle to the current owner scope (or null
  outside any scope). Callers cannot inspect it.
- `runWithOwner(owner, fn)` → runs `fn` with the ambient owner set to `owner`;
  any `createRoot` / `derived` / `effect` / `onCleanup` created inside `fn` is
  owned by `owner`. Restores the previous owner on return. `owner = null` detaches
  (scopes created inside are unowned and must be disposed manually).

**These manipulate the owner context only — never the tracking context.**
Ownership and propagation are orthogonal (§6 opening). `runWithOwner` does not
change what any computation observes; a reconcile effect redirecting item-root
ownership still tracks only its own reads. This is why owner redirection is a §6
(lifetime) concern, not a §4/§5 (observation) one, and adds no new reactive
primitive — these are peers of `createRoot`/`onCleanup`, not of the four locked
primitives (§1).

---

## 7. Equality semantics (and the asymmetry that matters)

- **Derived** nodes compare their newly computed value against the cached value
  (step 5.1.6) and only propagate on change. Default predicate: `Object.is`
  (referential / SameValue). This is what makes "B always returns 0 ⇒ C never
  re-runs" hold.
- **Signal** nodes, by default, **also** guard writes with `Object.is` (§4.1):
  writing an equal value is a no-op. *However*, this is a per-node policy, not a
  universal law, because deep equality checks are expensive on some types and an
  in-place mutation followed by a same-reference write must still propagate.
- Per-node `equals` may be:
  - `Object.is` (default),
  - a custom predicate (e.g. shallow, deep, structural),
  - or **`false`** meaning "never equal — always propagate." Required for
    signals holding mutable values updated in place (`arr.push(x); set(arr)`),
    where the reference is unchanged but the contents are not.

### 7.1 Compiler hook: equality is a per-node decision the compiler can set

The runtime default is uniform (`Object.is`). The compiler MAY override `equals`
per node based on statically inferred type:

- primitives → keep `Object.is` (cheap, correct);
- known-immutable structures → keep `Object.is`;
- known mutable-in-place containers → set `equals = false` to avoid silent
  missed updates;
- types with a cheap structural compare → inject that compare.

This is an nv-specific advantage: Solid's choice is runtime-uniform; nv resolves
it per node at build time. The runtime contract is only that `equals` is a
settable per-node field with the semantics above. (See §10.)

---

## 8. Batching and scheduling

- **Synchronous reads are always live.** Reading any value runs
  `updateIfNecessary` synchronously and returns a current value. There is no
  read latency.
- **Writes propagate the coloring synchronously** (the down phase is sync) but
  **effects flush is scheduled.** Default: effects flush on a microtask at the
  end of the current synchronous turn (so multiple writes coalesce). An explicit
  `batch(fn)` groups writes and flushes once at the end of `fn`.
- **Glitch-freedom under batching:** within a batch, all writes complete their
  down-phase coloring before any effect flushes. When effects flush and pull
  values, every source is already final. No effect ever sees an intermediate
  state.
- **Write-during-compute:** writing a signal from inside a **Derived**'s
  `compute` is **forbidden** (a Derived must be pure — the entire equality-cutoff
  and caching story depends on it; keep it ironclad). Reactive→signal writes are
  expressed through **`sync`** (§8.5), which is cycle-safe by construction or by
  build-time check; `effect` writes remain allowed only for non-enumerable dynamic
  targets, queued after the current effect and guarded by the cascade cap (§8.5.4).
- **Untracked reads:** the core provides an `untrack(fn)` escape that reads
  values without registering source edges, for cases where a read should not
  create a dependency. (`sync`'s reduce-arity `compute` uses this mechanism
  structurally — see §8.5 — so users do not have to remember to untrack the
  accumulator's `current`.)

### 8.5 `sync` — the single reactive→signal-write construct

A Derived must never write (purity). But real renderers must write a signal *in
reaction to* something (accumulators, cross-subsystem glue, external events, form
sync). Rather than scatter this across several APIs or make every such write an
opaque, loop-prone `effect`, nv provides **one** construct, `sync`, whose
*argument shapes* express all the variation and whose *safety mechanism is
inferred* from those shapes.

```
sync(source, target, compute)
```

- **`source`** — what triggers the write. Either:
  - a **reactive thunk** `() => <expr>` — *tracked*; the sync re-runs when the
    thunk's reactive sources change; or
  - an **external producer** — any object satisfying the source protocol
    `{ subscribe(cb): () => void }` (§8.6); *untracked* — there is **no reactive
    source**, so it cannot close a reactive cycle. `pubsub()` is the canonical
    implementation, but any `{ subscribe }` (a wrapped `EventTarget`, WebSocket,
    `EventEmitter`, observable) qualifies.
  The *kind* of source is what the system reads cycle-safety from; the user never
  declares "this is external" — handing it an external producer *is* the
  declaration.
- **`target`** — the signal to write. A single signal reference, or a statically
  enumerable choice among known signals (`() => cond() ? a : b`; the candidate set
  is the union of branch targets). The compiler enumerates it for the build-time
  cycle check (§8.5.2).
- **`compute`** — how to produce the written value. Its **arity selects map vs.
  reduce**:
  - `(incoming) => value` — **map**: `incoming` is the source's value.
  - `(incoming, current) => value` — **reduce**: `current` is the target's present
    value delivered **as data** (read through the untracked mechanism, §8, *by
    construction*), so a self-accumulator target cannot form a cycle.

Variation lives in the arguments, never in which function you call. The four
patterns that earlier drafts split into separate constructs are now one call:

```
// map, reactive source
sync(() => formValid(), submitEnabled, (valid) => valid)

// reduce / accumulation, reactive source, self-target (no cycle: current is data)
sync(() => newEntry(), log, (entry, current) => [...current, entry])

// external source (DOM/socket/timer); no reactive source ⇒ no cycle
const clicks = pubsub()
sync(clicks, count, (e, current) => current + 1)
button.onclick = clicks.publish

// enumerable conditional target — just the second argument
sync(() => value(), () => isA() ? a : b, (v) => v)
```

**Run-once is automatic:** a sync is a scheduled graph node; the coloring machine
guarantees it runs at most once per propagation (invariant §1.3). The write
follows the normal signal-write path (§4), including the target's `equals` guard.

**What disqualifies a target (forces `effect` instead):** a target that is not
statically enumerable — a computed reference (`targets[i()]`), a runtime map
lookup (`map.get(key())`), or a signal of unknown identity arriving as an opaque
parameter. If the compiler cannot enumerate the candidate set, it is not a valid
`sync` target; the compiler flags it and the write must use `effect` (§8.5.3,
§10). This is the only case that falls to the capped escape hatch.

#### 8.5.1 Why the safety mechanism is inferred, not chosen

The three distinct cycle-safety guarantees are each derived from an argument
shape, so the user reasons only about the task ("when X, write Y"), never about
cycles:

- external `source` ⇒ no reactive source ⇒ **cycle impossible** (nothing to close
  the loop with);
- reduce-arity `compute` ⇒ `current` read as data ⇒ **self-cycle impossible** (the
  target is never read reactively);
- reactive `source` + enumerable `target` ⇒ **build-time cycle check** (§8.5.2).

#### 8.5.2 Global write-graph cycle analysis (build time)

Each `sync` with a reactive source declares `(sources(source) → target)` edges.
The compiler builds a **write-graph** over *all* syncs in the program plus the
existing derived/signal dependency edges, and checks for cycles:

- A cycle exists if a sync's target is transitively a source of that same sync's
  `source` — **except** a reduce-form self-target, which is exempt (the read is
  data, §8.5).
- **The check MUST be global, not per-sync.** Two syncs can form a cycle neither
  exhibits alone (`sync1: a→b`, `sync2: b→a`). Per-sync analysis would miss it.
- A detected cycle is a **build-time error** naming the participating syncs, not a
  runtime loop. This is the core payoff: the analyzable majority of
  reactive→signal writes have their loop hazard eliminated *before the code runs*.
- **Soundness fallback:** if a sync's actual runtime reads diverge from the
  statically analyzed source (compiler was wrong, or a dynamic value escaped
  analysis), the sync degrades to dynamic edge reconciliation (§5.2) for
  correctness and — no longer able to guarantee acyclicity — is subject to the
  runtime cascade cap (§8.5.4). The static check may only *prove and skip*; it may
  never *force* an unsound assumption (mirrors §10's hard rule). A wrong analysis
  costs performance, never correctness.

#### 8.5.3 Classifying a `sync` target (accept / reject-to-`effect`)

The compiler assigns each `sync` target one of three verdicts (see §10 for the
hook):

1. **Provably enumerable → accept** and run the cycle check (§8.5.2).
2. **Provably non-enumerable → reject** with a directed diagnostic: *"`sync`
   target is not statically resolvable; use `effect` (accepting the cascade-cap
   tradeoff) or refactor so the target is enumerable."* Enumerability itself is a
   static property (often type-driven: a `Signal<T>` is resolvable; a literal
   `cond ? a : b` is enumerable; a `Record<string, Signal<T>>` indexed by a
   runtime key is provably non-enumerable), so this verdict is decidable.
3. **Undecidable (e.g. `any`-typed or cross-boundary target) → conservative
   default**: treat as non-enumerable (force `effect`) *or* accept with a runtime
   enumerability check guarded by the soundness fallback (§8.5.2). Never an
   unsound guess.

#### 8.5.4 `effect` write cascade cap (the shrunken last resort)

After `sync` absorbs the enumerable and external cases, the only writes left for
`effect` are **non-enumerable dynamic targets** — rare, often a design smell. The
runtime retains a cascade guard: a write during an effect flush queues a new
propagation processed after the current effect; a depth/iteration counter caps
runaway cascades and emits a dev-mode diagnostic naming the effect. This cap
should almost never fire in well-structured code; frequent firing signals a write
that should be lifted into a `sync`.

**Two distinct budgets (the cap is not one number).** The sync-phase drain must
distinguish two failure modes that look superficially similar but are not the same
thing, and must not conflate them under a single counter:

1. **Reactive-cascade budget** — bounds *reactive* sync/effect cascade depth (a
   write triggering a recompute triggering a write…). This is the cycle-and-runaway
   guard; it is the budget a build-time-undetected reactive feedback loop falls back
   to. Counted only for reactive sync-node processing.
2. **External-event budget** — bounds *external* entry draining (one entry per
   `pubsub` publish, §8.6). A burst of external events is **not** a reactive cascade
   and must not consume the reactive budget: legitimate bursts (rapid input, a
   socket flushing buffered messages) routinely exceed the reactive depth a cascade
   would, and capping them would silently drop events. This budget is therefore
   **separate and larger**, sized so legitimate bursts pass freely while a genuinely
   runaway *external* feedback loop (sync A's compute republishes to sync B's source,
   which republishes to A's…) still terminates rather than hanging.

The required property is the separation, not the magnitudes: external draining must
not be bounded by the reactive-cascade budget, and both runaway modes must
terminate. The specific multiplier between the two budgets is an implementation
tuning constant, not a contract-committed value (the current runtime uses a 10×
external safety budget). A wrong constant costs only false-cap timing on
pathological inputs; the *separation of the two budgets* is the correctness-relevant
guarantee, because conflating them drops legitimate external events (a wrong
result), not merely a performance cost.

> **Design rule (do not erode):** keep `sync` **strict**. Do not add flags like
> `allowDynamicTarget` to widen its coverage — each such flag dissolves the static
> guarantee that justifies the construct, turning it into "an effect in disguise."
> A narrow construct with an ironclad guarantee plus a wide capped escape hatch
> (`effect`) beats a medium construct with soft guarantees. Likewise do not let
> `pubsub` (§8.6) grow value-holding or operators.

### 8.6 `pubsub` — the external source protocol and its default

`sync`'s external path consumes a **source protocol**, defined at the contract
level so the runtime and compiler both depend on a fixed shape:

> A valid external source is any object with `subscribe(cb): () => void` —
> register `cb`, return an unsubscribe function. The shape deliberately mirrors
> `addEventListener` so it is instantly familiar and any real event source
> (`EventTarget`, WebSocket, Node `EventEmitter`, an observable) adapts in a few
> lines.

`pubsub()` is the provided **default implementation** of that protocol — a
general, minimal fan-out notification utility used both by `sync`'s external path
and by nv's own view layer for *event* (non-state) coordination:

```
function pubsub() {
  const subs = new Set();              // allocation-light; no DOM
  return {
    subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    publish:   (v)  => { for (const cb of subs) cb(v); },
    clear:     ()   => subs.clear(),
  };
}
```

- `subscribe(cb) → unsubscribe` — the protocol shape. `sync` calls this on attach
  and calls the returned unsubscribe on disposal (§6), so external sources are
  torn down with their owner — no leaks.
- `publish(v)` — fan-out to all subscribers; allocation-free loop (honors §9).
- `clear()` — drop all subscribers (for total teardown). The only method beyond
  the protocol minimum.

**The bright line (hard constraint — do not cross):** `pubsub` is for **events**
(fire-and-forget notifications); `signal` is for **state** (values that persist
and are read). `pubsub` has **no memory** — a late subscriber receives nothing
until the next `publish`; there is no last-value, no replay, no operators
(`map`/`filter`/`merge`). Anything that needs to *hold* a value is a `signal`;
anything that needs to *transform streams* belongs in userland or `@neutro/sync`,
**never** here. This line is what keeps `pubsub` from drifting into a stream
library.

### 8.7 Flush ordering (sync writes vs. terminal effects)

Within a single flush, the scheduled queue may contain both **syncs** (which
write signals) and **effects** (terminal consumers that write nothing in
well-structured code). Two ordering guarantees are required so that glitch-
freedom (§1.2) and run-once (§1.3) hold when these are mixed.

1. **Dependencies are resolved by the up-walk, not by phase ordering.** A
   scheduled node is processed by running `updateIfNecessary` on it (§5), so any
   inter-node dependency — `sync`→`sync`, `sync`→`derived`, `effect`→`derived` —
   self-orders: pulling a node first resolves every source it reads, recursively.
   No separate topological pass over scheduled nodes is maintained. A sync whose
   `source` reads a value another sync writes is therefore ordered correctly for
   free, because the second sync's up-walk resolves the first.

2. **Drain order processes producers before purely-terminal consumers.** The
   up-walk in (1) only orders nodes connected by a *read* edge. An effect that
   reads a signal **written by a sync** is not a read-dependent of that sync — the
   ordering edge is created by the sync's *write* (§4), which may not have
   happened when the effect is dequeued. To prevent the effect from running on a
   stale/partial value (a glitch) and then being re-marked and re-run (a
   double-run), the flush MUST drain **syncs before purely-terminal effects**.
   Concretely: process scheduled syncs (resolving each via the up-walk, which
   performs its §4 write) until none remain, then process scheduled effects. A
   sync re-queued by another sync's write is handled before the effect phase
   begins.

**Sequential same-target syncs observe prior in-flush writes.** Because each
sync's write follows the normal write path (§4) and updates the target before the
next sync runs, N external `publish` calls coalesced into one flush, driving
`sync(src, count, (e, current) => current + 1)`, produce `count + N` — each
execution reads the value the previous one wrote. This is not a special
mechanism; it is the §4 write path running once per queued entry. Other observers
of `count` do **not** see the intermediate values: per (2) and §8, terminal
effects run only after the sync phase drains, by which point `count` is final —
glitch-freedom is preserved.

> **Why this is the minimal rule.** Guarantee (1) is just "scheduled nodes are
> pulled, not pushed," which the core already does. Only guarantee (2) is new, and
> it is a *drain-order tiebreaker* for independently-queued nodes, not a second
> scheduler. It adds no new concept beyond "writes before terminal reads," which
> is the same principle that makes the down-phase precede the effect flush (§8).

> **Termination note.** The sync phase drains until no syncs remain queued. A
> *reactive* sync cycle cannot arise here (rejected at build time, §8.5.2); a sync
> re-queued via the soundness fallback or a non-enumerable `effect` write is
> bounded by the cascade cap (§8.5.4), which applies to the sync phase exactly as
> it does to the effect phase. The phase cannot spin indefinitely.

---

## 9. Data-structure discipline (performance contract)

These constraints are part of the contract because they shape the node model and
the compiler's edge references; they are not post-hoc tuning.

- **Edges are intrusive doubly-linked list nodes**, not arrays/sets. Each
  source↔observer relationship is a link object carrying back/forward pointers
  on both the source's observer-list and the observer's source-list. This makes
  add/remove O(1) and avoids array churn and indexOf scans during the per-run
  edge reconciliation (§5.1.5).
- **No `Array`/`Set`/`Map` in the hot path** (mark, up-walk, reconcile). Dynamic
  collections allocate and GC under load; the hot path uses the intrusive links
  and fixed fields only.
- **No recursion in the algorithmic core where depth is data-dependent.** The
  mark (down) and `updateIfNecessary` (up) walks must be expressible
  iteratively (explicit stack or pointer-chasing) so deep graphs cannot blow the
  call stack and so the JIT keeps them monomorphic. (Recursion is acceptable in
  cold paths like full disposal.)
- **Source order is preserved** in the intrusive list so the §5 loop visits
  sources in read order and the `break` semantics are deterministic.
- **Version/flag packing:** node `state` plus boolean flags (tracked, observed,
  scheduled, disposed) should pack into a single integer field for cache
  locality. (Layout detail; the contract only requires the logical states.)

> These mirror the discipline that makes alien-signals the current speed leader.
> They are derived from its published constraints, reimplemented in nv terms.

---

## 10. Compiler-hook markers (the nv-specific layer)

The core runs correctly with all hooks unset (pure runtime library mode). The
compiler specialization layer attaches decisions to nodes ahead of time. The
contract reserves these hook points and defines their runtime meaning so the
specialization research (downstream workstream 2) targets a fixed surface.

| Hook | Runtime field / behavior | What the compiler decides | Default if unset |
|------|--------------------------|---------------------------|------------------|
| **`sync` target classification** | each `sync` is accepted, rejected-to-`effect`, or conservatively defaulted (§8.5.3); accepted syncs carry their enumerated target set for the cycle check | enumerability of the target (often type-driven): provably enumerable → accept; provably non-enumerable → **reject with diagnostic to use `effect`**; undecidable → conservative default | runtime-checked enumerability + soundness fallback (§8.5.2) |
| **Equality policy** | per-node `equals` (§7) | inferred from static type | `Object.is` |
| **Eager/lazy bias** | per-node flag: a Derived may be marked "eager" (recompute on mark like an effect) or stay lazy | shallow/predictability-sensitive subgraphs → eager; expensive/wide → lazy | lazy |
| **Static dependency set / branch variants** | per-node optional "declared sources" + per-branch source-set variants the runtime swaps instead of re-collecting | when the compiler can prove the read-set per branch, emit variants so recompute skips dynamic re-collection | dynamic collection (§5.2) |
| **Wide-fanout grouping** | observers of a high-fanout signal may be grouped so the down-phase marks a group in one step | when one signal feeds many co-located bindings | per-observer marking |
| **Disposal scope** | binds a node's owner to a compiler-known scope boundary | lifetime tied to a template region | nearest dynamic owner |

**Hard rule for the specialization layer:** every hook is an *optimization
hypothesis* that MUST be validated against the unspecialized baseline on the
benchmark suite before it ships. alien-signals' own finding is that algorithmic
simplicity often beats clever scheduling; a specialization that does not beat the
simple path is removed. The build filter applies: *does this retire a measured
risk, or is it a feature?*

> **Correctness constraint on "static dependency set / branch variants":** a
> declared/variant source set is an *optimization of collection*, never a
> relaxation of reconciliation. If a run's actual reads diverge from the declared
> set (e.g. compiler was wrong, or a dynamic value escaped analysis), the runtime
> MUST fall back to dynamic collection (§5.2) for that run. The compiler hook may
> only *skip* re-collection when it can prove the read-set; it may never *force*
> a wrong one. This preserves invariant §4 (dynamic-correct) unconditionally.

---

## 11. Public primitive surface (minimal, derived from the model)

The core exposes (names provisional; semantics fixed):

- `signal(initial, { equals? })` → readable+writable. Read runs no walk (it's a
  root); write follows §4.
- `derived(compute, { equals? })` → readable, pure. Read follows §5. Never writes.
  Re-throws a cached error if its last compute threw (§5.4).
- `effect(compute)` → scheduled. Disposed via its owner or a returned disposer.
  May write any signal (capped escape hatch, §8.5.4) — but prefer `sync`.
- `sync(source, target, compute)` → the single reactive→signal-write construct
  (§8.5). `source` is a reactive thunk or an external `{ subscribe }` producer;
  `target` is a single or statically enumerable signal; `compute` arity selects
  map `(incoming)` vs. reduce `(incoming, current)`. Cycle-checked at build time
  for reactive sources; cycle-impossible for external sources.
- `pubsub()` → default implementation of the external source protocol
  (§8.6): `{ subscribe, publish, clear }`. A fan-out **event** utility, not state.
- `batch(fn)` → §8.
- `untrack(fn)` → §8.
- `createRoot(fn)` → establishes a root owner; returns a disposer (§6).
- `onCleanup(fn)` → registers a cleanup on the current owner (§6).
- `getOwner()` → opaque handle to the current owner scope, or null (§6.1).
- `runWithOwner(owner, fn)` → run `fn` with the ambient owner set to `owner`;
  owned scopes created inside are parented to it. Owner context only — does not
  affect tracking (§6.1). The primitive a list reconciler needs to create
  per-item roots as siblings of, not children of, its reconcile effect.
- `errorBoundary(handler, fn)` → registers an error boundary on the current owner
  scope; errors from within `fn`'s subtree route to `handler` (§5.4.4).

No dependency arrays. No memo hints. No re-render. Tracking is automatic via the
read context (§5.1). This is the entire conceptual surface; the renderer and the
`store` proxy primitive are built on top, outside this contract.

---

## 12. Conformance test checklist (the design's own acceptance criteria)

A conforming core MUST pass at minimum:

1. **Diamond** — A→B, A→C, B&C→D; one write to A recomputes D exactly once,
   after both B and C, with no glitch. (Invariants §1.2, §1.3.)
2. **Equality cutoff** — A→B(=0 always)→C; writing A re-runs B but never C.
   (§5.1.6, §7.)
3. **Dynamic dependency** — a Derived that reads `cond ? x : y`; flipping `cond`
   re-tracks so that subsequently changing the now-unused signal does not
   recompute it. (§5.2.)
4. **Deep chain, no stack overflow** — a chain of N=100k computeds updates
   iteratively. (§9.)
5. **Wide fanout** — one signal with N=10k observers marks and settles in linear
   time. (§9.)
6. **Disposal totality** — disposing a root severs all edges; subsequent writes
   to former sources do nothing and leak nothing. (§6, §1.6.)
7. **Batch glitch-freedom** — multiple writes in a batch flush effects once,
   each effect observing only final values. (§8.)
8. **Effect cascade cap** — an effect that writes a signal it transitively
   depends on is bounded and diagnosed, not infinite. (§8.5.4.)
9. **In-place mutation** — a signal with `equals:false` holding a mutated array
   propagates despite reference identity. (§7.)
10. **`sync` map, run-once** — a `sync` whose reactive source depends on A writes
    its target exactly once per propagation of A; an enumerable conditional target
    (`() => cond() ? a : b`) writes only the selected target. (§8.5.)
11. **`sync` reduce, no self-cycle** — a reduce-arity `sync` accumulating into its
    own target does not register the target as a source, terminates, and is *not*
    flagged as a cycle. (§8.5, §8.5.2.)
12. **`sync` cycle, build-time reject** — two syncs forming `a→b` and `b→a` are
    rejected at build time by the *global* write-graph check, both named; a single
    sync whose target feeds its own source is likewise rejected. (§8.5.2.)
13. **`sync` soundness fallback** — a sync whose runtime reads diverge from the
    statically analyzed source falls back to dynamic reconciliation and the cascade
    cap rather than producing a wrong result. (§8.5.2.)
14. **`sync` target classification** — a non-enumerable target (`targets[i()]`) is
    rejected at compile time with a diagnostic directing to `effect`; an `any`-typed
    target is conservatively defaulted, not unsoundly accepted. (§8.5.3, §10.)
15. **External source via `pubsub`** — a `sync` driven by a `pubsub` source enters
    batched and glitch-free; concurrent `publish` calls in one turn coalesce into a
    single flush; the sync cannot form a cycle (no reactive source); disposing the
    sync unsubscribes from the pubsub. (§8.5, §8.6.)
16. **`pubsub` bright line** — a `pubsub` has no memory: a subscriber added after a
    `publish` receives nothing until the next `publish`. (§8.6.)
17. **Error: edge integrity on throw** — a Derived whose compute throws after
    reading some sources still reconciles edges; a later change to a read source
    retries it. (§5.4.1.)
18. **Error: cache + re-throw + recovery** — an errored Derived re-throws on read;
    when a source changes and recompute succeeds, it transitions to a value and
    notifies observers so they recover. (§5.4.2–5.4.3.)
19. **Error: flush isolation** — one effect throwing during a flush routes its
    error to the boundary and does not prevent the remaining queued effects from
    running. (§5.4.5.)
20. **Error: boundary + no loop** — an error routes to the nearest owner-scope
    boundary; an error thrown inside a boundary handler escalates upward rather than
    re-entering the same boundary. (§5.4.4, §5.4.6.)
21. **Error: disposal on error** — disposing a node in Error state runs cleanups
    and severs edges with no leak. (§5.4.7.)
22. **Flush ordering: sync before terminal effect** — when one signal write queues
    both a `sync` (writing target T) and an independent `effect` that reads T, the
    effect runs after the sync and observes T's final value, exactly once — no
    glitch, no double-run. A second sync whose `source` reads T self-orders after
    the first via the up-walk. (§8.7.)
23. **Hook-off equivalence** — with all compiler hooks unset, behavior is identical
    to the pure-runtime semantics above (so the baseline is well defined for
    specialization benchmarking). (§10.)

---

## 13. What is intentionally NOT decided here (open, but non-blocking)

These do not block the compiler-specialization research because they do not
change the node model or the invariants:

- The exact effect-flush timing primitive (microtask vs. custom scheduler) —
  pluggable; only the glitch-freedom guarantee is fixed.
- The `store` (proxy deep-reactivity) primitive — built atop signals later; it
  produces signals/edges that obey this contract, so it is additive.
- Concurrent/interruptible scheduling — out of scope for this version; the model
  does not preclude it, but it is not specified. (Note: error semantics §5.4 are
  specified for the synchronous model; concurrency, if added, must revisit how
  errors interact with interruption.)
- SSR value serialization — renderer concern, not core.

---

### One-line summary

nv's reactive core is a three-state (Clean/Check/Dirty) graph-coloring system
with synchronous push-down marking, lazy pull-up resolution via
`updateIfNecessary`, per-run dynamic edge reconciliation, defined error/throw
semantics that keep the graph structurally intact and isolate failures, an owner
tree decoupled from DOM lifecycle, intrusive-linked-list edges with no hot-path
allocation, a single `sync(source, target, compute)` write construct (fed by a
`pubsub` external-source protocol) that moves the reactive→signal-write loop
hazard from runtime guarding to build-time structural impossibility wherever the
target is statically analyzable, and a reserved set of per-node compiler hooks —
including `sync`-target classification — whose only license is to *skip* provable
work, never to violate the efficiency, glitch-freedom, run-once, dynamic-correct,
or error-safe invariants.
