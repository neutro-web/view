# `<recycle>`-in-`<each>` Emit Support — Verification Gate

> **Gate instantiation** of `docs/gates/README.md`. Filled **before** CC starts, from
> `commission-recycle-in-each-emit.md` (Follow-up A′, opened by the Follow-up A landing,
> `b0409cf`) — per AGENTS.md, not repeating Follow-up A's retroactive-gate deviation
> (`docs/gates/nested-structural-emit.md`).
>
> **Fork ruling recorded going in:** (a) accepted as the working prior — the parse/emit
> sites (`toPendingBundle`, `computeBodyThunks`'s unconditional `computeRecycledListThunks`
> call, the top-level `pushRecycledListBinding` call site) are already uniform across
> each-body and non-each-body; only the `:1332` gate + `:1328` throw in
> `buildNvSlotContentIR` (`nv-parser.ts`) single out each-bodies. **This is a structural
> inference, not empirical proof** — no fixture in the current suite exercises
> recycle-in-each on any back-end (only each-in-recycle exists). GATE (tests) below is
> where (a) becomes proven or (b) surfaces. If the fixture needs anything beyond the
> two-line collapse (remove throw, remove `!isEachBody` gate) to pass, that is (b)
> surfacing — STOP, do not patch around it, escalate.
>
> **Correction (adversarial review, 2026-07-02, before implementation starts):** the
> commission's G1 wording says "three-back-end parity." That is not achievable for any
> `<recycle>`-involving fixture today — `emitted-mount.ts`'s `recycled-list` case is a
> pre-existing, unconditional stub (`throw new Error('[nv/emitted-mount]
> RecycledListBinding not yet implemented in compiler back-end')`,
> `src/compiler/emitted-mount.ts:808-812`), documented in `docs/implementation-state.md`
> as "not on the v1 build-pipeline path." This predates A′, covers top-level `<recycle>`
> too, and is not each-body-specific. The `each-in-recycle` fixture (Follow-up A) already
> established the precedent for this: its gate test is Mode-A-only, not three-way. This
> gate's parity item below is corrected to two real back-ends (interpreter + Mode-A),
> matching that precedent — implementing `RecycledListBinding` in `emitted-mount.ts` is
> explicitly OUT OF SCOPE for this gate.
>
> **Status: PASSED — 2026-07-02**

**Pre-marker.** `<pre>` = `7d94e0d` (main HEAD at work start, confirmed ≥ `b0409cf`).
Work done directly on `main` (no worktree), not yet committed at time of gate-fill —
commit to follow this gate pass.

---

## GATE 0 — Disqualifiers (STOP if either fails)

- [x] **On main's HEAD, or a reviewed branch about to merge.** Work performed directly
  on `main` per explicit instruction (not a worktree). Uncommitted at gate-fill time;
  will be committed as a real commit immediately after (no worktree-only silent-no-op
  risk — `git status` shows the diff live in the tracked working tree of `main` itself).
- [x] **Full gate green on HEAD, all four — paste actual output, not paraphrase.**
  ```
  $ pnpm typecheck && pnpm test && pnpm lint && pnpm build
  > tsc -p tsconfig.json --noEmit          → (no output = clean)
  > vitest run                             → Test Files 43 passed | Tests 835 passed (835)
  > biome check .                          → Checked 112 files. Found 2 warnings, 0 errors.
  > tsc -p tsconfig.build.json             → (no output = clean)
  ```
  835 = the 834 baseline (reconfirmed via `git stash` round-trip to `<pre>`, ran green
  there too before applying this diff) + 1 new invariant-by-construction unit test
  (P2C-NEST-03b). The 2 biome warnings are in `src/renderer/html-tag.ts:480` and
  `src/renderer/interpreter.ts:696` (`suppressions/unused`) — confirmed via
  `git diff <pre>..HEAD --stat -- src/renderer/html-tag.ts src/renderer/interpreter.ts`
  (empty) that this diff never touches either file — pre-existing, unattributable to A′,
  same two warnings the nested-structural-emit gate already noted as pre-existing.
