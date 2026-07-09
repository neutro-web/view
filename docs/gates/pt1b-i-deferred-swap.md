# Gate-P — PT-1b-i: `wireDeferredSwap` (tier-2 deferred swap)

**Status:** REVISED after Architect's first Gate-P review — a dependency-
collection bug in Ruling 3 (all three of CC's own adversarial passes missed
it; see Ruling 3's pass 4 finding and the summary table) is now fixed.
Awaiting Architect re-confirmation. No `src/` touched.
**Anchor:** main `9973042` (rulings 1/2, PT-1b split — all logged).
**Commission:** `pt1b-i-swr` (workstream 3), Deliverable 2.

This document answers the four items the commission requires before any `src/`
change: (1) `.nv` authoring surface, (2) IR shape, (3) epoch-mirroring approach,
(4) off-anchor container strategy. Each ruling includes the adversarial passes
that shaped it — issues found and fixed are recorded, not silently absorbed.

---

## Ruling 1 — `.nv` authoring surface

**Extend `<switch>`/`<match>` with an optional `pending` attribute. No new element
tag.**

```
<switch pending="${r.loading()}">
  <match when="${r()?.kind === 'a'}"><ProfileView data=${r}/></match>
  <match when="${r()?.kind === 'b'}"><SettingsView data=${r}/></match>
  <match><EmptyState/></match>
</switch>
```

**Why not a new tag.** The nomenclature lock says angle brackets mean a real
element; a bare `<defer>`/`<await>` tag would need its own grammar for
branch-selection that already exists verbatim in `<switch>`/`<match>`
(first-match-wins, ordered branches, optional fallback). Reusing the grammar and
gating on one attribute keeps the authoring surface to *one* structural-branch
construct instead of two that a reader has to learn are "the same thing, plus
one flag." Tagged-template side: extend `match()`'s existing sentinel builder
with the same `pending` option, mirroring `iff()`'s established pattern.

**Compiler behavior:** presence of `pending=` on `<switch>` makes the parser
emit `kind: 'deferred-swap'` instead of `kind: 'switch'`. Absence is unchanged
(`kind: 'switch'`, byte-identical to today). This is a parse-time fork on one
attribute, not two overlapping runtime paths — no ambiguity about which kind an
author gets.

### Adversarial pass 1 finding (fixed)
**Issue:** first draft used a *new* `<swr>` tag with the same `<match>` children,
reasoning "clearer intent than an attribute flag on `<switch>`." Rejected on
review: it duplicates `<switch>`'s entire grammar (branches, fallback,
first-match-wins) under a second tag name, which is exactly what the
nomenclature lock and collapse-don't-fork exist to prevent — two tags that must
be kept in lockstep forever for no semantic gain over one attribute. Fixed by
folding into `<switch pending=>`.

