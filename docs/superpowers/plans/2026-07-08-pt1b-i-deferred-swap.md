# Plan — PT-1b-i: `wireDeferredSwap` (tier-2 deferred swap) + tier-1 SWR recipe

**Commission:** `pt1b-i-swr`. **Gate-P doc:** `docs/gates/pt1b-i-deferred-swap.md`
(4 rulings; REVISED after Architect's first Gate-P review found a
dependency-collection bug in Ruling 3 that all of CC's own adversarial passes
missed — fix applied, doc re-submitted). **Anchor:** main `9973042`.
**Mode:** subagent-driven-development, direct on `main` (matches this arc's
established practice — worktree only if the user asks for it this time).

**Blocking:** this plan does not start Task 1 until Architect re-confirms the
revised Gate-P doc. Gate-P forbids any `src/` touch before approval.

---

## Scope recap (from the commission)

- Deliverable 1: tier-1 SWR — a documented recipe, no code.
- Deliverable 2: tier-2 `wireDeferredSwap` — new `Binding['kind']`, both
  front-ends (interpreter + tagged-template), exhaustiveness gate satisfied,
  real-browser-gated ×3.
- Out of scope: `src/core/`, GAP 2 (Suspense), compiler async-read lowering,
  transitions/multi-version.
- **Scope reduction adopted from precedent (recorded here, not silently
  assumed):** `src/compiler/emitted-mount.ts` (the optimizing compile back-end)
  gets a stub throw for `'deferred-swap'`, mirroring the exact precedent set
  for `RecycledListBinding` (`emitted-mount.ts:808-810`, and gated as
  acceptable in `docs/gates/recycling-list-mode.md` criterion 5). The
  commission's "two front-ends" obligation is the *interpreter* (semantic
  ground truth) and the *tagged-template builder* (`html-tag.ts`) — both
  authoring/runtime surfaces — not the separate compiled-emit optimizer, which
  has its own established bring-up lag for new binding kinds.

---

## Tasks

### Task 1 — IR + exhaustiveness gate + interpreter wire path

**Files:** `src/renderer/ir.ts`, `src/renderer/interpreter.ts`.

1. Add `DeferredSwapBinding` to `ir.ts` (Gate-P Ruling 2, verbatim) and to the
   `Binding` union.
2. Add `case 'deferred-swap': wireDeferredSwap(binding, targetNode, doc); break`
   to `wireBinding`'s dispatch switch (interpreter.ts:115-187).
3. Implement `wireDeferredSwap` per Gate-P Ruling 3's reviewed algorithm
   (capture-dispose-first throw safety, `pending()`-gate, no-op-on-same-winner,
   detached-`DocumentFragment` staging, node-by-node reveal). The
   winner-selection loop is independently duplicated to match `wireSwitch`'s
   *shape* — do **not** extract a helper shared with `wireSwitch` itself; that
   would touch a G0-protected function (see Gate-P Ruling 2's correction note).
4. Add `case 'deferred-swap': throw new Error('[nv/emitted-mount] DeferredSwapBinding not yet implemented in compiler back-end')` to `emitted-mount.ts`'s dispatch, mirroring the `recycled-list` stub exactly (message format included).

**Local gate (before Task 2 starts):** `tsc --noEmit` on `interpreter.ts` and
`emitted-mount.ts` alone is expected to go red elsewhere — specifically
`html-tag.ts`'s `assertAllBindingKindsHandled`/`HandledBindingKinds` (Task 2's
job) and any other exhaustive switch over `Binding['kind']`. Task 1's own new
code must typecheck standalone; a repo-wide `tsc` red at this point is
expected and listed explicitly, not a surprise to debug.

### Task 2 — tagged-template front-end (`html-tag.ts`)

1. Extend `MatchSentinel` with `pending?: () => boolean`; extend `match()`'s
   signature to accept it as an optional third parameter; extend
   `isMatchSentinel`'s validation to accept (but not require) a function-typed
   `pending`.
2. Extend `buildSwitchBinding` (or add a sibling `buildDeferredSwapBinding`) so
   that a `MatchSentinel` with `pending` present produces a
   `DeferredSwapBinding` instead of a `SwitchBinding` — same branches/fallback
   extraction, forked only on `kind` and the extra field. Reuse the extraction
   logic; do not duplicate the branch-walking loop (collapse discipline, same
   standard this whole arc has held to).
3. Add `case 'deferred-swap':` to `assertAllBindingKindsHandled` (comment
   citing `match()`'s `pending` option, same style as the existing `'switch'`
   comment) and to the `HandledBindingKinds` union.

