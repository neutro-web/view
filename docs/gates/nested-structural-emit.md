# Nested Structural Bindings on the Mode-A Emit Path — Verification Gate

> **Gate instantiation** of `docs/gates/README.md`. Filled in **retroactively**,
> against placed files on this branch's HEAD, after a user-requested deep adversarial
> review surfaced that no `docs/gates/` file had been authored before implementation
> started (AGENTS.md requires one before CC starts; the commission doc
> (`commission-nested-structural-emit.md`, G0/G1 sections) and this session's
> plan + per-task review process substituted informally but were never filed here).
> This gate is read back against the actual diff, not against the commission's or
> plan's own claims — the discipline is the same as if it had been filled in first.
> **Status: PASSED (filled retroactively) — 2026-07-02**

**Pre-marker.** `<pre>` = `4204678f4426976edb0d0edf2eb34c848261411b` (merge-base with
`main`, recorded at worktree creation).

---

## GATE 0 — Disqualifiers (STOP if either fails)

- [x] **On main's HEAD, or a reviewed branch about to merge.** This gate is filled on
  the feature branch (`worktree-nested-structural-emit`), 14 commits ahead of `<pre>`,
  not yet merged to `main` — merge is pending the user's decision after this gate.
  `git log --oneline <pre>..HEAD` (14 commits, `2d7fb3a`..`79375b9`, see Evidence
  bundle §1) shows all work landed as real commits, not worktree-only uncommitted
  writes.
- [x] **Full gate green, all four — paste actual output, not paraphrase.**
  ```
  $ pnpm typecheck && pnpm test && pnpm lint && pnpm build
  > tsc -p tsconfig.json --noEmit          → (no output = clean)
  > vitest run                             → Test Files 43 passed | Tests 834 passed (834)
  > biome check .                          → Checked 108 files. Found 2 warnings.
  > tsc -p tsconfig.build.json             → (no output = clean)
  ```
  The 2 biome warnings are in `src/renderer/html-tag.ts:480` and
  `src/renderer/interpreter.ts:696` — confirmed via
  `git diff <pre>..HEAD --stat -- src/renderer/html-tag.ts src/renderer/interpreter.ts`
  (empty output) that this branch never touches either file; both warnings pre-date
  this branch (last touched by `5cde67a` and `ad9e79f` respectively, both already on
  `main`). **Zero lint/typecheck/build issues attributable to this branch.**
  Also ran the browser suite (not one of the 4 standing gates but load-bearing for
  this feature): `pnpm test:browser` → **255 passed** (Chromium + WebKit + Firefox
  combined), 0 failed.

---

## GATE 1 — Contract & ordering invariants

