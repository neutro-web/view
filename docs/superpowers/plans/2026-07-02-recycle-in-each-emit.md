# Implementation Plan — `<recycle>`-in-`<each>` Emit Support (Follow-up A′)

Gate: `docs/gates/recycle-in-each-emit.md` (authored, pre-implementation).
Commission: `commission-recycle-in-each-emit.md`.
Ruling: (a) accepted as working prior, unconfirmed on the runtime axis until Task 2's
parity fixture is green.

**Correction found in adversarial review of this plan (2026-07-02), surfaced before
implementation starts:** the commission's G1 language calls for "three-back-end parity"
(interpreter / `emitted-mount.ts` / Mode-A). That is **not achievable** for any
`<recycle>`-involving fixture today — `emitted-mount.ts`'s `recycled-list` case is a
pre-existing, unconditional stub (`case 'recycled-list': { throw new Error('[nv/emitted-
mount] RecycledListBinding not yet implemented in compiler back-end') }`,
`src/compiler/emitted-mount.ts:808-812`), documented in `docs/implementation-state.md`
("**recycled-list** stub (throws)... **Not on the v1 build-pipeline path**"). This is not
each-body-specific and not something A′ introduces or should fix — it predates this
commission and covers top-level `<recycle>` too. The existing precedent for this exact
situation is `each-in-recycle` (Follow-up A, the reverse nesting direction): its gate test
is Mode-A-only ("G1 each-in-recycle: Mode-A emit mounts..." — no interpreter/emitted-mount
three-way test exists for it either). Task 2 below follows that precedent — two real
back-ends (interpreter + Mode-A), `emitted-mount.ts`'s gap noted, not fixed. This is a
deviation from the commission's literal G1 wording and must be reported to Kofi as such
(see Task 3), not silently substituted.

## Task 1 — Collapse the three sites (src/renderer/nv-parser.ts)

1. Delete the throw at `:1328–1330`
   (`if (isEachBody && slotRecycledLists.length > 0) throw ...`).
2. Remove the `!isEachBody` gate at `:1332` so `pushRecycledListBinding` runs
   unconditionally for `slotRecycledLists`, matching `pushListBinding`'s and
   `pushSwitchBinding`'s already-unconditional calls in the same function.
3. Delete/rewrite the `:3597` comment in `computeBodyThunks` — it currently asserts the
   unconditional `computeRecycledListThunks` call is "safe TODAY only because" the throw
   guarantees `pending.recycles` is empty for each-bodies. After step 1–2 that's no longer
   a guard-dependent truth, it's the intended behavior; the comment must say so or be
   removed (a stale hazard comment describing a guard that no longer exists is worse than
   none — GATE 1 flags this explicitly).
4. Update the sibling comment at `:683` (`true, // isEachBody — <recycle> inside <each>
   body is unsupported`, the `<each>`-body call site of `buildNvSlotContentIR`) — it
   asserts the same now-false premise as the `:3597` comment and was missed in an earlier
   draft of this plan. Grep confirms these two are the only source comments referencing
   the throw/guard (`grep -rn "cannot be nested\|safe TODAY only because" src/`); both
   must be updated together or the stale-comment finding recurs.
5. Update `P2C-NEST-03`'s test name/assertion in
   `test/renderer/nv-parser-nested-thunks.test.ts` — it currently pins the throw as
   expected behavior. Replace with an assertion that recycle-in-each now parses/emits
   without throwing, producing a `recycled-list` `ThunkSource` nested under the outer
   `list` binding's `bodyRecycledListThunks` (mirroring `P2C-NEST-02`'s each-in-each
   shape assertion, but checking `bodyRecycledListThunks` instead of `bodyListThunks`).
6. Add the invariant-by-construction unit test (GATE tests item): assert
   `pending.recycles.length` for a recycle-in-each fixture equals the number of
   `RecycledListBinding` entries actually pushed into `bindings` for that body.

No other `src/` file should need a diff if ruling (a) holds — this is the collapse the
commission's "Collapse discipline" section requires: no parallel each-body-specific path.

## Task 2 — Fixtures + real-back-end parity (the empirical proof of (a) vs (b))

1. New fixture `test/browser/fixtures/nested-structural/recycle-in-each.nv` +
   `-entry.ts`, mirroring `each-in-recycle.nv`'s shape but inverted: outer `<each>`
   (key-identity), inner `<recycle>` (position-identity pooling), respecting
   `<recycle>`'s two-let-name (`let={item, i}`) requirement.
2. Add to `test/browser/nested-structural.spec.ts`:
   - **Parity test across the two back-ends that actually support `<recycle>` today**
     (interpreter `mount()` + real Mode-A `.nv` → esbuild → bundle pipeline) — shared
     fixed-value oracle, real browser (Chromium+WebKit+Firefox). `emitted-mount.ts`'s
     `recycled-list` stub (pre-existing, `:808-812`, documented in
     `implementation-state.md` as "not on the v1 build-pipeline path") is a known gap
     this fixture does NOT close — do not attempt to implement `RecycledListBinding` in
     `emitted-mount.ts` as part of this task; that is new, unscoped back-end work, not
     an each-body-nesting fix. Follow the `each-in-recycle` precedent exactly (single
     Mode-A-only gate test, no interpreter/emitted-mount three-way test exists for it
     either).
   - Reactivity-through-nesting: write the inner list's driving signal from within an
     each-item scope, `flushSync()`, assert DOM changed.
   - Per-item recycling behavior: assert node reuse across a list-shift on the inner
     recycle (same style as `recycling-identity`'s pooling assertions).
   - Outer keyed identity: `toBe()` node-reference stability across an outer-list
     mutation.
   - Disposal-through-nesting: remove an outer item, assert inner recycle's owner-tree
     torn down (no orphaned pooled DOM / no leaked reactive nodes beyond any documented
     baseline deficit).
3. **Decision point:** if all of the above pass with only Task 1's two-line collapse
   present — (a) is empirically confirmed, done. If any fail, STOP: do not extend Task 1
   with a patch; report the specific failure (which back-end, which assertion) back
   before proposing a root-cause fix — that's ruling (b) surfacing, out of this plan's
   pre-approved scope.

## Task 3 — Docs close-out

1. `docs/implementation-state.md`: close the recycle-in-each gap, note four-direction
   parity reached, note whether `ThunkSource`/pending shape changed (expected: no —
   Task 1 removes a guard, doesn't add fields).
2. Fill `docs/gates/recycle-in-each-emit.md` checkboxes against the landing SHA.
3. Report SHA + ruling confirmation + **the G1 three-back-end-parity deviation
   (two-back-end parity delivered instead, matching the each-in-recycle precedent, per
   the correction noted at the top of this plan)** + any other deviations to Kofi. Do
   not write the decision-log entry (Kofi's action per commission).

## Out of scope (unchanged from commission, plus one addition from this review)

- Any `src/core/` change.
- `<recycle>`'s position-identity/key-forbidding/two-let-name semantics.
- Refactoring interpreter/`emitted-mount.ts` if they already pass Task 2's parity test
  unmodified.
- **Implementing `RecycledListBinding` support in `emitted-mount.ts`** (the pre-existing
  `:808-812` stub) — out of scope for A′ regardless of (a)/(b); it is a standing gap
  across ALL `<recycle>` usage, not introduced or worsened by each-body nesting, and
  fixing it is unscoped net-new back-end work the commission never asked for.
- Component slot-content nesting, self-closing custom-element sibling drop, all-static
  `$render` component detection (logged at Follow-up A landing, separate future work).
