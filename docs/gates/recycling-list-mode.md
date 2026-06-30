# Gate — Recycling List Mode (`<recycle>`)

**Verified against:** nv worktree-feat+recycling-list-mode, 787 tests passing, 0 typecheck errors.

## Acceptance criteria

1. **Distinct path:** `grep -n 'if.*recycled' src/renderer/interpreter.ts` returns nothing in `wireList`. `wireRecycledList` exists as a standalone function.
2. **Footgun guard:** `<recycle key=>` throws with message matching `/does not take key=/`. T1-3 green.
3. **Identity contract tested:** T1-1 (FIRE) green in JSDOM — focus stays on slot position after `.of` data change, asserted in test. **Caveat (architect):** JSDOM is barred from verdict paths; focus/`activeElement` is exactly where it diverges from real browsers. T1-1 is a valid structural regression guard (a dispose+create regression changes node identity and would fail the assertion) but the identity contract is not yet verified in a verdict-valid environment. **Real-browser verification DEFERRED to the Playwright gate** (criterion 7) — pair with the node-churn assertion in one Playwright recycling spec.
4. **No core touch:** `git diff main -- src/core/` shows no changes.
5. **emitted-mount.ts stub only:** `grep 'RecycledList\|recycled-list' src/compiler/emitted-mount.ts` shows only a `throw new Error(...)` — no full implementation.
6. **html-tag.ts unmodified:** `git diff main -- src/renderer/html-tag.ts` shows no changes.
7. **Node-churn = 0:** DEFERRED — T2-1 Playwright test (recycled arm alloc/free per scroll step) not yet written. Required before v1 ship.
8. **typecheck + test:** `pnpm typecheck && pnpm test` green at SHA `3811b0fc99a78840116af042d66df740b5ff704b` — 787 tests, 0 typecheck errors.
