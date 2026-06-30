# Gate — Recycling List Mode (`<recycle>`)

**Verified against:** nv worktree-feat+recycling-list-mode, 787 tests passing, 0 typecheck errors.

## Acceptance criteria

1. **Distinct path:** `grep -n 'if.*recycled' src/renderer/interpreter.ts` returns nothing in `wireList`. `wireRecycledList` exists as a standalone function.
2. **Footgun guard:** `<recycle key=>` throws with message matching `/does not take key=/`. T1-3 green.
3. **Identity contract verified in real browser (B1):** focus + uncontrolled-input-state stays with slot position after `.of` data change — asserted via `page.evaluate` against live `document.activeElement` in real Blink. Keyed contrast (B2) confirms modes differ: keyed focus travels with data to new position. JSDOM T1-1 retained as fast structural regression guard. Closes the T1-1 JSDOM verdict-path gap.
4. **Core touch limited to test instrumentation:** `git diff main -- src/core/` shows only the `__test` counter additions (`_nodeAllocCount`/`_nodeFreeCount`) — no runtime or semantic change. See criterion 7.
5. **emitted-mount.ts stub only:** `grep 'RecycledList\|recycled-list' src/compiler/emitted-mount.ts` shows only a `throw new Error(...)` — no full implementation.
6. **html-tag.ts unmodified:** `git diff main -- src/renderer/html-tag.ts` shows no changes.
7. **Node-churn = 0 verified in real browser (A2):** recycled steady-state 0 ReactiveNode alloc+free/scroll-step (FIRE) over 40 measured steps (5-step warmup discards link-pool priming); keyed control >0 (proves churn is real in keyed mode, making the recycled-zero meaningful). Source-verified (Op-3) AND runtime-measured via test-only `__test.nodeAllocCount`/`nodeFreeCount` (prod-stripped, mirrors `_recomputeCount`; sole core touch, instrumentation-only). Link pool means `makeLink` is called each re-run but allocates 0 in steady state — metric is node alloc, not link calls. `<recycle>` v1-ship-ready on correctness + node-churn axes.
8. **typecheck + test:** `pnpm typecheck && pnpm test` green at SHA `3811b0fc99a78840116af042d66df740b5ff704b` — 787 tests, 0 typecheck errors.
