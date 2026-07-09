# PT-1b-i (`wireDeferredSwap`, tier-2 deferred swap) — LANDED

**SHA:** `717ce43` (Task 5, latest). Full chain: `8ce3d2e` (Gate-P doc committed)
→ `a1cd742` (Task 1+2) → `26b9832` (Task 3) → `1e88f32` (Task 4) → `717ce43`
(Task 5, includes the ownership + swap-ordering fixes).

## What landed

- **Tier-1 SWR recipe** (`docs/guides/stale-while-revalidate.md`): documented
  as a plain consumer pattern over `resource()` — no engine work. Corrected the
  commission's own illustrative example during implementation (see below).
- **Tier-2 `wireDeferredSwap`** (new `Binding['kind']` = `'deferred-swap'`):
  holds the currently-revealed branch of a `<switch pending=>` mounted and
  live while `pending()` is true, swaps atomically once settled. Landed in
  both authoring front-ends in one commit (`a1cd742`): interpreter
  (`wireDeferredSwap`) + tagged-template (`match(branches, fallback,
  pending)`). `.nv` authoring surface (`<switch pending="...">`) landed
  separately (`26b9832`) since it required its own read of the parser.
  Compiler back-end (`emitted-mount.ts`/`nv-emitter.ts`) is a deliberate stub,
  matching the `RecycledListBinding` precedent.

## Verified state

- `pnpm typecheck`: clean.
- `pnpm test`: 844/844 unit tests.
- `pnpm exec playwright test`: 405/405 real-browser tests (×3 browsers:
  Chromium, WebKit, Firefox), including the new 27-test `deferred-swap.spec.ts`
  (9 items × 3 browsers) covering every G1 requirement plus the
  dependency-collection regression Architect required.
- `git diff main -- src/core/`: empty.
- `wireConditional`/`wireSwitch` in `interpreter.ts`: byte-diff empty across
  the whole arc (verified after every task, not just at the end).

## The honest part: three real bugs, caught at three different layers

This design went through more adversarial scrutiny than most — four rounds of
my own review, then Architect's Gate-P review — and still shipped with a
second load-bearing defect that only real-browser testing caught. Recording
this plainly rather than only the clean parts:

1. **Dependency-collection bug** (caught by Architect's Gate-P review, before
   any `src/` was touched): gating `pending()` before reading `when()`
   silently unsubscribed the effect from every branch condition during a
   pending run. Fixed before Task 1 started; not present in the landed code.

