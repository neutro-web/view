# Design Fork Ruling — Nested Structural Bindings on the Mode-A Emit Path

**Commission:** commission-nested-structural-emit.md. **Ruled at:** main `4204678`
(≥ `61d5987`). **Ruling:** Option 1 (recursive `ThunkSource` reconstruction).
Option 2 (emit straight from `bodyIR`) is confirmed dead — see evidence below.

The commission poses two options and asks that the fork be ruled before implementation.
This was investigated directly against `main` HEAD `4204678` (≥ `61d5987`, confirmed by
`git log -1`).

**Ruling: Option 1 (thread nested structural pendings through `ThunkSource`,
recursive reconstruction). Option 2 is confirmed dead.**

Evidence for why Option 2 (emit straight from `bodyIR`) is impossible:

- `bodyIR` on every `NvWalkedEach`/`NvWalkedRecycle`/`NvWalkedMatchBranch` is built by
  `buildNvSlotContentIR` (`nv-parser.ts:1135`) using **stub accessors**:
  `const stubExpr = (() => undefined) as ReactiveExpr<unknown>` and
  `const stubHandler = (() => (_e: Event) => undefined) as HandlerExpr`
  (`nv-parser.ts:1145-1146`). These stubs are wired directly into the hole bindings
  returned in `bodyIR.bindings` via `buildNvHoleBinding` (`nv-parser.ts:1194-1204`).
- Emit needs **erased source strings** (the output of `eraseSignalReadsInNode` /
  `computeThunkSource`) to write a re-executable `.js` module — not evaluated
  function objects. `bodyIR`'s hole bindings hold the latter, not the former, at every
  depth. There is no path from a stub closure back to its source text.
- Confirmed no code path anywhere in `nv-emitter.ts` attempts to serialize a binding's
  evaluated closure to source; the ONLY thing emitted from a binding is precomputed
  `ThunkSource` source strings. Option 2 would require re-deriving source from an
  evaluated closure, which is not possible in general (closures don't carry their
  originating AST/text at runtime).

Evidence for the actual gap (confirms Option 1 is sufficient and precisely scoped):

- `walkNvNodeList` — used by `buildNvSlotContentIR` for **every** body (`<each>` body
  at `nv-parser.ts:634`, `<recycle>` body at `:732`, `<switch>` branch/fallback body at
  `:817`, component slot body at `:923`/`:945`) — **already recurses** and already
  discovers nested components/lists/recycledLists/switches at arbitrary depth, wiring
  them into `bodyIR.bindings` in a fixed order: holes first (`holeInfos` order), then
  components, then lists, then recycledLists, then switches
  (`buildNvSlotContentIR`, `nv-parser.ts:1192-1230`).
- `buildNvSlotContentIR` returns only `{ ir, holeIndices, letNames }`
  (`nv-parser.ts:1236-1245`) — the nested component/list/recycledList/switch info the
  walk just produced (`components`, `slotLists`, `slotRecycledLists`, `slotSwitches`
  locals, `nv-parser.ts:1164-1171`) is **used to build `bodyIR.bindings` but never
  returned as pending info**. It is thrown away the moment the function returns.
- `PendingNvEachInfo`/`PendingNvRecycleInfo` (`nv-parser.ts:1362-1374`) have no field
  to receive it even if it were returned. `PendingNvSwitchInfo` (`:1376-1379`) keeps
  `bodyIR` per branch but nothing in `computeBindingThunks` ever reads it.
- `computeBindingThunks`'s body-thunk construction (`nv-parser.ts:3195-3208` for each,
  `:3236-3249` for recycle, `:3264-3277`/`:3284-3297` for switch branches/fallback) is
  a `.map()` over `bodyHoleIndices` only — structurally incapable of producing a
  `ThunkSource` for a nested list/recycledList/switch/component, because it never sees
  one.
- `ThunkSource`'s `list`/`recycled-list`/`switch` variants (`nv-parser.ts:131-149`)
  have only `bodyThunks: ThunkSource[]` — no channel for nested structural children.
- `emitIrLiteral` (`nv-emitter.ts:288-336`) walks `ir.bindings` **in bindings order**
  and pulls one `ThunkSource` per binding off a flat cursor
  (`const thunk = thunks[thunkIdx++]`, `nv-emitter.ts:~295`), dispatching on
  `thunk.kind` and throwing `"... thunk kind mismatch"` when the cursor and the
  binding disagree (list: `nv-emitter.ts:171`, recycled-list: `:196`, switch: `:217`).
  When `bodyIR.bindings` contains a nested structural binding that has no
  corresponding entry in `thunk.bodyThunks` (because it was never built), the cursor
  desyncs at that position and the throw fires. This exactly matches the reported
  failure mode.
- **Ordering constraint (load-bearing for Task 3):** the flat thunk array consumed by
  `emitIrLiteral` for a given `ir` must be in the SAME order as `ir.bindings`. The
  top-level `ir` (built by `processHtmlTemplate`, bindings pushed in the order
  component → list → recycledList → switch → hole, `nv-parser.ts:1509-1547`) is why
  `computeBindingThunks`'s top-level return concatenates
  `[...componentThunks, ...listThunks, ...recycledListThunks, ...switchThunks, ...holeThunks]`
  (`nv-parser.ts:3319`). Body IRs built by `buildNvSlotContentIR` push bindings in a
  **different** order — hole → component → list → recycledList → switch
  (`nv-parser.ts:1192-1230`). The recursive body-thunk assembler (Task 3) MUST
  reproduce `buildNvSlotContentIR`'s order, not the top-level order — they are
  different functions producing differently-ordered `bindings` arrays.
- One more real constraint already enforced upstream: `<recycle>` nested inside an
  `<each>` body is a **hard parse-time error** today
  (`nv-parser.ts:1218-1219`, `isEachBody` guard), independent of this bug. That
  remains out of scope to lift — it stays a documented, loudly-thrown unsupported
  combination (Task 7 adds a regression test asserting the throw still fires).

**Adjacent gap noted, explicitly OUT of scope:** a component's own slot content
(`buildNvSlotContentIR` called with `isEachBody=false` at `nv-parser.ts:923`/`:945`)
has the identical hole-only limitation for structural children nested directly inside
a component's slot (as opposed to inside an each/recycle/switch body). The G1 nesting
matrix in this commission only requires the four containers
(`<each>`, `<recycle>`, `<switch>` branch, `<switch>` fallback); component slot bodies
are not one of them. Do not fix this in the same change — note it in the landing
report as a related follow-up candidate, per G0 (no scope creep).

---