**Local gate:** `tsc --noEmit` clean, repo-wide, at the end of Task 2 — this is
the "must land in both front-ends in one merge" requirement; Task 1 and Task 2
land in the **same commit** (not two), so there is no window where `tsc` is
red on `main`.

### Task 3 — `.nv` authoring surface (parser)

**File:** `src/renderer/nv-parser.ts`.

1. Extend `<switch>` element parsing to read an optional `pending=` attribute
   (hole reference, same extraction mechanism already used for `when=` on
   `<match>` — read the existing `whenHoleIdxs`-style extraction at
   `nv-parser.ts:850+` before writing this, reuse its pattern).
2. When `pending=` is present, the emitted binding is `DeferredSwapBinding`;
   absent, unchanged `SwitchBinding` (byte-identical parse path — verify via
   diff that no existing `<switch>` fixture's parsed IR changes).
3. Decide and document: does `<switch pending=>` with **zero** `<match>`
   children throw the same `'<switch> requires at least one <match> child'` as
   plain `<switch>` today (`nv-parser.ts:835`)? **Ruling: yes, unchanged** —
   `pending` only changes *when* the swap reveals, not whether branches are
   required; inheriting the existing validation avoids a second special case.

**Local gate:** existing `<switch>`/`<match>` fixtures re-parsed, IR
byte-identical to pre-change (proves the fork is additive, not disruptive).

### Task 4 — tier-1 SWR recipe (documentation)

**File:** new `docs/guides/stale-while-revalidate.md` (or existing
`docs/guides/` location — read the directory first to match naming
convention).

Content per Gate-P/commission: keep the resolved view mounted, drive an
optional pending indicator from `loading()`, do not branch to a fallback once
data has arrived once; the "why it's free" explanation (demand-driven
quiescence). Cross-link from `resource`'s JSDoc (`resource.ts:1-18`) with a
one-line pointer, not a duplicated explanation.

**Local gate:** a doc-example test (real code, not prose) demonstrating the
pattern — matches G1's "Tier-1 recipe verified" requirement. Lives under
`test/renderer/` or `test/browser/` depending on whether JSDOM suffices (it
should — tier-1 is plain consumer code over existing primitives, no new wire
path, no real-browser DOM-timing question to gate).

### Task 5 — real-browser gates (×3 browsers)

**Files:** new `test/browser/deferred-swap.spec.ts` +
`test/browser/fixtures/deferred-swap/`.

Real-browser assertions for every item in the commission's G1 list:
1. **Deferred reveal** — during a pending window (a controllable fetcher, e.g.
   an explicit resolve-later `Promise` under test control — check
   `test/browser/fixtures/` for an existing "controllable async" fixture
   pattern before inventing one, likely already exists for `resource`'s own
   browser tests), the old subtree's DOM nodes are the *same node references*
   throughout (identity-preserving, not just content-equal) and its own
   effects still run (assert a live counter/text update on the old subtree
   fires while pending).
2. **Atomic swap on settle** — snapshot DOM mutations across the reveal tick;
   assert no frame has both branches attached, none has neither (for a
   real-browser assertion of "no frame," use a `MutationObserver` recording
   childList changes across the reveal, not a timing guess).
3. **Supersession** — trigger two source changes in quick succession while the
   first is still pending; assert only the final branch is ever revealed and
   the intermediate one's root never attaches (owner-tree/effect-count
   assertion for "never attached," not just "eventually disposed" — the
   distinction matters because `resource`'s own epoch guard is what prevents
   the intermediate `data()`/`when()` state from ever being observed at all,
   per Gate-P Ruling 3; this test is really exercising *resource's* guarantee
   as observed through this binding, not a separate mount-layer mechanism —
   phrase the test comment accordingly so a future reader doesn't think
   `wireDeferredSwap` has its own epoch counter).
4. **Dual disposal on teardown mid-pending** — start a pending swap, dispose
   the parent region before it settles; assert the *live-old* subtree's owner
   tree is gone. (There is no "off-anchor new" to dual-dispose in the settled
   design — Gate-P Ruling 3 revised the two-propagation model to a
   single-synchronous-span construction-safety guard, so "dual disposal"
   collapses to: disposing while pending only ever has the old subtree live;
   confirm no leak of a `DocumentFragment` staging container either, since one
   is never created until `pending()` goes false.)