- [x] **Browser suite green.** `pnpm test:browser` / `npx playwright test --project=chromium
  --project=webkit --project=firefox` → **276 passed**, 0 failed. 276 = 258 baseline + 18
  new (6 new recycle-in-each tests × 3 browsers: G1 DOM, two-back-end parity, reactivity,
  per-item recycling, outer keyed identity, disposal).

---

## GATE 1 — Contract & scope invariants

- [x] **No `src/core/` touch.** `git diff <pre>..HEAD --stat -- src/core/` → empty.
- [x] **Whole-diff `src/` scope matches the collapse-discipline claim.**
  `git diff <pre>..HEAD --numstat -- src/` → only `src/renderer/nv-parser.ts` (+9/-19).
  No other `src/` file touched — `interpreter.ts` and `emitted-mount.ts` both confirmed
  empty-diff (see GATE 0 above).
- [x] **`<recycle>`'s locked invariants unchanged.** `key=`-forbidding checks (three
  sites: attr, `.key=` prop, and bare `key`), position-identity semantics, and the
  two-let-name-count check (`pe.letNames.length !== 2`, nv-emitter.ts) are all untouched —
  none appear in the diff. Template-IR stays v0.4.5, contract stays v0.4.3 (no version
  bump; confirmed no `ir.ts`/contract-doc diff).
- [x] **One path, not a fourth.** `pushRecycledListBinding` now runs unconditionally in
  `buildNvSlotContentIR` — no `isEachBody` branch survives around it (the entire
  `isEachBody` parameter was removed from the function signature as dead code once both
  conditionals on it were collapsed — a step beyond the plan's literal "update the
  comment," justified because leaving an unused parameter with no live read is itself a
  hygiene defect the plan's own "no dead placeholder" close-out item would flag). Current
  call site:
  ```
  // Wire <recycle>-in-slot (D-SS-2: same structural path as lists), for both
  // component slot bodies and <each> item bodies — same call as the top-level path.
  for (const wl of slotRecycledLists) {
    pushRecycledListBinding(wl, allPaths, bindings)
  }
  ```
  — same unconditional shape as the top-level path's call (unchanged, not touched by
  this diff).
- [x] **The three seam sites are now symmetric.** Binding-push (above), pending-bundle
  (`toPendingBundle`, unchanged — already unconditional), and thunk-assembly
  (`computeBodyThunks`'s `computeRecycledListThunks` call, unchanged call site) all
  operate unconditionally on `slotRecycledLists`/`pending.recycles` regardless of
  each-body/non-each-body. **Both** stale comments were updated: the `:3597`-region
  comment in `computeBodyThunks` now reads "pending.recycles is populated symmetrically
  with the other three structural channels... this call's positional pairing... holds by
  construction, not by a parse-time guard"; the sibling comment at the `<each>`-body
  `buildNvSlotContentIR` call site was corrected from "isEachBody — <recycle> inside
  <each> body is unsupported" (now false) to "used only to extend slotSignals; <recycle>
  nests fine here." `grep -n "cannot be nested\|safe TODAY only because\|is unsupported"
  src/renderer/nv-parser.ts` → **no matches** (confirmed empty).

---

## GATE 2 — Parser artifact (`nv-parser.ts`, placed & read)

- [x] **Throw removed, not caught-and-swallowed.** The
  `if (isEachBody && slotRecycledLists.length > 0) throw ...` block is deleted entirely —
  no feature flag, no downgraded warning, no silent binding-drop. Confirmed by the same
  grep as above (zero matches for the throw's message).
- [x] **Reverse direction (each-in-recycle) byte-unaffected.** `git diff <pre>..HEAD --
  test/browser/fixtures/nested-structural/each-in-recycle.nv
  test/browser/fixtures/nested-structural/each-in-recycle-entry.ts` → empty. The
  each-in-recycle fixture/tests run unchanged and green (`G1 each-in-recycle` test,
  chromium/webkit/firefox all pass — see GATE 0 browser count).
- [x] **The other 3 already-closed nesting directions (component-in-each, each-in-each,
  switch-in-each) unregressed.** All three fixtures' tests pass unmodified across all
  three browsers (part of the 276-passed browser total; no fixture file in
  `test/browser/fixtures/nested-structural/` other than the two new recycle-in-each files
  was added/modified — confirmed via `git status --short test/browser/fixtures/`).

---

## GATE (tests) — Tests assert the RIGHT things (this is where (a)/(b) gets decided)

- [x] **New fixture: `<recycle>` nested inside an `<each>` item body**, parseable (no
  throw). `test/browser/fixtures/nested-structural/recycle-in-each.nv` +
  `-entry.ts`, added to `FIXTURES` in `nested-structural.spec.ts` alongside the existing
  7 directions (8 total now).
- [x] **Two-back-end parity, real-browser gated (Chromium + WebKit + Firefox; JSDOM
  barred).** `'two-back-end parity: interpreter and Mode-A produce equivalent DOM for
  recycle-in-each'` — interpreter `mount()` (hand-built `TemplateIR` mirroring the
  fixture, using a real `recycled-list` binding for the inner container) and the actual
  Mode-A bundle, both asserted against the fixed oracle `[['a','b'],['c']]`. Passes on
  all 3 browsers. `emitted-mount.ts` correctly excluded — not referenced anywhere in this
  test. **This IS the proof of (a):** the collapse (removing the throw + gate, nothing
  else) was sufficient — no additional each-body-specific fix was needed, confirming (a)
  over (b).
