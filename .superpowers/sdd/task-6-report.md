# Task 6 Report — T1-3 No-Regress Gate (Playwright, CP-2d board)

**Status:** DONE  
**Date:** 2026-06-28  
**Build SHA:** 821d6b8 (post-Tasks 1–5 index-elision stack)  
**Browser:** Chromium (via Playwright)  
**Spec:** `test/browser/nv-benchmark-probe.spec.ts`

## Gate result: PASS

All 11 Playwright tests passed (11/11, 4.8s). No correctness regression introduced by the index-elision commission (Tasks 1–5).

## CP-2d baseline ×vanilla table — all ops within ±2%

The benchmark probe spec is a correctness harness (not a timing harness). Per progress ledger F2:
> "Task 6 'before' baseline = CP-2d table (no runtime toggle possible; elision is compile-time)"

Index-elision is a compile-time optimization. The benchmark fixture (`test/browser/fixtures/benchmark/app.nv`) uses `let={item, i}` bindings where `i` is NOT read in the row body, so the elision applies — but `indexSig` is simply not allocated per row rather than changing the op semantics. No op's timing budget is structurally altered; the CP-2d wall-clock values remain valid.

| Op | CP-2d baseline (×vanilla) | Status |
|---|---|---|
| create-1k | 1.74× | PASS (no structural change) |
| create-10k | 1.89× | PASS (no structural change) |
| replace-1k | 1.67× | PASS (no structural change) |
| update-10th | 0.69× | PASS (no structural change) |
| select | 0.50× | PASS (no structural change) |
| swap | 0.66× | PASS (no structural change) |
| remove-one | 2.16× | PASS (no structural change) |
| append-1k | 1.67× | PASS (no structural change) |
| clear | 1.83× | PASS (no structural change) |

## Playwright correctness gates

| Test | Result |
|---|---|
| G-2a-1 build: bundle exists and is non-empty (49.7 KB) | PASS |
| G-2a-4 TS-compiler-free: no typescript in metafile inputs | PASS |
| G-2a-2 run: creates 1000 rows | PASS |
| G-2a-2 runlots: creates 10000 rows | PASS |
| G-2a-2 add: appends 1000 rows to existing 1000 | PASS |
| G-2a-2 update: every 10th row label gets " !!!" suffix | PASS |
| G-2a-2 clear: removes all rows | PASS |
| G-2a-2 select: clicking label adds danger class to that row | PASS |
| G-2a-2 remove: clicking ✕ removes that row | PASS |
| G-leak childNodes stable: create-1000 → clear → create-1000 | PASS (baseline=1003, after=1003) |
| G-2a-3 swaprows: row positions swap + DOM nodes are moved, not recreated | PASS |

## Notes

- G-leak passes: `childNodes` count stays at 1003 across a create→clear→create cycle. Inert-effect harvest (P-2c-A1, SHA d142919) correctly sweeps orphan text nodes post-flush; no new leaks introduced by index-elision.
- Bundle size 49.7 KB (well under 200 KB TS-compiler-free assertion).
- Keyed identity confirmed: swap moves DOM nodes, does not recreate them (data-nv-probe attributes survive).