2. **Ownership bug** (caught by Task 5's real-browser test, after landing —
   NOT caught by Gate-P review, NOT caught by my four adversarial passes,
   NOT caught by Task 1's own implementer/verifier): the revealed subtree's
   `createRoot()` ran from inside `wireDeferredSwap`'s own effect compute,
   making it a child of that effect node. `core.ts`'s `preRunCleanup` disposes
   all children of a node at the start of every one of *that node's own*
   recomputes — so the held subtree was torn down on any re-run, before the
   `isPending` check ever ran. This defeated the entire construct. Fixed by
   capturing the owner before `effect()` and mounting via
   `runWithOwner(capturedOwner, ...)` — the same pattern already used 3x
   elsewhere in `interpreter.ts` for exactly this class of problem. Verified
   directly against `core.ts` source before accepting the test's diagnosis,
   not assumed from the failure alone.

3. **Swap-ordering gap** (caught by the same Task 5 pass): dispose-before-
   insert created a real, `MutationObserver`-visible window where nothing was
   attached. Fixed by reordering to insert-then-dispose. Also corrected an
   over-strict original requirement ("no frame has both") that turned out to
   be structurally unachievable for multi-root swaps without a wrapper
   element this codebase deliberately doesn't use — and irrelevant anyway,
   since it's invisible to any actual paint.

A fourth thing was found and correctly **not** fixed: a general nv-scheduler
property (independent signal writes aren't auto-batched, so an effect
depending on two signals written at different times can see two transiently-
inconsistent recomputes). Reproduced with a minimal two-plain-signal repro,
confirmed it's not `wireDeferredSwap`-specific, confirmed a real fix would
need a `batch()` API in `src/core/` (G0-protected, out of scope), and adjusted
the one test that had accidentally been exercising it rather than its
intended target. Documented in `docs/implementation-state.md`'s known-gaps
section for whoever picks up a future `batch()` commission.

**Pattern worth naming for future commissions:** every one of these three
real bugs was caught by a layer that *ran* the code under the specific
condition that exposed it (Architect's source-level trace for #1, real-browser
tests for #2 and #3) — not by additional rounds of static review. Four
adversarial passes on the same static reasoning did not surface #2 or #3;
one real-browser test each did, immediately and unambiguously.

## Also fixed along the way (not part of the original scope, found and closed)

- `docs/guides/stale-while-revalidate.md`'s illustrative tier-1 example
  (`r.loading() && r() === undefined`) does not actually give free node-
  identity preservation, because `wireConditional` has no same-winner no-op
  check. Corrected the guide; verified with a failing-then-passing regression
  test.
- `ir-equivalence.ts`'s `bindingEqual` had no case for `'deferred-swap'` —
  any two such bindings compared through the shared FE-equivalence oracle
  would have silently short-circuited to "equal" after only the `kind` check.
  Added the missing case while writing Task 5's FE-equivalence test.

## What's next

Per the commission: the decision-log delta is Architect's to write on
landing (close PT-1b-i, Template-IR bump for the new binding kind per the
`SwitchBinding` precedent, Current State edit). Draft below.

---

## Paste-ready decision-log delta

### [2026-07-08] PT-1b-i (`wireDeferredSwap`, tier-2 deferred swap) LANDED `717ce43`

**Commission:** `pt1b-i-swr`, workstream (3). Gate-P doc
(`docs/gates/pt1b-i-deferred-swap.md`) ruled 4 items (`.nv` surface, IR shape,
swap/epoch discipline, off-anchor container), 12 CC adversarial passes,
Architect Gate-P review found and required a fix for a dependency-collection
bug none of the 12 passes caught (gating `pending()` before reading `when()`
silently unsubscribed from branch conditions during a pending run — fixed by
reading all reactive state before any early return). Architect approved the
revised design.

**Landed:** `DeferredSwapBinding` (`SwitchBinding` + `pending: ReactiveExpr
<boolean>`) — Template-IR bump to **v0.4.5** (new binding kind, additive
union member, same class of bump as `SwitchBinding`'s own landing). Both
authoring front-ends (interpreter `wireDeferredSwap`, tagged-template
`match(branches, fallback, pending)`) landed together in one commit
(`a1cd742`), `.nv` surface (`<switch pending="...">`) in a follow-up commit
(`26b9832`, additive-only parse fork). Tier-1 SWR documented as a consumer
recipe, no engine work (`docs/guides/stale-while-revalidate.md`).

**Two further bugs found post-approval, during real-browser test authoring
(Task 5), fixed before this landing:** (1) an ownership bug — the revealed
subtree was mounted as a child of its own triggering effect, so
`preRunCleanup` disposed it on any re-run before the pending-gate ever ran,
defeating the construct; fixed via `capturedOwner`/`runWithOwner`, the
pattern already used 3x elsewhere in `interpreter.ts`. (2) a swap-ordering
gap — dispose-before-insert created a real `MutationObserver`-visible
"neither attached" window; fixed by reordering to insert-then-dispose.
Neither bug was caught by Gate-P review or CC's adversarial passes; both were
caught by real-browser tests actually exercising the construct.

**Also found, correctly left unfixed:** a general nv-scheduler property
(independent signal writes across a sync-write + later-promise-write pair
are not auto-batched, producing two transiently-inconsistent recomputes
instead of one) — reproduced independent of `resource()`/`wireDeferredSwap`,
would need a `batch()` API in `src/core/` (G0-protected). Noted in
`docs/implementation-state.md`'s known-gaps for a future commission; not
blocking here.

**Contract impact:** none (v0.4.3 reactive-core contract unchanged; renderer-
layer only). **Result:** PT-1b-i CLOSED. `src/core/` diff empty across the
whole arc. Full regression: 844/844 unit, 405/405 real-browser (×3).

**Current State edit:** replace the PT-1b entry's "Rulings 2 (tier-2 wire
path) + 3 (Suspense vs errorBoundary) remain before commission... PT-1b SPLIT
[2026-07-03]..." tail with: *"PT-1b-i (SWR/deferred-swap) LANDED
[2026-07-08] `717ce43` — see decision-log entry. PT-1b-ii (Suspense
coordination, GAP 2) remains open, blocked on ruling 3 (vs errorBoundary
§5.4.4 owner-scope, and whether it's the roadmap's v1.0.0 concurrency item)."*