- [x] **No `core.ts` / any `src/core/` touch.**
  `git diff <pre>..HEAD --stat -- src/core/` → **empty**. Re-verified independently
  four separate times across this session (by three different task reviewers plus
  this gate's own author) — the G0 "no `src/core/` diff" disqualifier from the
  original commission held throughout every commit, not just at landing.
- [x] **No interpreter / `emitted-mount.ts` touch.**
  `git diff <pre>..HEAD --stat -- src/renderer/interpreter.ts src/compiler/emitted-mount.ts`
  → **empty**. The fix is confined to the Mode-A emit-path pair
  (`nv-parser.ts`, `nv-emitter.ts`) — the two back-ends that already handled nesting
  correctly (per the design doc's "back-end asymmetry" framing) were never edited.
- [x] **Whole-diff scope is exactly the two emit-path files (+ tests/docs).**
  `git diff <pre>..HEAD --numstat -- src/` → only `src/renderer/nv-emitter.ts`
  (+32/-4) and `src/renderer/nv-parser.ts` (+501/-113). No other `src/` file
  appears anywhere in the branch.
- [x] **Ordering invariant (the actual correctness-critical contract this feature
  introduces): a body's flat thunk array must be concatenated in the same order as
  `buildNvSlotContentIR`'s `bindings` array push order.** Verified directly by
  reading both sides: `buildNvSlotContentIR` pushes hole bindings (from `holeInfos`),
  then component bindings, then list, then recycledList, then switch (nv-parser.ts,
  `buildNvSlotContentIR` body). `emitIrLiteral`'s four recursive-call sites in
  nv-emitter.ts build
  `[...thunk.bodyThunks, ...thunk.bodyComponentThunks, ...thunk.bodyListThunks, ...thunk.bodyRecycledListThunks, ...thunk.bodySwitchThunks]`
  — same order. Confirmed by two independent task reviewers during landing (Task 3
  review, Task 3-fix review) plus this gate's own re-read.
- [x] **Binding-path invariant: no raw anchor paths leak through the recursion.**
  `NestedStructuralPending` (the type threaded through `PendingNv*Info.nested`)
  carries only ordinal indices (`itemsHoleIdx`, `bodyHoleIndices`,
  `bodyLeafHoleIndices`, `whenHoleIdx`) — never `anchorPath`. Verified by grep: no
  occurrence of `anchorPath` inside the `NestedStructuralPending` type definition or
  `toPendingBundle`'s conversion. This is what makes the `needsSyntheticRoot` fix's
  path re-rooting (`finalPaths = needsSyntheticRoot ? allPaths.map(p => [0, ...p]) : allPaths`)
  provably sufficient at a single point rather than needing parallel bookkeeping.

---

## GATE 2 — Parser artifact (`nv-parser.ts`, placed & read)

- [x] **`NestedStructuralPending` type exists with the exact shape**
  `{ components: PendingNvComponentInfo[]; lists: PendingNvEachInfo[]; recycles: PendingNvRecycleInfo[]; switches: PendingNvSwitchInfo[] }`,
  populated by `toPendingBundle`, and threaded onto `NvWalkedEach`/`NvWalkedRecycle`/
  `NvWalkedMatchBranch` as `.nested`, and onto `PendingNvEachInfo`/
  `PendingNvRecycleInfo`/`PendingNvSwitchInfo` (per-branch for switch) also as
  `.nested`. (Fails if `.nested` is absent from any of the six structures or if
  `toPendingBundle` duplicates the top-level `ProcessResult` conversion instead of
  being shared — verified NOT duplicated: the original inline four-block conversion
  at the top-level `ProcessResult` return was deleted and replaced with a
  `toPendingBundle` call.)
- [x] **`bodyLeafHoleIndices` is a genuinely separate field from `bodyHoleIndices`,
  not a rename.** Both fields coexist on the same structures; `bodyHoleIndices`
  (the full leaf+consumed union) is still used, unchanged, at every
  `for (const idx of bodyHoleIndices) consumed.add(idx)` bookkeeping site; only
  `computeBodyThunks`'s `bodyThunks` construction was switched to map over
  `bodyLeafHoleIndices` instead. (Fails if any `consumed.add` bookkeeping site was
  accidentally narrowed to the leaf-only set, which would silently under-mark
  consumed holes.) Confirmed unchanged by two independent reviewers plus this gate.
- [x] **`needsSyntheticRoot` fires only when `requireSingleRoot` is true AND the
  body doesn't already resolve to exactly one top-level Element** —
  `requireSingleRoot && (fragWrapper.childNodes.length !== 1 || fragWrapper.firstChild?.nodeType !== 1)`.
  Show the flat-case no-op proof: `test/renderer/nv-parser.test.ts` (P2C-NEST-06,
  added `de4b837`) asserts a normal `<each><li>${item.label}</li></each>` body
  produces `shape.html` starting with `<li` (no synthetic wrapper) and a binding
  path of exactly `[0, 0]` (no `[0, ...]` re-rooting prefix) — i.e. byte-identical
  structure to pre-fix behavior for the common case.
- [x] **`requireSingleRoot` is scoped only to `<each>`/`<recycle>` body call sites,
  not switch branches/fallback or component slot content.** Verified by reading all
  `buildNvSlotContentIR` call sites: the `<each>` body call site
  (`nv-parser.ts`, each-detection branch) and `<recycle>` body call site
  (recycle-detection branch) pass `true`; the `<switch>` branch/fallback call site
  and the two component-slot-content call sites do not pass it (default `false`).
  (Fails if a switch body or slot body silently started getting synthetic-root
  treatment — would change `shape.html`/binding-path shape for cases never gated by
  this feature's fixtures.)

## GATE 3 — Emitter artifact (`nv-emitter.ts`, placed & read)

- [x] **`ThunkSource`'s `list`/`recycled-list`/`switch` variants carry the four new
  structural channels** (`bodyComponentThunks`/`bodyListThunks`/
  `bodyRecycledListThunks`/`bodySwitchThunks`, plus `fallback`-prefixed equivalents
  for switch fallback), alongside the pre-existing `bodyThunks` (now leaf-only).
  Show the type definition diff.
- [x] **All four recursive-call sites (list body, recycled-list body, switch branch
  body, switch fallback body) concatenate the five channels in the same,
  hole-first order** — `[bodyThunks, bodyComponentThunks, bodyListThunks, bodyRecycledListThunks, bodySwitchThunks]`
  — before calling `emitIrLiteral` recursively. (Fails if any one of the four sites
  uses a different order, or omits a channel — would desync that specific body kind
  only, a partial-coverage failure the original G0 disqualified.) All four verified
  present and consistent.

## GATE 4 — Recursive assembler (`computeBodyThunks`, placed & read)

- [x] **`computeBodyThunks` is a single function reused by all four body-producing
  call sites** (each/recycle/switch-branch/switch-fallback thunk construction inside
  `computeBindingThunks`), not reimplemented per site. It in turn calls the SAME four
  per-kind builder functions (`computeComponentThunks`/`computeListThunks`/
  `computeRecycledListThunks`/`computeSwitchThunks`) that the TOP-LEVEL assembler
  also calls — i.e. one recursive reconstruction, per the plan's explicit
  "distinct-path / collapse discipline" requirement, not a duplicated
  top-level/body-level pair. Verified: these four functions are defined once each
  and grep-confirmed called from both the top-level `computeBindingThunks` body and
  from `computeBodyThunks`.
- [x] **Termination for arbitrarily deep, mixed nesting.** The `switch-in-each-in-switch`
  fixture (3 levels: switch → each → switch) is the deep-recursion-termination proof
  the original commission's G1 explicitly required. It parses, emits, and mounts
  correctly in a real browser (`test/browser/nested-structural.spec.ts`, "G1
  switch-in-each-in-switch" — asserts `.flagged`/`.unflagged` class names on the
  correct rows in real Chromium). No hard-coded depth limit exists in
  `computeBodyThunks`/`buildNvSlotContentIR` — recursion depth is bounded only by
  the authored template's own nesting depth (build-time only; not a runtime
  concern), consistent with how the interpreter/`emitted-mount.ts` already recurse.

---

## GATE (tests) — Tests assert the RIGHT things

- [x] **Liveness (reactivity-through-nesting):** `test/browser/nested-structural.spec.ts`
  "reactivity-through-nesting" test — an external `rows` signal is written, then
  `flushSync()`, then the nested `.cell` text is asserted to have **changed to the
  new value** in a real browser, AND the DOM node reference is asserted unchanged
  (`toBe`) before/after — proves node identity survives a reactive update through
  two levels of nesting, not just initial render.
- [x] **No-leak (disposal-through-nesting):** mounts `each-in-each`, calls
  `dispose()` + `flushSync()`, asserts `__test.nodeFreeCount === __test.nodeAllocCount`
  after subtracting the documented, derived (not magic-number) expected deficit
  of one unowned `signal()` per mounted list item (`signal()` is intentionally
  owner-less in `src/core/core.ts`, unlike `effect`/`derived`/`createRoot` — this is
  existing, unmodified core behavior, not something this feature introduced or
  weakened). The assertion is falsifiable: it WOULD fail if disposal genuinely
  leaked reactive nodes beyond the documented, bounded deficit.
- [x] **Differential / shared-oracle — three-back-end parity.**
  `test/browser/nested-structural.spec.ts` "three-back-end parity" test: the SAME
  nested-list shape (rows of cells) is mounted via interpreter `mount()`, via
  `emitMount()`, and via the actual Mode-A `.nv` → esbuild → bundle pipeline, in a
  real browser — all three asserted against the identical fixed expected value
  `[['a','b'],['c']]` (a fixed-value oracle, per the gate template's "stricter than
  mutual equality" guidance — two back-ends could be mutually equal yet both wrong,
  but both cannot equal a fixed value and both be wrong).
- [x] **Diagnostics — specific message, not just "threw".** `P2C-NEST-03`
  (`test/renderer/nv-parser-nested-thunks.test.ts`) asserts the exact string
  `'[nv] <recycle> cannot be nested inside an <each> body'` fires for the one
  genuinely-unhandled combination this feature's scope excludes (recycle-in-each) —
  not a bare `.toThrow()`.
- [x] **Vacuous-assertion sweep.** Grepped every new/touched test file
  (`nv-parser-nested-thunks.test.ts`, `nested-structural.spec.ts`,
  `nv-parser.test.ts`, `nv-emitter-exec.test.ts`) for `expect(true)`/`toBe(true)`
  patterns: every occurrence found is attached to a real computed condition with a
  descriptive message (e.g. `expect(shapeResult.equal, msg).toBe(true)`,
  `expect(hasAnchorComment).toBe(true)` following an actual DOM-structure
  computation) — **zero bare/vacuous assertions** (no unconditional
  `expect(true).toBe(true)`, no existence-only check standing in for a liveness
  check, no liveness assertion missing a preceding `flushSync()`).
- [x] **Deferred-not-half-built.** The one item explicitly left out of scope by the
  design doc (component slot-content nesting) has NO partial implementation
  anywhere — `buildNvSlotContentIR`'s slot-content call sites are byte-identical to
  pre-feature behavior (never touched by this diff), so that path's existing
  hole-only behavior (whatever it was before) is unchanged, not silently
  half-extended. It is documented as an out-of-scope finding (landing report +
  `implementation-state.md`, both updated `79375b9`), not implemented and left
  broken.
- [x] **Each new test failed before the fix — red→green evidenced per task.** Task 2
  regression test: baseline capture, documented as non-red per its own design (pure
  plumbing, no new observable behavior yet — explicitly not a red/green cycle, and
  said so in its own report). Task 3's each-in-each nested-list test: RED
  (undefined `bodyListThunks`) → GREEN, evidenced in the Task 3 implementer's
  report and independently re-verified by the Task 3 reviewer. The two in-branch
  bug fixes (`7f00ae4`, `156a1ef`) each have their own RED (reproducing the exact
  "thunk kind mismatch" / DOM-only-1-item symptom) → GREEN cycle, evidenced in
  their respective fix reports and re-verified by their reviewers.

---

## GATE (close-out) — Docs & log hygiene

- [x] **Design doc version-consistent.** `docs/design/design-nested-structural-emit.md`
  (Task 1) states the ruling (Option 1) and is not superseded by anything later in
  the branch — the final implementation matches the ruling with no contract drift.
- [x] **`implementation-state.md` updated.** Fixed in commit `79375b9` (this session,
  in direct response to the adversarial review that found the gap) — the
  `nv-parser.ts`/`nv-emitter.ts` rows now describe the recursive
  `computeBodyThunks` capability, the `needsSyntheticRoot` fix, the four new
  `ThunkSource` channels, and the one known remaining gap (component slot content).
- [x] **Decision-log entry** — **intentionally NOT appended by this branch.** Per the
  original commission's explicit instruction ("On landing: I'll write the
  decision-log delta... Don't write that yourself — report the SHA, the fork
  ruling, and any deviations"), this is Kofi's action to take after merge, not a
  gap in this branch. The landing report (`docs/design/nested-structural-emit-landing-report.md`)
  is the durable summary Kofi's entry will draw from.
- [x] **No dead placeholder / stub left behind.** No `TODO`/`FIXME`/stub markers were
  added by this diff (checked via `git diff <pre>..HEAD -- src/` for added
  `TODO`/`FIXME`/`throw new Error('not implemented')` patterns — none found beyond
  the intentional, documented, tested loud-failure throw for recycle-in-each).

---

## GATE (Performance) — `needsSyntheticRoot` cost, measured

> Added retroactively (2026-07-02), same discipline as the rest of this gate:
> filled against an actual test run, not against a prior reasoned-but-unmeasured
> claim. Follows `docs/design/spec-recycling-playwright.md`'s convention: node-
> churn/DOM-count = countable, asserted gate; wall-clock = supplementary, logged
> only, never asserted as a ratio (no wall-clock was needed for this claim, so
> none is logged here — see rationale below).

- [x] **Claim under test.** An adversarial review claimed, without measuring, that
  `needsSyntheticRoot` (`src/renderer/nv-parser.ts`) — which auto-wraps an
  `<each>`/`<recycle>` item body in a synthetic root `<div>` whenever the body's
  only content is a single nested structural child with no wrapping element —
  costs exactly one extra DOM element per mounted item (not per-render, not
  O(n²)), and zero extra reactive-node allocations (the wrapper is a static
  structural element, not a signal/effect/derived). Evidence: new test
  `'needsSyntheticRoot cost: component-in-each wraps exactly one synthetic <div>
  per item and contributes zero extra reactive-node allocations'`,
  `test/browser/nested-structural.spec.ts`.
- [x] **DOM cost: exactly one wrapper `<div>` per mounted item.** Measured against
  `component-in-each.nv` (2 items: Alpha, Beta — a fixture that triggers
  `needsSyntheticRoot` by construction, confirmed independently via esbuild
  build-output inspection: the fixture's compiled `shape.html` is the literal
  string `"<div><!--nv-comp-0--></div>"`). Two independent mounts each produced
  `wrapperCount === 2` (one `<div>` per item, not more, not fewer) — asserted,
  not eyeballed, via a DOM query that isolates wrapper `<div>`s (immediate
  parent of a `.row` element and nothing else) from any other `<div>` in the
  tree. Confirmed non-vacuous: temporarily mutating the assertion to expect `3`
  made the test fail with `Expected: 3, Received: 2` before being reverted.
- [x] **Reactive-node cost: bounded/linear, not compounding across mounts.**
  `__test.nodeAllocCount` (`src/core/core.ts`, pre-existing test-only
  instrumentation — no new counter added, no `src/core/` touch by this test)
  was reset and measured across two fully independent mount/dispose cycles of
  the same 2-item fixture. Both mounts allocated the identical
  `nodeAllocCount === 11` — proving the per-mount reactive cost is a fixed
  constant, not compounding/growing across repeated mounts (rules out the
  "not O(n²)" half of the claim empirically, at the mount-repetition axis).
- [x] **Reactive-node cost: the wrapper itself contributes zero.** Not directly
  runtime-assertable as an isolated delta (no non-wrapped equivalent fixture
  exists to diff against), so corroborated by build-output + source inspection
  instead, cross-checked against the passing/failing test above:
  `nodeAllocCount` only increments inside `makeNode()` (`src/core/core.ts`),
  which fires exclusively for signal/effect/derived/root creation. The
  synthetic wrapper `<div>` is serialized directly into the item template's
  static `shape.html` string at build time (`"<div><!--nv-comp-0--></div>"`,
  confirmed via a scratch esbuild build of `component-in-each-entry.ts`
  inspecting the emitted bundle) and is cloned via that template at mount —
  never routed through `makeNode()`. It is therefore structurally incapable of
  incrementing `nodeAllocCount`. The nonzero, identical-across-mounts
  `allocAfterMount === 11` in the test above is real reactive work (the
  `<each>` reconcile effect + per-item scopes for 2 items), confirming the
  counter is genuinely moving and not a trivially-zero proxy.
- [x] **Wall-clock: not logged — deliberately.** Unlike the `<recycle>` node-churn
  spec (which logs wall-clock as honest supplementary evidence for a scroll-
  step steady-state comparison), this claim has no natural "arm" contrast (there
  is no non-wrapped variant of this fixture to time against) and the DOM/alloc
  counts above are already the full countable proof — adding an unpaired
  wall-clock number here would not strengthen the claim and risks being
  over-read as a ratio, which `spec-recycling-playwright.md`'s convention
  explicitly warns against. Skipped per that document's own "does not assert a
  wall-clock ratio" discipline.
- [x] **Supersedes the earlier unmeasured claim.** The adversarial review's
  "exactly one extra DOM element per item, zero extra reactive-node allocation"
  claim was reasoned from reading `needsSyntheticRoot`'s source but never run.
  This gate section replaces that reasoning with actual command output
  (`npx playwright test test/browser/nested-structural.spec.ts --project=chromium`
  → 11 passed, including this test) — the claim holds, empirically, with the
  numbers above.

---

## Evidence bundle

1. `git log --oneline <pre>..HEAD` (14 commits, `2d7fb3a`..`79375b9`) + `git status`
   (clean, all committed) + full four-command gate output (§ GATE 0 above).
2. `git diff <pre>..HEAD --numstat -- src/ docs/design/design-nested-structural-emit.md docs/implementation-state.md`:
   `src/renderer/nv-emitter.ts` (+32/-4), `src/renderer/nv-parser.ts` (+501/-113),
   `docs/design/design-nested-structural-emit.md` (+91/-0, new file),
   `docs/implementation-state.md` (+2/-2).
3. TC corpus: `test/renderer/nv-parser-nested-thunks.test.ts` (P2C-NEST-01..06),
   `test/renderer/nv-parser.test.ts` (flat-case no-op regression),
   `test/renderer/nv-emitter-exec.test.ts` (emit-level regression additions),
   `test/browser/nested-structural.spec.ts` (11 real-browser tests: 6 G1
   nesting-matrix cells + `each-in-recycle` = 7 fixtures total, 3-back-end parity,
   reactivity, disposal, `needsSyntheticRoot` performance measurement).

## Pass condition

**PASSED.** G0 + G1 clean. Every artifact/test/close-out item evidenced above
against placed files on this branch's HEAD (`79375b9`), not against summaries or
green counts alone — re-derived independently in this gate-authoring pass, not
copy-pasted from prior task reports. No vacuous, skipped, half-built, or
unescalated finding outstanding. One deliberate, documented, non-blocking
deferral (component slot-content nesting) — correctly flagged, not silently
half-built.

**Process note for future features:** this gate was filled in *after* landing,
not before, because the standard `docs/gates/` step was skipped at commission
time. The commission's own G0/G1 sections substituted informally and covered
similar ground, but per AGENTS.md the formal gate file is supposed to be
authored by the architect *before* CC starts, from the approved design — future
non-trivial features on this repo should not skip that step even when a
commission doc already has gate-shaped sections.