- [x] **Correct per-item recycling behavior.** `'recycle-in-each per-item recycling
  behavior...'` — shrinks row 1's cells 2→1 (asserts position-0 DOM node unchanged,
  `toBe()`), then grows 1→2 (asserts position-0 still unchanged), confirming the pool
  reuses rather than recreates. Passes on all 3 browsers.
- [x] **Correct outer-each keyed identity.** `'recycle-in-each outer keyed identity...'`
  — reorders the two outer rows (swap by id), asserts both `.row` DOM nodes retained
  identity (`toBe()`) at their new positions. Passes on all 3 browsers.
- [x] **Reactivity-through-nesting.** `'recycle-in-each reactivity-through-nesting...'`
  — writes the external `rows` signal (value-only change, same shape) from outside the
  component, `flushSync()`, asserts `.cell` text changed to the new value AND node
  identity preserved (liveness + node-reuse, not existence-only). Passes on all 3
  browsers.
- [x] **No cross-scope leakage / stale capture.** Folded into the per-item-recycling test
  (extended during gate-fill review, not left as a plan-time TODO): captures row 2's
  (untouched sibling) cell node + text before row 1's shrink/grow churn, asserts both
  identity (`toBe()`) and text (`'c'`) unchanged after — row 1's pool mutation does not
  leak into row 2's item scope.
- [x] **Disposal-through-nesting, owner-tree assertion not DOM-count.** `'recycle-in-each
  disposal-through-nesting...'` — asserts `orphanedPooledDom === 0` (no leaked pooled
  DOM) AND the owner-tree deficit `allocAfterDispose - freeAfterDispose === 8`, derived
  (not a magic number) from: outer `<each let={row}>` has no index binding → 1 unowned
  `valueSig` per row (2 rows = 2); inner `<recycle let={cell, i}>` never elides its
  `indexSig` (mirrors `wireList`'s Op-1 growth path but always allocates both signals per
  pool slot) → 2 unowned signals per pooled cell (3 cells across both rows = 6). 2+6=8 —
  matched the measured value on first run (see derivation comment in the test file).
  Passes on all 3 browsers.
- [x] **Invariant-by-construction proof.** `P2C-NEST-03b` (`nv-parser-nested-thunks.test.ts`)
  — asserts the each-body's real `bodyIR` (obtained via the structural `parseNvFile` path,
  `ListBinding.itemTemplate`) has exactly 1 `recycled-list` binding, AND that
  `bodyRecycledListThunks.length` (emit path) equals that same count — the positional-
  pairing invariant the old `:3597` comment worried about, now asserted rather than
  guard-dependent.
- [x] **Diagnostics regression check.** `P2C-NEST-03` was rewritten (no longer asserts a
  throw) to assert `parseNvFileForEmit` succeeds and produces a `recycled-list`
  `ThunkSource` nested under the outer list's `bodyRecycledListThunks` — the old
  `.toThrow('[nv] <recycle> cannot be nested inside an <each> body')` assertion is gone
  (confirmed by the stale-comment grep above finding zero matches for that message).
