# Gate — Recycling List Mode (`<recycle>`)

**Verified against:** nv worktree-feat+recycling-list-mode, 787 tests passing, 0 typecheck errors.

## Acceptance criteria

1. **Distinct path:** `grep -n 'if.*recycled' src/renderer/interpreter.ts` returns nothing in `wireList`. `wireRecycledList` exists as a standalone function.
2. **Footgun guard:** `<recycle key=>` throws with message matching `/does not take key=/`. T1-3 green.
3. **Identity contract tested:** T1-1 (FIRE) green — focus stays on slot position after `.of` data change, asserted in test.
4. **No core touch:** `git diff main -- src/core/` shows no changes.
5. **emitted-mount.ts stub only:** `grep 'RecycledList\|recycled-list' src/compiler/emitted-mount.ts` shows only a `throw new Error(...)` — no full implementation.
6. **html-tag.ts unmodified:** `git diff main -- src/renderer/html-tag.ts` shows no changes.
7. **Node-churn = 0:** T2-1 Playwright gate green (recycled arm shows 0 alloc/free per scroll step).
8. **typecheck + test:** `pnpm typecheck && pnpm test` green on main HEAD at landing SHA.
