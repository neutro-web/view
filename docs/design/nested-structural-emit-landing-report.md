# Landing Report — Nested Structural Bindings on the Mode-A Emit Path

**Status:** Landed, all gates green.
**Design doc:** `docs/design/design-nested-structural-emit.md` (Task 1).
**Ruling:** Option 1 — recursive `ThunkSource` reconstruction (thread nested
structural pendings through body walks, reassemble them recursively at
`emitIrLiteral` time rather than special-casing each component/each/recycle/switch
combination).

## Summary

This plan fixed nested structural bindings (a `<component>`, `<each>`,
`<recycle>`, or `<switch>` nested inside the body of another such binding) on
the Mode-A (`emitMount`) emit path, which previously mishandled or silently
dropped nested structural content that the interpreter path already handled
correctly. The fix is confined entirely to `src/nv-parser.ts` /
`src/nv-emitter.ts` (compiler/emit layer) — `src/core/` is untouched, and the
interpreter/`emitted-mount.ts` runtime path was not modified.

## Commits (in order)

1. `968ef23` — Task 1: design fork doc, ruling Option 1.
2. `17f451e` — Task 2: thread nested structural pendings (`NestedStructuralPending`)
   through body walks, added to `PendingNv*Info.nested`.
3. `4bc17c5` — Task 3: recursive `ThunkSource` reconstruction — `computeBodyThunks`
   consumes nested pendings and produces the five-channel thunk arrays
   (`bodyThunks`/`bodyComponentThunks`/`bodyListThunks`/`bodyRecycledListThunks`/
   `bodySwitchThunks`), consumed by `emitIrLiteral`.
4. `7f00ae4` — Task 3 fix (bug found via later browser testing, fixed in-branch):
   phantom hole-thunk bug — `computeBodyThunks` was including structurally-consumed
   holes in the leaf-thunk assembly, producing spurious thunks. Fixed by excluding
   holes already consumed by a structural pending from leaf-thunk assembly.
5. `9317b03` — Task 4: regression guard confirming `<recycle>`-in-`<each>` remains a
   loud parse-time error (not silently accepted), per the G0 no-partial-coverage
   requirement.
6. `8bbb348` — Task 5: nesting-matrix `.nv` fixtures covering all four structural
   kinds nested inside `<each>` and `<switch>`.
7. `156a1ef` — Task 6 fix (bug found via the real-browser Playwright gate):
   `needsSyntheticRoot` bug — an `<each>`/`<recycle>` body consisting of a single
   nested structural child with no wrapping element collapsed to a bare anchor node,
   violating the list runtime's one-root-per-item invariant. Fixed by auto-wrapping
   such bare-anchor-only bodies in a synthetic root element.
8. `ebd825e` — Task 6: fix to a disposal-count test's assertion methodology
   (uncovered while validating the `156a1ef` fix), plus a `tsc` error fix.
9. `de4b837` — Task 6: additional coverage for the `needsSyntheticRoot` flat-case
   no-op path and mixed-content bodies.

## Bugs found and fixed (beyond original plan scope)

Both surfaced through Task 6's real-browser Playwright gate (three-back-end parity
+ nesting-matrix + disposal testing), not through the original unit-test suite —
validating the decision to require a real-browser gate for this plan.

1. **Phantom hole-thunk bug** (`7f00ae4`) — `computeBodyThunks` assembled leaf
   thunks for holes that were already structurally consumed by a nested
   component/each/recycle/switch pending, producing spurious extra thunks in the
   emitted output. Fixed by excluding structurally-consumed holes from the
   leaf-thunk assembly pass.
2. **`needsSyntheticRoot` gap** (`156a1ef`, plus `ebd825e`, `de4b837`) — an
   `<each>`/`<recycle>` body whose sole content was a single nested structural
   binding (no wrapping element) collapsed to a bare anchor comment node instead of
   a real element root, violating the list runtime's invariant that every list item
   have exactly one DOM root. Fixed by detecting this shape and auto-wrapping it in
   a synthetic root element at emit time. A disposal test's assertion methodology
   was also corrected during validation (`ebd825e`), and follow-up coverage was
   added for the flat-case no-op path and mixed-content bodies (`de4b837`) to guard
   against regressions in either direction.

## Out-of-scope findings (not fixed, flagged for follow-up)

1. **Self-closing custom-element tags drop following siblings.** A tag like
   `<Row .../>` (self-closing, custom/unknown element) followed by sibling content
   in the same parent silently drops the siblings during HTML parsing, because
   unknown/custom elements are not treated as void elements by the parser. This is
   a pre-existing HTML-parser quirk unrelated to any of this plan's fixes. It was
   worked around in this plan's test fixtures (using explicit closing tags instead
   of self-closing form) but was **not fixed**, per the plan's no-scope-creep
   discipline. Candidate for a separate, small follow-up task.
2. **All-static `$render` templates skip component-element detection.** A
   `$render` template with zero `${}` interpolation holes (an
   `ts.isNoSubstitutionTemplateLiteral`) hits an early return in the parser
   (`nv-parser.ts:1399`) that skips component-element detection entirely. Noted
   during Task 5 fixture verification; not exercised by this plan's fixtures
   (all of which have holes) and not fixed, as it is unrelated to the nested-
   structural-emit gap this plan targets.

## Final verification (Task 7)

- `npx vitest run` — **832/832 passed** (43 test files), ~19.5s. (Prior recorded
  count at `61d5987` was 813/813; the increase reflects new coverage added in
  Tasks 5/6.)
- `npx tsc --noEmit --strict` — clean, no errors.
- `pnpm test:browser` (full Playwright suite, all specs, not just nested-structural)
  — **252/252 passed**, no regressions.
- `git diff main...HEAD --stat -- src/core/` — **empty**. Confirms the G0
  hard gate: no `src/core/` changes anywhere in this plan.

## Deviations from the original plan

- Task 3 required an in-branch bug fix (`7f00ae4`, phantom hole-thunk) discovered
  during later validation, folded back before Task 4 proceeded.
- Task 6's real-browser gate surfaced the `needsSyntheticRoot` bug (`156a1ef`),
  which was out of the original task list but within the plan's spirit (list-
  runtime invariant enforcement for nested structural bodies) and was fixed with
  its own disposal-test correction and follow-up coverage, all reviewed clean.
- No `src/core/` or interpreter/`emitted-mount.ts` changes were made anywhere in
  the plan — the G0 constraint held throughout.

## Decision log

Per the commission, this document is a durable summary, not the decision-log
entry itself — the decision-log entry is written separately by Kofi on landing.