5. **Error path — two distinct concerns, both tested:**
   - **5a. Rejected refetch (the commission's literal G1 ask):** a
     `resource()` fetcher promise rejects. Per `resource.ts:105-114`, `data()`
     is left unchanged on rejection, so the deferred-swap binding's `when()`
     reads resolve to the same winner and no-op (Gate-P Ruling 3 pass 2 traces
     why no special-case code is needed). Assert: old subtree stays mounted,
     `r.error()` reflects the rejection, no swap occurs, no orphan.
   - **5b. Construction throw (added beyond the commission's literal list, for
     the throw-safety guard Gate-P Ruling 3 exists to provide):** a branch
     template that throws during `mountFragment` (e.g., a fault-injected
     `itemTemplate`-style throw, matching this codebase's existing
     fault-injection convention from the HWM throw-safety test) leaves the old
     subtree mounted and live; the thrown error propagates out of the effect
     (assert via an uncaught-error hook / flush rejection, matching however
     this repo's existing tests observe effect-thrown errors — check
     `test/core/` for the pattern before inventing one).
6. **First-load pending renders nothing** — with a `resource()` whose first
   fetch has not yet settled, assert the anchor has no revealed content at all
   (not even `fallback`) until first settle — locks in the scope boundary
   documented in Gate-P Ruling 3 (no first-load spinner affordance in this
   binding; that's GAP 2/Suspense territory) so it isn't later "fixed" as a
   perceived bug.
7. **Dependency-collection regression (Architect-required, direct gate for the
   bug found on Gate-P review — not optional, do not fold into another item):**
   - **7a.** While `pending()` is true, change a `when()` driven by a signal
     *unrelated to the resource* (e.g. an independent filter-toggle signal a
     later branch's `when()` reads). On settle (`pending()` flips false), the
     branch reflecting the LATEST `when()` state is revealed — not a stale
     winner computed from the pre-change branch state. This is the direct
     regression test for the dependency-collection bug: a broken
     implementation that gates `pending()` *before* reading `when()`
     (severing those subscriptions during the pending run) passes items 1-6
     above but fails this one, because the `when()` change during the pending
     window would never be observed.
   - **7b.** `pending` sourced from an expression that does **not** reliably
     change across every settle (e.g. `pending="${r.loading() &&
     someOtherFlag()}"`, constructed so the AND result doesn't toggle on a
     given settle) — the swap still reveals correctly once `pending()`
     actually reads false, proving correctness does not depend on `pending`
     specifically being `loading()` or on it necessarily toggling on every
     settle path.
9. **FE-equivalence** — `.nv` and tagged-template forms of the same
   `<switch pending=>`/`match(..., pending)` produce structurally identical IR
   against the shared oracle (same harness this repo already uses for
   switch/conditional FE-equivalence — locate and reuse it).
10. **Exhaustiveness gate** — `tsc --strict` green, `HandledBindingKinds`
   assertion holds (compile-time, not a runtime test, but list it as a CI-gate
   checklist item).
11. **No regression** — full existing `wireConditional`/`wireSwitch`/`<each>`/
   `<recycle>` suites green, byte-diff of those files empty (this task must
   not touch them at all — `wireDeferredSwap` is fully additive).
12. **Tier-1 recipe verified** — covered by Task 4's doc-example test; listed
    here only as a cross-reference so Task 5's closure report can confirm it
    without re-deriving it.

### Task 6 — closure report + decision-log delta authorship note

Full regression (`pnpm typecheck && pnpm test` + `pnpm exec playwright test`),
SHA-verified, `docs/implementation-state.md` updated in the same pass. Per the
commission: **the decision-log delta is Architect's to write on landing** (close
PT-1b-i, Template-IR bump for the new binding kind per the `SwitchBinding`
precedent, Current State edit) — Task 6 drafts the paste-ready delta for
Architect but does not apply it to `decision-log.md` itself, matching how every
other landing in this arc has worked.

---

## Gates (commission's G0/G1, mapped to tasks)

| Gate item | Enforced by |
|---|---|
| No `src/core/` diff | Task 6 closure report — `git diff main -- src/core/` empty |
| Tier-2 not built by mutating `wireConditional`/`wireSwitch` | Task 1 — `wireDeferredSwap` is a new function; `wireConditional`/`wireSwitch` byte-diff empty in Task 6 |
| No second epoch scheme | Gate-P Ruling 3 — enforced by code review at Task 1 (no `gen`/`epoch` variable in `wireDeferredSwap`) |
| New kind lands in both FEs, same commit | Task 1 + Task 2 land together; Task 6 confirms via `git log` that no intermediate commit has one FE without the other |
| No double-mount / no-neither frame | Task 5, item 2 (`MutationObserver`) |
| No superseded-pending leak | Task 5, item 3 |

---

## Adversarial review — plan (3 passes)

### Pass 1 (structural completeness)

**Finding A (fixed):** original draft had Task 1 and Task 2 as separate
commits ("Task 1 lands interpreter, Task 2 lands html-tag.ts in a follow-up").
This directly violates the commission's G0 disqualifier ("New binding kind
landed in one front-end only, or in a separate commit from the other — no
window where `tsc` is red or one FE lacks the capability"). **Fixed:** Task 1
and Task 2 are now explicitly required to land in the same commit; added to
the gate table.

**Finding B (fixed):** no task covered the `emitted-mount.ts` stub at all —
the plan silently assumed it and moved on. Since the commission requires "both
front-ends," and `emitted-mount.ts` is a THIRD surface that dispatches on
`Binding['kind']`, leaving it unhandled would either (a) leave a real
exhaustiveness gap if `emitted-mount.ts` has its own `never`-check (it does
not appear to — it's a plain switch with a stub throw pattern, needs
confirming at Task 1 time) or (b) silently 404 at runtime for any compiled
(non-interpreter) consumer. **Fixed:** added explicitly to Task 1, step 4, with
the exact precedent cited (recycled-list stub) so it isn't treated as a
scope-creep addition later.

**Finding C (fixed):** Task 5's "supersession" test description originally
implied `wireDeferredSwap` has its own staleness-detection logic to verify.
Per Gate-P Ruling 3 this is wrong — the guarantee is `resource`'s, observed
through the binding. **Fixed:** reworded item 3 to say the test exercises
`resource`'s guarantee as observed through the binding, with an explicit note
against implying a separate mount-layer epoch mechanism (prevents a future
reader from "fixing" a phantom gap).

### Pass 2 (test-gate rigor — could a broken implementation pass these gates?)

**Finding D (fixed):** "Deferred reveal" (Task 5 item 1) originally only
checked that old content was *present*, not that it was the *same node
references* and still *live* (effects running). A broken implementation that
disposed-and-immediately-remounted an identical-looking old subtree on every
pending tick would pass a content-only check while violating the actual
SWR contract (loses local DOM state — focus, scroll position — exactly the
failure mode `<recycle>`'s identity contract was built to catch). **Fixed:**
item 1 now requires node-identity assertion + a live-effect assertion, not
content equality.

**Finding E (fixed):** "Atomic swap on settle" (item 2) originally said "assert
before/after snapshots differ correctly," which cannot actually catch a
same-tick double-attach (a snapshot taken before and after a synchronous
mutation can't see what happened *between* them). **Fixed:** specified a
`MutationObserver` recording every childList mutation across the reveal, so
the assertion is over the actual mutation sequence, not just endpoints.

**Finding F (fixed):** the error-path test (item 5) didn't specify *how* the
test observes an effect-thrown error, leaving room for a subagent to invent an
ad hoc mechanism inconsistent with how this codebase already surfaces
effect-thrown errors elsewhere (risk of a test that "passes" by swallowing the
throw rather than observing it, defeating the whole point of the throw-safety
guard). **Fixed:** item 5 now explicitly requires locating and reusing the
existing pattern from `test/core/` before writing a new one.

### Pass 3 (drift and honesty check — does the plan match what Gate-P actually ruled, or has it silently re-derived something)

**Finding G (fixed):** Task 3 step 3 initially proposed a NEW validation rule
("`<switch pending=>` with zero `<match>` children is allowed, degrading to
`fallback`-only") without citing why — a silent, unruled behavior change to
existing `<switch>` semantics smuggled in as a "natural" extension. On review
this is exactly the kind of undecided-design-gate move this repo's culture
explicitly forbids ("halt at an undecided design gate — do not invent the
decision"). **Fixed:** reversed to inherit the existing zero-`<match>` throw
unchanged, with the reasoning made explicit in the plan (item 3, now framed as
a ruling with justification, not an assumption) — this is a genuine design
decision, small enough to make directly and cite, not one requiring a fifth
Gate-P ruling, but it must not be silent.

**Finding H (fixed):** Task 4 (tier-1 recipe) was drafted with no local gate at
all — "just write the doc." The commission's G1 explicitly lists "Tier-1
recipe verified" as a gated item, not a free pass because it's "just docs."
**Fixed:** added the doc-example-test requirement to Task 4, and cross-
referenced it from Task 5 item 9 so the closure report doesn't have to
re-derive where that verification lives.

**Finding I (fixed, then corrected in Pass 4):** the plan never stated where the
branch-selection extraction logic should live relative to `wireSwitch`'s
winner-selection loop. First fix required "factoring the shared branch-
selection loop rather than copy-pasting it" — **this was wrong and was reversed
in Pass 4 below.**

All nine findings across three passes fixed in the text above.

### Pass 4 (final consistency check — plan vs. Gate-P, requested as a last review)

**Finding J (fixed):** Finding I's fix directly contradicted two other parts of
this same plan: the gate table's "`wireConditional`/`wireSwitch` byte-diff
empty in Task 6" row, and the commission's own G0 disqualifier ("Tier-2
implemented by mutating `wireConditional`/`wireSwitch`"). You cannot extract a
shared helper out of `wireSwitch`'s existing inline loop *and* leave
`wireSwitch` byte-identical — factoring is itself a mutation, forbidden
outright by G0 regardless of whether it's behavior-preserving. **Fixed:**
Task 1 step 3 now says the opposite of the original Finding I fix — the loop
is independently duplicated, matching `wireSwitch`'s shape but sharing no code
with it, consistent with this codebase's existing precedent that
`wireConditional`/`wireSwitch` are themselves independently-duplicated
siblings, not DRY'd into a shared helper. (Task 2's html-tag.ts extraction
instruction is unaffected and stays as originally written — the G0
disqualifier names only the interpreter's `wireConditional`/`wireSwitch`
functions, not `html-tag.ts`'s IR-building helpers, so factoring
`buildSwitchBinding`'s branch-walking logic remains a legitimate, unforbidden
DRY opportunity there.)

**Finding K (fixed):** Task 5 item 5 ("Error path") only tested construction-
throw safety — a test I had derived from the throw-safety lesson — but never
tested what the commission's G1 list actually asked for: a **rejected
refetch** leaving the old subtree mounted (SWR semantics matching `resource`'s
own not-clearing-data-on-error behavior). The two are different failure modes
at different layers and neither one substitutes for the other. **Fixed:**
item 5 split into 5a (rejected refetch — falls out of the no-op check for
free, per Gate-P Ruling 3's added note) and 5b (construction throw, the
original test, kept).

**Finding L (fixed):** neither the plan nor the original Gate-P doc recorded
that `binding.pending()` gates *before* any branch/fallback is read, meaning
the very first render — the common case where a fresh `resource()` starts
`loading()` true before its first settle — reveals nothing at all, not even
`fallback`. This is a real, non-obvious behavioral consequence a future reader
could easily mistake for a bug and "fix" by moving the pending-check after
fallback resolution, quietly reintroducing a first-load-flash affordance this
binding was deliberately scoped not to have (that's GAP 2/Suspense territory).
**Fixed:** documented as an explicit "Consequence" note in Gate-P Ruling 3, and
added as Task 5 item 6 (a locking-in test) — renumbering the rest of the list.

Three additional findings in this final pass, all fixed; two (J) directly
reversed an earlier fix that had introduced a new contradiction rather than
resolving one — recorded rather than silently re-edited, so the history of
*why* the code shows independent duplication (not a missing refactor) survives
for whoever implements Task 1.

### Pass 5 — Architect's Gate-P review (bug found; not caught by CC's four passes)

**Finding M (fixed):** Architect's Gate-P review found a load-bearing
dependency-collection bug in Ruling 3's `wireDeferredSwap` sketch that none of
CC's four adversarial passes on this plan, nor any of the twelve passes on the
Gate-P doc itself, caught. The original code gated `binding.pending()` *before*
reading any `when()` — in nv's dynamic per-run dependency-collection model
(verified `core.ts:510-534`), this unsubscribes the effect from every `when()`
for the duration of a pending run. The construct only kept working by
coincidence (`resource` happens to write `loading` after `data`, and happens
to always write `loading` on every settle path); a `when()` driven by a signal
unrelated to the resource, or a `pending` expression that doesn't reliably
toggle on every settle, silently drops updates. **Fixed:** Gate-P Ruling 3's
code sample now reads `pending()` and the full winner-selection loop
unconditionally before any early return (dependency set now identical on
every run); the "quiescence" justification for the early return was retracted
as backwards reasoning (returning early unsubscribes, it isn't free) and
replaced with a stable-dependency-set invariant, stated as a code comment.
**Plan-side fix:** Task 5 gained item 7 (two sub-tests, 7a/7b) as the direct
regression gate for this bug — required by Architect, not optional, not folded
into another item. Task 1 step 3's reference to "Gate-P Ruling 3's reviewed
algorithm" now points at the corrected version; no other task needed changes
(the bug was internal to the wire function's own reactive-read ordering, not
to IR shape, authoring surface, or container strategy — Rulings 1, 2, and 4
stand as originally approved).

This is the second time a real correctness issue survived CC's own multi-pass
review and was only caught by an external reviewer with a different failure
mode in mind (the first was the Follow-up B′ throw-safety bug, caught by a
deep-review pass rather than the original implementation's own review). Worth
naming directly: CC's adversarial passes on Ruling 3 all asked "what does the
effect read when it runs" and none asked "what makes it run again" — a
category of question worth adding explicitly to future review checklists for
any effect with an early-return gate.

---

## Execution record — Tasks 1-6 landed

- Task 1+2 (IR, exhaustiveness gate, interpreter wire path, tagged-template FE)
  — landed `a1cd742`, both front-ends in one commit as required.
- Task 3 (`.nv` `<switch pending=>` parser surface) — landed `26b9832`.
- Task 4 (tier-1 SWR recipe doc + test) — landed `1e88f32`. Found and fixed a
  real error in the plan's own illustrative code: `r.loading() && r() ===
  undefined` does NOT give free node-identity preservation, because
  `wireConditional` has no same-winner no-op check (unlike `wireDeferredSwap`)
  — reading `r.loading()` inside the condition makes it a tracked dependency
  and rebuilds the view on every refetch. Corrected the recipe to gate on
  `r()` alone; verified with a failing-then-passing anti-pattern regression
  test, not asserted from theory.
- Task 5 (real-browser gates) — landed `717ce43`. Surfaced two genuine,
  previously-undetected bugs in the already-landed `wireDeferredSwap` (see
  Gate-P doc's "Post-approval implementation findings", Findings N and O):
  an ownership bug where the revealed subtree was a child of its own
  triggering effect (torn down by `preRunCleanup` on any re-run, defeating
  the construct entirely — fixed via `capturedOwner`/`runWithOwner`, the
  same pattern already used 3x elsewhere in `interpreter.ts`), and a swap-
  ordering gap (dispose-before-insert created a real, `MutationObserver`-
  visible "neither attached" window — fixed by reordering to insert-then-
  dispose). Also found and corrected an over-strict G1 requirement ("no frame
  has both") that is structurally unachievable for multi-root swaps without
  a wrapper element this codebase deliberately doesn't use, and is invisible
  to any paint regardless. Also found a general nv-scheduler property
  (unbatched independent signal writes can produce transiently-inconsistent
  recomputes) — correctly identified as out-of-scope (would need a
  `src/core/` `batch()` API, G0-protected) rather than worked around inside
  `wireDeferredSwap`.

**Pattern worth naming:** this is the third distinct correctness bug this
specific algorithm survived past a review layer that should have caught it —
CC's own four adversarial passes missed the dependency-collection bug;
Architect's Gate-P review (which DID catch that one) didn't check the
ownership question, since it was verifying a different property
(`createRoot` attaches before `fn` — true, but orthogonal to "does the
revealed subtree survive the effect's OWN re-run"). All three bugs were only
caught by a layer that actually *ran* the code under the specific condition
that exposed them (fault-injection test, then real-browser test). Static
review — however many passes — did not substitute for execution here.

## Definition of done (unchanged from commission, restated for tracking)

Tier-1 recipe documented + gated; tier-2 `wireDeferredSwap` landed in both
front-ends (interpreter + tagged-template) in one commit, identical IR;
deferred reveal, atomic swap, supersession, dual disposal, and error-path SWR
all real-browser-gated ×3 browsers; exhaustiveness gate green; no regression;
empty `src/core/` diff; `docs/implementation-state.md` updated; committed to
main, verified at SHA; decision-log delta drafted for Architect, not
self-applied.

## First moves (once Gate-P is approved)

1. Dispatch Task 1 to a fresh subagent with this plan + the Gate-P doc as
   required reading.
2. Task-reviewer checks Task 1's output against the gate table above before
   Task 2 starts (Task 1+2 must land together — reviewer confirms Task 1's
   diff is uncommitted / staged-not-pushed until Task 2 is ready, or the two
   are executed as one combined task by one subagent — decide at dispatch
   time based on how the subagent-driven-development skill's task-sizing
   guidance reads this case).