### Adversarial pass 2 finding (fixed)
**Issue:** `pending` was drafted as a required attribute. But `wireSwitch`'s
existing callers (all current `<switch>` usages, all fixtures) must continue to
compile unchanged — a required attribute would be a breaking grammar change
disguised as an addition. Fixed: `pending` is optional; its absence selects
`kind: 'switch'` (today's path, untouched), never `kind: 'deferred-swap'` with
an implicit `() => false`. This also means `wireSwitch` itself needs zero code
changes — the fork happens entirely at parse time.

---

## Ruling 2 — IR shape

```ts
/**
 * Structural switch/match form, deferred: branch selection identical to
 * SwitchBinding (first-match-wins, ordered), but the swap to a new branch is
 * held while `pending()` is true — the currently revealed branch stays
 * mounted and live. See wireDeferredSwap (interpreter.ts) for the wire-time
 * discipline this shape exists to support.
 */
export type DeferredSwapBinding = BaseBinding & {
  kind: 'deferred-swap'
  pending: ReactiveExpr<boolean>
  /** Ordered branches — first truthy `when()` wins. Same semantics as SwitchBinding. */
  branches: readonly { when: ReactiveExpr<boolean>; body: TemplateIR }[]
  fallback: TemplateIR | null
}
```

Deliberately shaped as "`SwitchBinding` plus `pending`," not a new
value-plus-template-factory abstraction — see pass 1 below for why the
alternative was rejected.

### Adversarial pass 1 finding (fixed)
**Issue:** first draft modeled this as `{ value: ReactiveExpr<unknown>, pending:
ReactiveExpr<boolean>, template: (value) => TemplateIR | null }` — a single
resolved-value-driven template factory, closer to how `resource` itself is
usually consumed. Rejected: it invents a second structural-branching vocabulary
parallel to `SwitchBinding`'s existing branches/fallback shape, for no
behavioral gain — "which template for which value" and "which branch is
truthy" are the same question asked two ways. Reusing branches/fallback verbatim
means `wireDeferredSwap`'s winner-selection loop has the exact same *shape* as
`wireSwitch`'s (first-match-wins over `branches`, then `fallback`) — a reader
who knows one immediately reads the other. **Correction (caught on final
review, see Ruling 3's closing note):** "same shape" does not mean the two
loops are extracted into one shared function — the commission's G0 disqualifier
forbids implementing tier-2 by mutating `wireSwitch`, and factoring a helper
out of `wireSwitch`'s existing inline loop to share it would be exactly that
kind of mutation. The two loops are independently duplicated, on purpose,
mirroring how `wireConditional` and `wireSwitch` are already independently
duplicated siblings in this codebase today (switch is documented as "a direct
generalization of wireConditional," yet the two functions share no helper).
Collapse-don't-fork is honored at the *shape* level (one mental model, one
grammar), not by DRYing the interpreter's protected functions.

### Adversarial pass 2 finding (fixed)
**Issue:** no field distinguishes "no branch matched and fallback is null" from
"pending is true, nothing decided yet" — both look like "nothing to show" from
outside. Confirmed this is fine *by inspection, not by construction*: both cases
correctly resolve to "leave the anchor as whatever is currently revealed" in
the wire-time state machine (see Ruling 3's `revealed` sentinel), so no IR field
is needed — flagged here so a future reader doesn't add one unnecessarily.
**Re-confirmed after Architect's dependency-collection fix (Ruling 3, pass 4):**
the fix reorders *when* the pending-check happens relative to winner
computation, not *whether* a pending run touches `revealed`/`revealedDisposer`
— a pending run still computes `winner` locally and then returns without
comparing it to `revealed` or mutating any state. The indistinguishability
argument is unchanged by the reorder; re-verified, not just re-asserted.

### Adversarial pass 3 finding (fixed)
**Issue:** `pending: ReactiveExpr<boolean>` — should this be optional (defaulting
to `() => false`, degenerating to plain `switch`) to reduce the number of
distinct binding shapes? Rejected: Ruling 1 already forks at parse time on
attribute presence, so `pending` is only ever present on a `DeferredSwapBinding`
in the first place — making it optional here would let a `DeferredSwapBinding`
exist with no way to hold anything pending, silently degrading to `wireSwitch`'s
behavior through a different code path (two ways to get the same runtime
behavior — a collapse violation in the other direction). Kept required.

---

## Ruling 3 — swap/epoch discipline (no second epoch scheme)

**Gate on `pending()` alone; do not track a second gen/epoch counter at the
mount layer.** `resource`'s internal epoch (`resource.ts:64`, `gen !== epoch`
guards) already guarantees `data()` — and therefore any `when()` expression
derived from it — never reflects a superseded fetch. By the time our effect
observes `pending() === false`, whatever `when()`/`data()` state it reads is
already the final, de-duplicated result of the *latest* source change. There is
no window at the mount layer where a "newer" value could arrive out of order,
so there is nothing for a second epoch counter to protect against — inventing
one would duplicate machinery `resource` already provides and the commission
explicitly says not to.

**What actually needs guarding is not staleness, it's construction safety:**
building the new branch must not destroy the currently-revealed one if
construction throws partway through. This is the same class of bug this
codebase already hit and fixed once (Follow-up B′'s throw-safety fix,
`0ac39f9` — `activeCount` committed incrementally so a throw mid-loop couldn't
orphan rows). Applying that lesson here:

```ts
function wireDeferredSwap(binding: DeferredSwapBinding, anchorNode: Node, doc: Document): void {
  const parent = anchorNode.parentNode
  if (parent === null) throw new Error('[nv/interpreter] DeferredSwapBinding: anchor has no parent')

  let revealedDisposer: (() => void) | null = null
  let revealed: number | 'fallback' | 'none' = 'none'

  effect(() => {
    // INVARIANT: every reactive read (pending() AND all when()s up to the
    // winner) happens before any early return, so the dependency set is
    // IDENTICAL whether this run is pending or not. nv does dynamic per-run
    // dependency collection (§5.2, core.ts:510-534 — old sources reset,
    // reconciled against what was actually read this run); a signal not read
    // during a run is unsubscribed. Gating on pending() BEFORE reading when()
    // (the original draft) would unsubscribe from every when() on a pending
    // run, and the only thing left to trigger a re-run would be pending()
    // itself flipping back — silently dropping any when() change that
    // happens while pending, and making correctness depend on `loading()`
    // always being the thing driving `pending` and always toggling on every
    // settle. Read everything first; gate the SWAP, not the subscription.
    const isPending = binding.pending()

    let winner: number | 'fallback' | 'none' = 'none'
    let template: TemplateIR | null = null
    for (let i = 0; i < binding.branches.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: loop bound
      const b = binding.branches[i]!
      if (b.when()) { winner = i; template = b.body; break }
    }
    if (template === null && binding.fallback !== null) { winner = 'fallback'; template = binding.fallback }

    if (isPending) return // hold the swap — deps are already collected above

    if (winner === revealed) return // already showing this branch — no-op

    if (template === null) {
      // Winner is 'none' (no branch, no fallback): drop whatever's revealed, show nothing.
      if (revealedDisposer !== null) { revealedDisposer(); revealedDisposer = null }
      revealed = winner
      return
    }

    // Build off-anchor. Capture `dispose` BEFORE the throwable work (mountFragment),
    // so a throw mid-construction still lets us tear down the partial root — it is
    // already a child of the current owner (createRoot attaches before `fn` runs)
    // and would otherwise leak until this whole binding's owner tears down.
    const staging = doc.createDocumentFragment()
    let capturedDispose: (() => void) | null = null
    let newRoots: Node[] = []
    try {
      createRoot((dispose) => {
        capturedDispose = dispose
        const { roots } = mountFragment(template as TemplateIR, staging, doc, null)
        newRoots = roots
        onCleanup(() => {
          for (const n of newRoots) if (n.parentNode !== null) n.parentNode.removeChild(n)
        })
        return dispose
      })
    } catch (e) {
      if (capturedDispose !== null) (capturedDispose as () => void)()
      throw e // old subtree (revealedDisposer) untouched — SWR-safe on construction failure
    }

    // Construction succeeded — atomic swap: dispose old, move new roots to anchor.
    if (revealedDisposer !== null) { revealedDisposer(); revealedDisposer = null }
    for (const n of newRoots) parent.insertBefore(n, anchorNode)
    revealedDisposer = capturedDispose
    revealed = winner
  })

  onCleanup(() => {
    if (revealedDisposer !== null) { revealedDisposer(); revealedDisposer = null }
  })
}
```

**Note on the winner-selection loop (lines 148-155):** shown here duplicated
inline, matching `wireSwitch`'s existing loop shape rather than calling into
it. This is intentional, not an oversight caught late and left unfixed — see
the correction under Ruling 2 pass 1. Do not factor this into a shared helper
with `wireSwitch` during implementation; that would touch a G0-protected
function.

**Consequence — first-load pending renders nothing (intentional, not a gap):**
`binding.pending()` is checked *before* any branch or fallback is evaluated
(line 146). If the very first effect run observes `pending() === true` (the
common case — a fresh `resource()` typically starts `loading()` synchronously
before its first settle), `revealed` stays `'none'` and nothing mounts at
all — not even `fallback` — until the first settle. This means
`DeferredSwapBinding` cannot express "show a spinner while first loading";
that is deliberately out of scope here (it is GAP 2 / Suspense territory,
PT-1b-ii, not PT-1b-i). An author who wants first-load UI wraps the whole
`<switch pending=>` in their own outer condition keyed on
`r.loading() && r() === undefined`, exactly as tier-1's recipe already
recommends. Documented here so this reads as a scope boundary, not a bug to
"fix" later inside this binding.

**Consequence for "two propagations coexisting":** re-examined against the
actual mechanics (not just the vocabulary) — the "old live / new building"
coexistence window is a single synchronous span within one effect run (staging
build → success check → swap), not a literal multi-tick async wait. This is a
**correction to the mental model in ruling 2**, not to its conclusion: distinct
path is still right (throw-safety ordering + the `pending`-gate + the
no-op-on-same-winner check are all real divergences from
`wireConditional`/`wireSwitch`'s shape), but the justification is
construction-safety, not literal concurrent propagations.

**RETRACTED, per Architect ruling:** an earlier version of this paragraph
justified "the effect returns immediately and touches nothing" during a
pending run as "the same demand-driven-quiescence property that made tier-1
free and made HWM's inertness argument sound." **That reasoning is wrong and
was the direct cause of the dependency-collection bug below** — "returns
immediately" does not mean "touches nothing"; in a dynamic per-run dependency
graph, returning before reading a signal *unsubscribes* from it. Citing
quiescence as reassurance was reasoning about what the effect reads when it
runs, never about what makes it run again. Replaced by the stable-dep-set
invariant stated in the code comment above: all reads happen before the
pending gate, specifically so returning early costs nothing *because nothing
was skipped*, not because skipping is free.

### Adversarial pass 4 finding — CAUGHT BY ARCHITECT, NOT BY CC'S THREE PASSES (fixed)
**Issue:** all three of CC's adversarial passes on this ruling reasoned about
what the effect reads when it runs, and none asked what makes it run again.
The original code gated `pending()` *before* reading any `when()`, so a
pending run's dependency set collapsed to `{pending}` — every `when()`
subscription was severed for the duration of the pending window (verified:
nv does dynamic per-run dependency collection, `core.ts:510-534`, §5.2 — old
sources reset before `compute()`, reconciled against what was actually read).
Trace: run A (not pending) reads `{pending, when₀..whenₖ}`, mounts. Source
changes, `loading` flips true, run B (pending) reads only `{pending}` —
`when()` edges are dropped. Settle: `resource.ts:102-103` writes `data` (no
subscriber left to notice — the `when()`s reading it were unsubscribed in run
B), *then* writes `loading=false`, which is still a tracked dep, triggering
run C, which re-reads `when()` fresh and finally swaps. **The construct only
worked by coincidence — because `resource` happens to write `loading` after
`data`, and happens to always write `loading` on every settle path.** Breaks
concretely: (1) `pending` sourced from anything other than a plain `loading()`
read that itself changes across every settle (e.g. `pending="${r.loading() &&
otherFlag()}"` where the AND short-circuits differently) — stale subtree
sticks forever, silently; (2) a `when()` driven by an unrelated signal (a
filter toggle, a route param) changing *while pending* — lost permanently if
`pending` doesn't happen to flip afterward. **Fixed:** all reads (`pending()`
and the full winner-selection loop) now happen unconditionally before the
`isPending` early return, so the dependency set is identical on every run
regardless of pending state — a `when()` change while pending correctly
triggers a re-run and gets picked up (against a possibly-stale `data()`,
which is correct and desirable: it's the same value the eventually-revealed
branch is chosen from). This is now gated directly — see Task 5, item 7a/7b in
the plan.

### Adversarial pass 1 finding (fixed)
**Issue:** original sketch called `createRoot((dispose) => { mountFragment(...);
return dispose })` and assigned `newDisposer = createRoot(...)` — i.e., captured
the disposer from the *return value*, not from inside the callback. If
`mountFragment` throws, `createRoot(...)` never returns, so `newDisposer` is
never assigned — the partially-built root (already attached as a child of the
current owner per `createRoot`'s own contract, `core.ts:1293-1295`, added
*before* `fn` runs) becomes unreachable and leaks until the whole binding's
owner disposes. This is structurally the exact bug class Follow-up B′ hit
(commit-late vs. commit-incrementally). Fixed by capturing `dispose` as the
*first* statement inside the callback (`capturedDispose = dispose`), so a
`catch` block can dispose the partial root even when `createRoot` itself never
returns normally.

### Adversarial pass 2 finding (fixed)
**Issue — two different "error path" concerns were conflated on first draft.**
The commission's own G1 "Error path" item is about a **rejected refetch**
(`resource`'s fetcher promise rejects): per `resource.ts:105-114`, `data()` is
intentionally left unchanged on rejection, so `when()`/branches derived from it
resolve to the *same* winner — `winner === revealed` at line 157 is true, the
effect no-ops, old subtree stays mounted. **No code in `wireDeferredSwap` does
anything special for this case; it falls out of the no-op check for free**,
the same way tier-1 gets it for free. This is distinct from **construction
throw** (a branch's own `mountFragment` call throwing, e.g. a broken template)
— should that error be swallowed (SWR "just keep showing old forever") or
rethrown? Rethrowing was chosen: swallowing would hide
a real bug (a broken branch template) behind "looks like it's still loading,"
which is worse than a loud failure — consistent with this codebase's existing
behavior for every other wire path (none of them catch-and-hide construction
errors; `mount()`, `wireConditional`, `wireComponent` all let template errors
propagate). Old subtree is left mounted and live either way (never touched
before the try succeeds), so a caller with an `errorBoundary` upstream gets a
correctly-scoped failure without losing the currently-visible content
mid-throw.

### Adversarial pass 3 finding (fixed)
**Issue:** the no-op check (`if (winner === revealed) return`) skips rebuilding
when the winning branch index is unchanged — but does NOT protect against
rebuilding when the *same branch* wins again with genuinely new inner reactive
state (e.g., branch 0 wins, its own nested `when()`-independent content
changes). Confirmed this is correct, not a gap: `DeferredSwapBinding` only
gates the *branch-level* swap; a branch's own internal reactivity (text/attr
bindings inside its `TemplateIR`) is wired once at `mountFragment` time and
updates itself via its own effects exactly like any other mounted subtree —
re-selecting the same winner must never rebuild it. This mirrors
`wireSwitch`/`wireConditional`'s existing behavior (they also don't compare
templates for equality, only branch identity via re-run triggers) — no
divergence, no fix needed, recorded to close the question.

---

## Ruling 4 — off-anchor container strategy

**A detached `DocumentFragment` (`doc.createDocumentFragment()`), never
inserted into the live document as a fragment.** `mountFragment` accepts any
`Element | Node` as `parent` (interpreter.ts:1069) and inserts via
`insertBefore`/`appendChild` — a `DocumentFragment` satisfies `Node` and
supports both. The "a fragment empties on insertion" caveat the commission
flagged does not apply here: that gotcha is about inserting a
`DocumentFragment` *itself* into the DOM (its children move to the target,
leaving it empty) — we never do that. We hold individually-referenced `roots`
nodes (already snapshotted by `mountFragment` before its own internal insert,
same pattern `wireConditional` already relies on) and move each one via
`parent.insertBefore(n, anchorNode)` at reveal time; each such move implicitly
removes it from the staging fragment as a side effect of `insertBefore`, no
extra bookkeeping required.

### Adversarial pass 1 finding (fixed)
**Issue:** considered a detached `<div>` element instead of a
`DocumentFragment`, reasoning "simpler, no fragment-semantics surprises to
explain." Rejected: a `DocumentFragment` is the idiomatic "no extra node"
staging container and avoids ever exposing a throwaway element that could leak
into the roots list by accident (if `mountFragment`'s snapshot logic ever
changed to read `parent.childNodes` instead of `frag.childNodes`, a `<div>`
staging container would itself show up as a phantom ancestor — a
`DocumentFragment` cannot, since it is never a node in anyone's `childNodes`).
Belt-and-suspenders, not load-bearing, but free.

### Adversarial pass 2 finding (fixed)
**Issue:** what if `binding.branches` is empty and `fallback` is `null` at wire
time (`winner` computed as `'none'` on the very first run, `pending()` also
`false`)? Confirmed no crash: `template === null` branch handles this — disposes
nothing (revealedDisposer already null), sets `revealed = 'none'`, returns.
Matches `wireSwitch`'s existing handling of the same degenerate case
(`template === null → return`, no mount attempted).

### Adversarial pass 3 finding (fixed)
**Issue:** does `mountFragment(template, staging, doc, null)` risk being
confused with a *component's* multi-root `$style` check (interpreter.ts:1035-1045,
which throws on `roots.length > 1` for styled components only)? Confirmed no —
that check is local to `wireComponent`'s handling of `childIR.styleArtifact`,
not part of `mountFragment` itself; `mountFragment` fully supports multi-root
templates unconditionally (line 1107 comment). `wireDeferredSwap` branches are
plain `TemplateIR`, not component IR, so this check never applies. No `src/`
change needed to accommodate multi-root branches — they already work.

---

## Summary of what's ruled

| # | Question | Ruling |
|---|---|---|
| 1 | `.nv` surface | `<switch pending="...">` — no new tag |
| 2 | IR shape | `DeferredSwapBinding` = `SwitchBinding` + `pending` |
| 3 | Epoch/staleness | None needed — gate on `pending()`, mirror `resource`'s internal epoch by trusting it; guard construction-throw-safety instead (capture-dispose-first); **all reactive reads happen before the pending gate (dependency-collection fix, Architect-caught)** |
| 4 | Off-anchor container | Detached `DocumentFragment`, moved node-by-node at reveal |

Twelve adversarial passes run by CC across the four rulings, each with a real
finding fixed or explicitly closed as a non-issue with reasoning. **Architect's
Gate-P review found one further load-bearing bug none of the twelve passes
caught** — Ruling 3's original sketch gated `pending()` before reading
`when()`, silently unsubscribing from every branch condition during a pending
run (nv does dynamic per-run dependency collection, verified at
`core.ts:510-534`). All three of CC's passes on Ruling 3 reasoned about what
the effect reads when it runs, never about what makes it run again. Fixed:
all reads now happen unconditionally before the pending gate (see Ruling 3's
pass 4 finding); Ruling 3's incorrect "quiescence" justification for the early
return was retracted and replaced. Architect approved Rulings 1, 2, 4, and
Ruling 3's throw-safety/rethrow disposition as originally ruled; Ruling 3's
dependency-collection mechanism required the fix above before approval.
Status: **fix applied, re-submitted for Architect confirmation.**
