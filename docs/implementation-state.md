# nv — Implementation State Map

**What this is.** A one-page orientation digest of *what exists in the code right now* —
file inventory, real-vs-stub status, the load-bearing seams, and known gaps. It exists
because the decision log records **decisions** and the contract records **semantics**, but
neither records **code facts** (e.g. "the `.nv` parser emits stub thunks"). Re-deriving
those each session is what caused churn; this file holds them.

**What this is NOT.** Not a decision record (those go in `decision-log.md`), not a semantics
spec (that is `reactive-core-contract.md`), and **not authoritative** — **GitHub is
authoritative for code.** This is a navigational summary, regenerated when reality moves. If
it disagrees with the source, the source wins and this file is stale → fix it.

**Maintenance.** Update in the same pass that lands code, as a ready-to-commit edit (same
discipline as log entries). Keep it to roughly this length; detail belongs in the code.

Last verified against source: **2026-06-20.** Contract **v0.4.2**, Template IR **v0.2**.

---

## File inventory (status per file)

Legend: **REAL** = production-complete & verified · **PARTIAL** = works for a subset ·
**STUB** = placeholder/not-runnable · **DEFERRED** = designed, not built.

### `src/core/` → `@neutro/view/core`
| File | Status | Notes |
|---|---|---|
| `core.ts` | REAL | Reactive runtime. 36/36 conformance. `tsc --strict` + DOM-lib clean. Contract v0.4.2. Exports incl. `signal`, `derived`, `effect`, `sync`, `createRoot`, `onCleanup`, `getOwner`, `runWithOwner`. Field order locked (cache-load-bearing). |

### `src/compiler/` → `@neutro/view/compiler`
| File | Status | Notes |
|---|---|---|
| `sync` classifier + write-graph cycle checker | REAL | Steps 1–2. 41/41. SignalId seam test-locked. |
| equality-policy inferencer (step 3) | REAL (inert) | Maps node value-type → `OBJECT_IS`/`false`/DECLINE. `_compilerEquals?` hook is an **inert stub** in core; not benchmarkable until wired. |
| branch-variant analyzer (step 4) | REAL (shelved) | Union oracle. Measured **net-negative**; SHELVED behind a reconcile-cost consumer (E2). |
| `emitted-mount.ts` | REAL | Compiler back-end. Consumes a **real-thunk** IR → specialized mount. Handles text/attr/prop/event/child/conditional/list; sync throws. 32/32. **Not on the v1 build-pipeline path** (build uses interpreter `mount`). |

### `src/renderer/` → `@neutro/view/renderer`
| File | Status | Notes |
|---|---|---|
| `ir.ts` | REAL | IR types, matches Template-IR v0.2 exactly. 8 binding kinds (6 PoC + List landed + Sync deferred). |
| `interpreter.ts` | REAL | Back-end / **semantic ground truth**. Exports `mount(ir, parent, doc): () => void` and `walkPath`. `mount` **creates its own `createRoot`**; effects enqueued, run on first flush. `mountFragment(ir,parent,doc,before?)` is **internal (not exported)** — there is **no setup-without-root primitive**. Handles all 6 PoC kinds + list; sync throws. Nested roots (conditional/list) are bridged manually via `onCleanup`. |
| `html-tag.ts` | **PARTIAL** | Tagged-template front-end (`createHtmlTag(doc)`). **Handles `text` + `attr` ONLY.** No prop/event/child/conditional/list. All holes must be thunks (`() => …`); non-function throws. Produces **real** (live-closure) thunks. |
| `nv-parser.ts` | **PARTIAL / structural-only** | `.nv` front-end. `parseNvFile(src, fileName, doc)` calls `preprocessMutationWrites` **internally** (call once). Produces real `shape.html` / `bindingPaths` / kinds / names / ACCEPT-PLAIN verdicts, **but all binding thunks are STUBS** (`const stubExpr = (() => undefined)`; FE tests do not compare thunks). Produces kinds: **text, attr, prop, event, conditional**. **Does NOT produce child or list** (no `.nv` syntax). **Discards** `$script` body, module imports, and non-`$component` top-level code (keeps signal/derived *names* only). |
| `comparator.ts` | REAL | Structural DOM comparison (`structurallyEqual`) for the differential suite. |

### `test/`, `integration/`
Differential conformance corpus TC-01..TC-10 (both back-ends), real-browser Playwright gate
(Chromium + cross-engine Blink/Gecko/WebKit), PoC integration. All green at last report.

---

## Load-bearing seams (touch with care)

- **IR is the only seam between 2 front-ends and 2 back-ends.** A wrong IR forks both
  back-ends. Front-end equivalence (IR §6.1) is enforced by the differential suite.
- **`mount` owns its root; nested roots are bridged by hand.** Any code that mounts *inside*
  another reactive scope (conditional, list, and the build pipeline's `$script` wrapper) must
  bridge the inner `createRoot`'s disposer via `onCleanup` — `createRoot` does **not**
  auto-attach to the parent owner.
- **Erasure regions.** `preprocessMutationWrites` erases bare-reads + mutation-writes inside
  `$script` blocks. **`parseNvFileForEmit` additionally erases render-template holes** (bare-read
  everywhere; mutation-write in event handler bodies via `eraseHandlerExpr`). Known gap:
  destructuring assignment targets in handlers fall through to bare-read only (fails safe; see
  Known gaps).
- **SignalId derivation** must use the same `signalSymbolId` across compiler steps 1–2/4 and
  any renderer write-back (SyncBinding `writeTargetId`).
- **`core.ts` is never modified by the compiler** (standing constraint). Field order locked.

---

## Known gaps / stubs / v0 limitations (named, not hidden)

- **Render-hole erasure built (build pipeline landed).** `eraseHandlerExpr` handles simple +
  compound assignment in handler arrow bodies (bare-read + mutation-write). **Known gap:
  destructuring assignment targets** (`[a, b] = ...`, `({ x } = ...)`) are not detected as
  signal writes — they fall through to bare-read erasure only (fails safe, no false-positive
  `.set()`). Document at the authoring surface; no v1 fix planned.
- **`.nv` parser thunks are stubs** — only structural form is real; runnable thunks must be
  generated by the consumer from erased hole source.
- **Child & List not `.nv`-reachable** — interpreter supports them via hand-authored IR only.
- **`html-tag.ts` covers text/attr only** — prop/event/conditional require manual IR or the
  `.nv` path.
- **Component API undesigned** — props/slots/identity/ComponentBinding is the next design gate
  (IR §9.3, *open*). No public component-invocation contract exists.
- **Equality hook inert; step 4 shelved** — neither specialization is wired to save work.
- **SyncBinding** throws at both back-ends.
- **`$style`** — parser extracts `{form, keys, source}`; scoping/injection unbuilt (own item).

---

## Not built at all (forward queue)
`$style` scoping, ComponentBinding + component API, SyncBinding,
LIS list move-minimization (parked), kind-split (parked behind real-app evidence).