- [x] **Vacuous-assertion sweep.** `grep -n "expect(true)" test/renderer/nv-parser-nested-thunks.test.ts
  test/browser/nested-structural.spec.ts` → no matches. All liveness assertions in the
  new tests are preceded by `app.flushSync()` (checked manually against each new test).
- [x] **Each new test failed before the fix.** Verified via `git stash` round-trip to
  `<pre>`: `grep -n "cannot be nested inside an <each> body" src/renderer/nv-parser.ts`
  still matches on `<pre>` (throw present) — every new recycle-in-each test would fail
  (parse-time throw) against `<pre>`, and all pass against `HEAD` (this diff).

---

## GATE (close-out) — Docs & log hygiene

- [x] **`docs/gates/recycle-in-each-emit.md` (this file) filled in and re-read against
  placed files on the landing SHA** — every item above re-derived by reading the actual
  diff/grep/test-run output during this pass, not copy-pasted from a prior summary.
- [x] **`docs/implementation-state.md` updated in the same pass** — `nv-parser.ts` row
  gained a "`<recycle>`-in-`<each>` emit support LANDED (Follow-up A′, 2026-07-02)"
  paragraph: closes the gap, notes four-direction parity, states `ThunkSource`/pending
  shape is **unchanged** (no new fields — confirmed, this diff only removes a guard and a
  now-dead parameter), and states the three→two-back-end deviation explicitly. Also
  corrected the adjacent-gap sentence's stale reference to the now-removed `isEachBody`
  parameter (it previously read "`buildNvSlotContentIR` called with `isEachBody=false`",
  which no longer exists after this diff).
- [x] **Decision-log entry — intentionally NOT written by CC.** Reporting to Kofi in this
  turn: commit SHA (to be assigned on commit, immediately following this gate-fill), the
  (a) ruling now empirically proven (two-back-end parity fixture passed with only the
  planned two-line collapse — no additional each-body-specific fix was needed), the
  three-back-end → two-back-end parity deviation (cause: `emitted-mount.ts:808-812`
  pre-existing stub), and one additional deviation: the `isEachBody` parameter was
  removed entirely from `buildNvSlotContentIR` (not just its two now-dead conditionals),
  since leaving it as an unused parameter would itself be a dead-code finding.
- [x] **No dead placeholder / stub left behind, introduced by this diff.** `git diff
  <pre>..HEAD -- src/` grepped for added `TODO`/`FIXME`/`throw new Error('not
  implemented')` → none. `git diff <pre>..HEAD --stat -- src/compiler/emitted-mount.ts`
  → empty (the pre-existing stub there is untouched, not this diff's responsibility).

---

## Pass condition

**PASSED.** G0 + G1 clean. Every artifact/test/close-out item evidenced above against
placed files (re-derived in this pass — `git diff`/grep/test-run output, not summaries).
The two-back-end real-browser parity test (interpreter + Mode-A) passed with only the
planned two-line collapse present, empirically confirming ruling (a) — no latent
each-body-specific desync (ruling (b)) surfaced. No vacuous, skipped, half-built, or
unescalated finding outstanding. Two deliberate, documented deviations from the
commission's literal wording (three→two-back-end parity; `isEachBody` parameter removed
outright rather than just its comment updated) — both flagged, not silently substituted.

## Evidence bundle

1. `git diff 7d94e0d..HEAD --stat` (uncommitted at gate-fill time) + full four-command
   gate output (§ GATE 0 above) + browser suite (276 passed, 258 baseline + 18 new).
2. `git diff 7d94e0d..HEAD --numstat -- src/`: `src/renderer/nv-parser.ts` (+9/-19) only.
3. TC corpus: `test/renderer/nv-parser-nested-thunks.test.ts` (P2C-NEST-03 rewritten,
   P2C-NEST-03b new), `test/browser/nested-structural.spec.ts` (6 new real-browser tests:
   G1 DOM, two-back-end parity, reactivity, per-item recycling + cross-scope isolation,
   outer keyed identity, disposal), new fixture
   `test/browser/fixtures/nested-structural/recycle-in-each{.nv,-entry.ts}`.
