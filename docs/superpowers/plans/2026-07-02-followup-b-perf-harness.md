# Follow-up B: Perf Harness for `<recycle>`/conditional/`<switch>` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the standing `<recycle>` node-churn gate (`8da893a`) from one scroll-window scenario to a five-scenario mutation matrix (grow, shrink, full-replace, append, prepend), all failable and real-browser; add an nv-only wall-clock logging companion for those scenarios; and add advisory (non-failable) wall-clock + node-alloc baselines for conditional and `<switch>` branch-swap, which have no fixture today.

**Architecture:** Convert the existing `recycling-churn` fixture's backing array from a plain array to a signal so it supports structural mutation (not just window-position mutation), add three buttons (replace/append/prepend) alongside the existing scroll/set-n buttons, and extract a shared `MutationScenario` helper so the churn spec parametrizes one assertion path across five scenarios instead of forking five specs. A second, advisory-only spec reuses the same fixture to log wall-clock timing. A third, wholly new fixture pair covers conditional (ternary-in-template syntax) and `<switch>`/`<match>` branch-swap, advisory-only.

**Tech Stack:** Playwright (real-browser, Chromium+WebKit+Firefox), esbuild + `nvPlugin`, TypeScript, `.nv` component syntax, existing `__test.{nodeAllocCount,nodeFreeCount,resetNodeCounts}` core instrumentation (consumed, not modified).

## Global Constraints

- No `src/core/` diff of any kind (instrumentation is consumed, not extended). Any perceived need for new instrumentation is a stop-and-escalate condition, not a task in this plan.
- The existing `8da893a` scroll-window churn assertion (`test/browser/recycling-node-churn.spec.ts`, tests `A2 recycled` / `A2 keyed control` / `A3 wall-clock`) must remain unmodified and passing — extend around it, do not touch its body.
- No wall-clock timing may ever be turned into a failable `expect`. Timing is `console.log`'d only, mirroring the existing `A3 wall-clock` test's `expect(true).toBe(true)` sentinel pattern.
- conditional/`<switch>` baselines are advisory only — never gated with a real assertion beyond the `expect(true).toBe(true)` sentinel.
- No JSDOM anywhere in a churn-verdict path — all churn/alloc assertions run via Playwright's real-browser `page` fixture.
- One churn-measurement path: grow/shrink/replace/append/prepend share `app-recycled.nv`/`app-keyed.nv` (extended, not forked) and one parametrized assertion helper — not five copy-pasted spec bodies.
- `pnpm typecheck` (`tsc -p tsconfig.json --noEmit`) and `pnpm lint` (`biome check .`) must be clean at the end.
- Full existing suite must stay green: `pnpm test` (unit/vitest) and `pnpm test:browser` (Playwright) — reconfirm actual pass counts at your landing SHA before claiming no regression (repo state at plan-writing time: `835/835` unit + `276` browser at `3a3cdbe`, HEAD is now `ce81714`; re-run independently, don't trust the stale count).

---

## Correction to the commission's premise (read first — narrows Deliverable 2/3 scope)

The commission's Deliverable 2 says to "bring the recycle scenarios alongside the existing keyed foil set (Solid/Svelte/Lit/React/Vanilla, `isKeyed` verified — per PK)" and Deliverable 3 says advisory baselines should "run in the jfb venue" logging "foil wall-clock." **Verified at `ce81714`: this in-repo foil venue does not exist.**

- `package.json` has zero dependencies on `solid-js`, `svelte`, `lit`, or `react`.
- `grep -rli "jfb\|foil"` across the repo finds no committed multi-framework harness. The only hits are `test/browser/nv-benchmark-probe.spec.ts` (an nv-only spec whose *fixture app* happens to be shaped like a js-framework-benchmark row-table — "jfb" describes the app topology, not a multi-framework runner) and `docs/decision-log-archive.md`'s CP-2d entry.
- Reading CP-2d in full (`docs/decision-log-archive.md:3555-3622`): the actual foil comparison (Solid/Svelte/Lit/React/Vanilla vs nv) was run against an **external** clone of the real `js-framework-benchmark` repo (SHA `4fbccf55`), driven by a one-off **Puppeteer** script on the architect's own machine ("Chrome 149 / M2 Max / harness `4fbccf55`"), with a hand-copied `frameworks/keyed/nv-v010/` folder. It is not Playwright, not `pnpm test:browser`, not CI-integrated, and not present as source in this repo at all.

So "the jfb harness venue" the commission refers to is an out-of-band, manually-run external harness, not in-repo automation this plan can "extend." Building an in-repo, CI-runnable clone of `js-framework-benchmark` with five framework dependencies wired in is a materially larger, distinct workstream the commission doesn't scope (new deps, external-repo vendoring or submodule, a Puppeteer or Playwright driver for non-nv apps) — out of scope here per the commission's own "if you need new instrumentation, stop and escalate" spirit applied to infra, not just `src/core/`.

**Resolution applied in this plan:** Deliverable 2's "jfb venue" integration is scoped to the **in-repo, nv-only** venue pattern already established by `nv-benchmark-probe.spec.ts` (esbuild+Playwright, build-once-in-`beforeAll`, mount-and-measure via `performance.now()`, log-not-assert). Task 4 below adds a new spec in that pattern that logs wall-clock for the five recycle scenarios. **No foil (Solid/Svelte/Lit/React/Vanilla) timing is produced by this plan** — that remains the external, manual CP-2d-style process. Deliverable 3's advisory conditional/switch baselines are similarly nv-only, logged in the same in-repo pattern.

This is a scope correction the implementer should report alongside the SHA, exactly as the commission's own §"Correction to the follow-up-note premise" was reported — do not silently reinterpret Deliverable 2/3 without flagging it.

---

## Deviation discovered during execution (decided with the requester — apply this instead of the original Task 1/2/3 text below where they conflict)

**Task 3's implementer found a second, independent premise error while implementing:** the commission assumed grow (N=50→100) and shrink (100→50) are "mutations where positional recycling should still reuse nodes" (zero churn). This is false for `<recycle>`'s actual implementation. `wireRecycledList` (`src/renderer/interpreter.ts:777-849`) sizes its pool to exactly the current list length on every effect run, with no free-list retention across a resize:

```
// Grow [P, N) — create only the delta.
for (let i = P; i < N; i++) { ... pool.push(...) }
// Shrink [N, P) — dispose only the delta.
for (let i = N; i < P; i++) { pool[i]!.dispose() }
pool.length = N
```

Shrinking permanently disposes the excess pool entries; growing again allocates fresh ones. The standing `8da893a` zero-churn claim only ever covered a **fixed-size sliding window** (`windowN` constant, only `windowStart` moves) — grow/shrink is the first scenario to exercise `windowN` changing at all, and it's a capability `<recycle>` was never built or documented to guarantee. Building high-water-mark pooling to make grow/shrink zero-churn would be a `src/renderer/` feature change — out of scope for this test-infra commission (which explicitly forbids `src/core/` changes and says "do not rebuild `8da893a`... extend scenario coverage").

**Decision (requester-confirmed):** grow/shrink stay in the matrix but run as **advisory** (logged, never asserted) rather than failable — consistent with the commission's own rule that only constructs with a load-bearing zero-churn claim get a failable gate. This keeps a standing evidence trail (real alloc/free numbers on every `pnpm test:browser` run) for a future commission to decide whether high-water-mark pooling is worth building — rather than dropping the scenario and losing that data. **Task 6's landing report must explicitly flag this as a follow-up-commission candidate** ("`<recycle>` has no zero-churn guarantee across window-size resize — grow/shrink numbers are now tracked advisory-only; a future commission should decide whether to build high-water-mark pooling based on the logged numbers").

**A second, independent bug was found in the same investigation:** the `replace` scenario's keyed-control leg failed for an unrelated reason — `replaceAll()` (Task 1's fixture code) preserves every row's `id` and only changes `label`, so the keyed `<each key="${(row) => row.id}">` control correctly detects no identity change and shows zero churn too (correct `<each>` behavior — not a `<recycle>` or `<each>` bug). This defeats the keyed-contrast purpose of the `replace` scenario. **Fix:** `replaceAll()` must assign new ids on every call so the keyed control's identity genuinely changes. Task 1's fixture code below is corrected accordingly (was already committed as `0043173` — this requires a follow-up fixture commit before Task 3 can proceed).

**Concretely, this changes:**
- Task 1's `replaceAll()` in both `app-recycled.nv` and `app-keyed.nv` (corrected code below, supersedes the originally-committed version).
- Task 2's `MutationScenario` type gains a `mode: 'failable' | 'advisory'` field; `SCENARIOS` marks `grow`/`shrink` as `'advisory'` and `replace`/`append`/`prepend` as `'failable'` (corrected code below, supersedes the originally-committed version).
- Task 3's test-generation loop branches on `scenario.mode`: `'failable'` scenarios get the original two-test (recycled FIRE + keyed contrast) treatment; `'advisory'` scenarios get a single logged-only test per arm, matching the `A3 wall-clock` sentinel pattern (corrected code below).

---

## File Structure

- **Modify** `test/browser/fixtures/recycling-churn/app-recycled.nv` — convert `allRows` to a `signal`, add `replace-all`/`append-rows`/`prepend-rows` buttons and handlers.
- **Modify** `test/browser/fixtures/recycling-churn/app-keyed.nv` — same conversion, mirrored for the keyed-contrast arm.
- **Create** `test/browser/fixtures/recycling-churn/scenarios.ts` — shared `MutationScenario` list + `mutationStep` helper, imported by both the churn-matrix spec and the wall-clock spec (DRY: one definition of what "grow"/"shrink"/"replace"/"append"/"prepend" means).
- **Modify** `test/browser/recycling-node-churn.spec.ts` — add the parametrized churn-matrix tests (10 new tests: 5 scenarios × {recycled FIRE, keyed contrast}). Existing 3 tests untouched.
- **Create** `test/browser/nv-benchmark-recycle.spec.ts` — advisory wall-clock logging for the same 5 scenarios, nv-only, in the `nv-benchmark-probe.spec.ts` build/measure pattern.
- **Create** `test/browser/fixtures/benchmark-conditional/app-conditional.nv` — ternary-conditional branch-swap fixture.
- **Create** `test/browser/fixtures/benchmark-conditional/app-switch.nv` — 5-branch `<switch>`/`<match>` cycle fixture.
- **Create** `test/browser/fixtures/benchmark-conditional/entry.ts` — bundle entry exporting both apps + `flushSync` + `__test`.
- **Create** `test/browser/nv-benchmark-conditional.spec.ts` — advisory wall-clock + node-alloc logging for both fixtures.

---

## Task 1: Convert recycling-churn fixtures to support structural mutation

**Files:**
- Modify: `test/browser/fixtures/recycling-churn/app-recycled.nv`
- Modify: `test/browser/fixtures/recycling-churn/app-keyed.nv`
- Test: `test/browser/recycling-node-churn.spec.ts` (existing 3 tests — regression check only, no new test yet)

**Interfaces:**
- Produces: `#replace-all`, `#append-rows`, `#prepend-rows` button IDs (consumed by Task 2's `scenarios.ts` and Task 4's wall-clock spec). `allRows` becomes a `signal<Array<{id: number, label: string}>>` (was a plain array) — the `.of="${allRows().slice(...)}"` call-site changes accordingly. `windowStart`/`windowN` signals and `#scroll-step`/`#set-n-50`/`#set-n-100` buttons are unchanged (still consumed by the existing `8da893a` tests).

- [ ] **Step 1: Rewrite `app-recycled.nv` with signal-backed `allRows` and the three new mutation handlers**

```
const AppRecycled = $component(() => {
  $script(() => {
    const M = 10000
    const S = 25
    const K = 20

    function makeRows(count, offset) {
      const out = []
      for (let i = 0; i < count; i++) out.push({ id: offset + i, label: 'row-' + (offset + i) })
      return out
    }

    const allRows = signal(makeRows(M, 0))
    const windowStart = signal(0)
    const windowN = signal(50)
    let nextId = M
    let replaceVersion = 0

    function scrollStep() {
      windowStart.set((windowStart() + S) % (allRows().length - 100))
    }
    function replaceAll() {
      replaceVersion++
      const v = replaceVersion
      // New ids on every call — a replace that preserves ids is invisible to a
      // keyed-identity reconciler (it correctly no-ops), which defeats the
      // keyed-contrast leg of this scenario. New ids force genuine identity churn.
      allRows.set(allRows().map((r, idx) => ({ id: v * M + idx, label: 'v' + v + '-' + idx })))
    }
    function appendRows() {
      const added = makeRows(K, nextId)
      nextId += K
      const next = [...allRows(), ...added]
      allRows.set(next)
      // Keep a trailing full-size window so the appended rows are actually visible —
      // pinning windowStart to the appended slice alone would collapse the window
      // to K rows instead of exercising the documented 50/100-row size.
      windowStart.set(Math.max(0, next.length - windowN()))
    }
    function prependRows() {
      const added = makeRows(K, nextId)
      nextId += K
      allRows.set([...added, ...allRows()])
      windowStart.set(0)
    }
  })
  $render(() => html`
    <div>
      <button id="scroll-step" @click="${() => scrollStep()}">Scroll</button>
      <button id="set-n-50" @click="${() => windowN.set(50)}">N=50</button>
      <button id="set-n-100" @click="${() => windowN.set(100)}">N=100</button>
      <button id="replace-all" @click="${() => replaceAll()}">Replace</button>
      <button id="append-rows" @click="${() => appendRows()}">Append</button>
      <button id="prepend-rows" @click="${() => prependRows()}">Prepend</button>
      <recycle .of="${allRows().slice(windowStart(), windowStart() + windowN())}" let={item, i}>
        <div class="row" data-id="${item.id}">${item.label}</div>
      </recycle>
    </div>
  `)
})
```

- [ ] **Step 2: Rewrite `app-keyed.nv` identically, swapping `<recycle>` for `<each key=...>`**

```
const AppKeyed = $component(() => {
  $script(() => {
    const M = 10000
    const S = 25
    const K = 20

    function makeRows(count, offset) {
      const out = []
      for (let i = 0; i < count; i++) out.push({ id: offset + i, label: 'row-' + (offset + i) })
      return out
    }

    const allRows = signal(makeRows(M, 0))
    const windowStart = signal(0)
    const windowN = signal(50)
    let nextId = M
    let replaceVersion = 0

    function scrollStep() {
      windowStart.set((windowStart() + S) % (allRows().length - 100))
    }
    function replaceAll() {
      replaceVersion++
      const v = replaceVersion
      // New ids on every call — a replace that preserves ids is invisible to a
      // keyed-identity reconciler (it correctly no-ops), which defeats the
      // keyed-contrast leg of this scenario. New ids force genuine identity churn.
      allRows.set(allRows().map((r, idx) => ({ id: v * M + idx, label: 'v' + v + '-' + idx })))
    }
    function appendRows() {
      const added = makeRows(K, nextId)
      nextId += K
      const next = [...allRows(), ...added]
      allRows.set(next)
      // Keep a trailing full-size window so the appended rows are actually visible —
      // pinning windowStart to the appended slice alone would collapse the window
      // to K rows instead of exercising the documented 50/100-row size.
      windowStart.set(Math.max(0, next.length - windowN()))
    }
    function prependRows() {
      const added = makeRows(K, nextId)
      nextId += K
      allRows.set([...added, ...allRows()])
      windowStart.set(0)
    }
  })
  $render(() => html`
    <div>
      <button id="scroll-step" @click="${() => scrollStep()}">Scroll</button>
      <button id="set-n-50" @click="${() => windowN.set(50)}">N=50</button>
      <button id="set-n-100" @click="${() => windowN.set(100)}">N=100</button>
      <button id="replace-all" @click="${() => replaceAll()}">Replace</button>
      <button id="append-rows" @click="${() => appendRows()}">Append</button>
      <button id="prepend-rows" @click="${() => prependRows()}">Prepend</button>
      <each .of="${allRows().slice(windowStart(), windowStart() + windowN())}" key="${(row) => row.id}" let={item}>
        <div class="row" data-id="${item.id}">${item.label}</div>
      </each>
    </div>
  `)
})
```

- [ ] **Step 3: Run the existing (unmodified) churn tests to confirm the fixture rewrite didn't break the standing gate**

Run: `pnpm test:browser --project=chromium test/browser/recycling-node-churn.spec.ts`
Expected: All 3 existing tests PASS (`A2 recycled`, `A2 keyed control`, `A3 wall-clock`) — the `allRows()` call-site change must not alter scroll-step behavior, since `.slice()` semantics are identical whether `allRows` is a plain array or a signal read once per render.

- [ ] **Step 4: Commit**

```bash
git add test/browser/fixtures/recycling-churn/app-recycled.nv test/browser/fixtures/recycling-churn/app-keyed.nv
git commit -m "test(recycling-churn): make allRows signal-backed, add replace/append/prepend handlers"
```

---

## Task 2: Shared scenario definitions

**Files:**
- Create: `test/browser/fixtures/recycling-churn/scenarios.ts`

**Interfaces:**
- Consumes: nothing (pure data/helper module, only depends on `@playwright/test`'s `Page` type).
- Produces: `export type MutationScenario = { key: 'grow' | 'shrink' | 'replace' | 'append' | 'prepend'; label: string; stepButtonIds: string[]; mode: 'failable' | 'advisory' }`, `export const SCENARIOS: MutationScenario[]`, `export async function mutationStep(page: Page, scenario: MutationScenario, flush: () => Promise<void>): Promise<void>`. Consumed by Task 3 (`recycling-node-churn.spec.ts`) and Task 4 (`nv-benchmark-recycle.spec.ts`).

- [ ] **Step 1: Write `scenarios.ts`**

```typescript
import type { Page } from '@playwright/test'

export type MutationScenario = {
  key: 'grow' | 'shrink' | 'replace' | 'append' | 'prepend'
  label: string
  stepButtonIds: string[]
  mode: 'failable' | 'advisory'
}

// Note: 'grow' and 'shrink' are the same N-oscillation (50↔100) with the click
// order reversed, not independently-designed mutations — both directions of the
// documented "window grow/shrink" requirement are covered this way without a
// separate windowN size to add.
//
// grow/shrink are 'advisory', not 'failable': <recycle>'s pool
// (wireRecycledList, src/renderer/interpreter.ts:777-849) sizes to exactly the
// current list length on every run with no free-list retention across a
// resize — shrinking disposes the excess pool entries, growing allocates
// fresh ones. There is no zero-churn guarantee across a windowN change (only
// the fixed-size sliding-window scroll, 8da893a's original claim, is
// zero-churn). Discovered during Task 3 implementation — see plan's
// "Deviation discovered during execution" section. Logged for a future
// commission to decide whether high-water-mark pooling is worth building.
export const SCENARIOS: MutationScenario[] = [
  { key: 'grow', label: 'window grow (N=50→100)', stepButtonIds: ['#set-n-50', '#set-n-100'], mode: 'advisory' },
  { key: 'shrink', label: 'window shrink (N=100→50)', stepButtonIds: ['#set-n-100', '#set-n-50'], mode: 'advisory' },
  { key: 'replace', label: 'full replace', stepButtonIds: ['#replace-all'], mode: 'failable' },
  { key: 'append', label: 'append tail', stepButtonIds: ['#append-rows'], mode: 'failable' },
  { key: 'prepend', label: 'prepend head', stepButtonIds: ['#prepend-rows'], mode: 'failable' },
]

export async function mutationStep(
  page: Page,
  scenario: MutationScenario,
  flush: () => Promise<void>,
): Promise<void> {
  for (const id of scenario.stepButtonIds) {
    await page.locator(id).click()
    await flush()
  }
}
```

- [ ] **Step 2: Typecheck the new file in isolation**

Run: `pnpm typecheck`
Expected: No errors referencing `scenarios.ts` (it isn't imported anywhere yet, so this mainly checks syntax).

- [ ] **Step 3: Commit**

```bash
git add test/browser/fixtures/recycling-churn/scenarios.ts
git commit -m "test(recycling-churn): add shared mutation-scenario definitions"
```

---

## Task 3: Extend the churn gate to the scenario matrix (failable)

**Files:**
- Modify: `test/browser/recycling-node-churn.spec.ts`

**Interfaces:**
- Consumes: `SCENARIOS`, `MutationScenario`, `mutationStep` from `./fixtures/recycling-churn/scenarios.js` (Task 2); existing `ChurnGlobal` type, `mountArm`, `BUNDLE` build already in this file.
- Produces: 10 new tests, no new exports (this is a spec file, not a module).

- [ ] **Step 1a: Add the new import to the existing top-of-file import block**

Insert as a new line immediately after line 13 (`import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'`) in `test/browser/recycling-node-churn.spec.ts` — this must live with the other `import` statements, not inline with the helper functions added in Step 1b, or `biome check .`'s import-organization rule will fail Task 6's lint gate:

```typescript
import { type MutationScenario, SCENARIOS, mutationStep } from './fixtures/recycling-churn/scenarios.js'
```

- [ ] **Step 1b: Add a `runChurnScenario` helper below the existing `scrollStep` function**

Insert after line 101 (`async function scrollStep(...)`) in `test/browser/recycling-node-churn.spec.ts` — function bodies only, no import statements here:

```typescript
async function flushChurn(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn.flushSync()
  })
}

async function runChurnScenario(
  page: import('@playwright/test').Page,
  arm: 'AppRecycled' | 'AppKeyed',
  scenario: MutationScenario,
): Promise<{ allocCount: number; freeCount: number }> {
  await mountArm(page, arm)

  await page.evaluate(() => {
    ;(window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn.__test.resetNodeCounts()
  })
  for (let i = 0; i < WARMUP_STEPS; i++) {
    await mutationStep(page, scenario, () => flushChurn(page))
  }

  await page.evaluate(() => {
    ;(window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn.__test.resetNodeCounts()
  })
  for (let i = 0; i < MEASURED_STEPS; i++) {
    await mutationStep(page, scenario, () => flushChurn(page))
  }

  return page.evaluate(() => {
    const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
    return { allocCount: g.__test.nodeAllocCount, freeCount: g.__test.nodeFreeCount }
  })
}
```

- [ ] **Step 2: Add the parametrized test loop at the end of the file, after the existing `A3 wall-clock` test**

`replace`/`append`/`prepend` (`mode: 'failable'`) get the original two-test treatment (recycled FIRE + keyed contrast). `grow`/`shrink` (`mode: 'advisory'`) get a single logged-only test per arm — `<recycle>` has no zero-churn guarantee across a `windowN` resize (see plan's "Deviation discovered during execution" section), so asserting `toBe(0)` here would be asserting a claim nobody makes.

```typescript
for (const scenario of SCENARIOS) {
  if (scenario.mode === 'failable') {
    test(`A2 matrix — ${scenario.label} — recycled: zero churn (FIRE)`, async ({ page }) => {
      const { allocCount, freeCount } = await runChurnScenario(page, 'AppRecycled', scenario)
      console.log(`\nA2 matrix [${scenario.key}] recycled — alloc=${allocCount} free=${freeCount}`)
      expect(allocCount, `${scenario.key}: zero ReactiveNode allocations`).toBe(0)
      expect(freeCount, `${scenario.key}: zero ReactiveNode frees`).toBe(0)
    })

    test(`A2 matrix — ${scenario.label} — keyed control: churn > 0`, async ({ page }) => {
      const { allocCount } = await runChurnScenario(page, 'AppKeyed', scenario)
      console.log(`\nA2 matrix [${scenario.key}] keyed — alloc=${allocCount}`)
      expect(
        allocCount,
        `${scenario.key}: keyed control shows non-zero allocations (proves churn detectable)`,
      ).toBeGreaterThan(0)
    })
  } else {
    test(`ADVISORY A2 matrix — ${scenario.label} — recycled (logged, never asserted — no zero-churn guarantee across window resize)`, async ({
      page,
    }) => {
      const { allocCount, freeCount } = await runChurnScenario(page, 'AppRecycled', scenario)
      console.log(
        `\nADVISORY A2 matrix [${scenario.key}] recycled — alloc=${allocCount} free=${freeCount} (known gap: no free-list retention across windowN resize — follow-up-commission candidate)`,
      )
      expect(true).toBe(true)
    })
  }
}
```

- [ ] **Step 3: Run the full matrix on Chromium first (fast feedback), then all three browsers**

Run: `pnpm test:browser --project=chromium test/browser/recycling-node-churn.spec.ts`
Expected: 12 tests total (3 existing + 2×3 failable-scenario tests + 2×1 advisory-scenario tests = 3+6+2 = 11 — recount precisely: 3 failable scenarios × 2 tests = 6, plus 2 advisory scenarios × 1 test = 2, plus 3 existing = 11) all PASS. (Implementer: trust the actual `pnpm test:browser --list` count over this arithmetic if they disagree — recompute from `SCENARIOS.length` and each scenario's `mode` rather than trusting this comment.)

Run: `pnpm test:browser test/browser/recycling-node-churn.spec.ts`
Expected: 11 tests × 3 browsers = 33 PASS.

- [ ] **Step 4: If any `failable`-mode `recycled` scenario (replace/append/prepend) shows non-zero alloc/free, or any `failable`-mode keyed control shows zero alloc, debug before proceeding — do not weaken the assertion**

This is a genuine regression signal (e.g. `<recycle>` may not diff by position correctly under one of these mutation shapes, or the fixture's identity-change logic is broken) — per the commission, a zero-churn assertion that can fail is the entire point. Investigate via `systematic-debugging` skill rather than loosening the `toBe(0)`/`toBeGreaterThan(0)` assertions or excluding the scenario. `grow`/`shrink` (`advisory` mode) never fail regardless of their numbers — that's expected and already resolved (see "Deviation discovered during execution").

- [ ] **Step 5: Commit**

```bash
git add test/browser/recycling-node-churn.spec.ts
git commit -m "test(recycling-churn): extend node-churn gate to grow/shrink/replace/append/prepend matrix"
```

---

## Task 4: Advisory wall-clock logging for the recycle scenario matrix (jfb-venue pattern, nv-only)

**Files:**
- Create: `test/browser/nv-benchmark-recycle.spec.ts`

**Interfaces:**
- Consumes: `SCENARIOS`, `MutationScenario`, `mutationStep` from `./fixtures/recycling-churn/scenarios.js` (Task 2); rebuilds its own bundle from `test/browser/fixtures/recycling-churn/entry.ts` (same fixture dir as Task 1/3, independent esbuild pass — matches the existing precedent of `nv-benchmark-probe.spec.ts` doing its own `beforeAll` build rather than sharing a build across spec files).
- Produces: nothing consumed elsewhere — this is a terminal, advisory-logging spec file.

- [ ] **Step 1: Write the spec, modeled on `nv-benchmark-probe.spec.ts`'s build block and `recycling-node-churn.spec.ts`'s `A3 wall-clock` test**

```typescript
/**
 * nv-benchmark-recycle — advisory wall-clock for the <recycle> mutation matrix
 *
 * In-repo nv-only venue (see docs/superpowers/plans/2026-07-02-followup-b-perf-harness.md
 * "Correction to the commission's premise" — no Solid/Svelte/Lit/React/Vanilla foil
 * harness exists in this repo; that comparison remains the external, manual CP-2d
 * process). Timing here is ADVISORY ONLY — logged, never asserted.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'
import { SCENARIOS, mutationStep } from './fixtures/recycling-churn/scenarios.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixtureDir = join(__dirname, 'fixtures/recycling-churn')
const distDir = join(__dirname, 'dist')
const BUNDLE = join(distDir, 'nv-recycling-churn-bundle.js')

const WARMUP_STEPS = 5
const MEASURED_STEPS = 40

type ChurnGlobal = {
  AppRecycled: { mount(p: Element, d: Document): () => void }
  AppKeyed: { mount(p: Element, d: Document): () => void }
  flushSync(): void
  __test: { nodeAllocCount: number; nodeFreeCount: number; resetNodeCounts(): void }
}

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })
  await esbuild.build({
    entryPoints: [join(fixtureDir, 'entry.ts')],
    bundle: true,
    outfile: BUNDLE,
    format: 'iife',
    globalName: '__nvChurn',
    platform: 'browser',
    target: 'es2022',
    metafile: false,
    sourcemap: false,
    minify: false,
    plugins: [
      nvPlugin(),
      {
        name: 'ts-resolve',
        setup(build) {
          build.onResolve({ filter: /\.js$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts')),
          }))
        },
      },
      {
        name: 'neutro-alias',
        setup(build) {
          build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({
            path: join(repoRoot, 'src/core/index.ts'),
          }))
          build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
            path: join(repoRoot, 'src/renderer/index.ts'),
          }))
          build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
            path: join(repoRoot, 'src/renderer/runtime.ts'),
          }))
          build.onResolve({ filter: /^@neutro\/view\/core\/internal$/ }, () => ({
            path: join(repoRoot, 'src/core/core.ts'),
          }))
        },
      },
    ],
  })
})

async function mountArm(
  page: import('@playwright/test').Page,
  arm: 'AppRecycled' | 'AppKeyed',
): Promise<void> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate((armName) => {
    const g = (window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn
    g[armName].mount(document.body, document)
    g.flushSync()
  }, arm)
}

async function flushChurn(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __nvChurn: ChurnGlobal }).__nvChurn.flushSync()
  })
}

// One test per (scenario, arm) pair — NOT a single test iterating the whole
// matrix. A single-test-body design was tried first and timed out on firefox
// (default 30s Playwright test timeout; firefox's per-click round-trip in this
// environment is slow enough that 5 scenarios × 2 arms × 45 clicks each
// cumulatively exceeds the budget even though nothing in the body is a real
// assertion). Splitting gives each pair its own 30s budget, matching the
// per-scenario test pattern already used in the Task 3 churn matrix.
for (const scenario of SCENARIOS) {
  for (const arm of ['AppRecycled', 'AppKeyed'] as const) {
    test(`ADVISORY wall-clock — ${scenario.label} — ${arm} (nv-only, logged never asserted)`, async ({
      page,
    }) => {
      await mountArm(page, arm)
      for (let i = 0; i < WARMUP_STEPS; i++) {
        await mutationStep(page, scenario, () => flushChurn(page))
      }
      const times: number[] = []
      for (let i = 0; i < MEASURED_STEPS; i++) {
        const t0 = Date.now()
        await mutationStep(page, scenario, () => flushChurn(page))
        times.push(Date.now() - t0)
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length
      const max = Math.max(...times)
      console.log(
        `\nADVISORY [${scenario.key}] ${arm} — avg=${avg.toFixed(2)}ms max=${max.toFixed(2)}ms (round-trip incl. IPC; not isolated in-page timing)`,
      )
      // Advisory only — no timing assertion, matches A3 wall-clock discipline.
      expect(true).toBe(true)
    })
  }
}
```

- [ ] **Step 2: Run it and eyeball the log output**

Run: `pnpm test:browser --project=chromium test/browser/nv-benchmark-recycle.spec.ts`
Expected: 10 tests PASS (5 scenarios × 2 arms, one test each); console output shows 10 `ADVISORY [...] ... avg=...ms max=...ms` lines. Also run `pnpm test:browser --project=firefox test/browser/nv-benchmark-recycle.spec.ts` — firefox is the browser that previously timed out on the single-test-body design; confirm all 10 pass within the default timeout now that each pair has its own budget.

- [ ] **Step 3: Commit**

```bash
git add test/browser/nv-benchmark-recycle.spec.ts
git commit -m "test(benchmark): advisory wall-clock logging for recycle mutation matrix"
```

---

## Task 5: conditional/`<switch>` advisory fixtures and spec

**Files:**
- Create: `test/browser/fixtures/benchmark-conditional/app-conditional.nv`
- Create: `test/browser/fixtures/benchmark-conditional/app-switch.nv`
- Create: `test/browser/fixtures/benchmark-conditional/entry.ts`
- Create: `test/browser/nv-benchmark-conditional.spec.ts`

**Interfaces:**
- Produces: nothing consumed elsewhere — terminal, advisory-logging deliverable.
- Note on syntax: conditional is not an XML element — there is no `<conditional>`/`<if>`/`<iff>` tag in this codebase. `${cond ? html\`...\` : html\`...\`}` (a ternary whose branches are `html` tagged templates) compiles to IR kind `'conditional'` (`src/renderer/nv-parser.ts:391-409`, `src/renderer/interpreter.ts:143`). `<switch>`/`<match when="...">` is the multi-branch construct and IS a real element (`src/renderer/interpreter.ts:147`, precedent: `test/browser/fixtures/nested-structural/switch-in-each.nv`).

- [ ] **Step 1: Write `app-conditional.nv` — boolean branch-swap**

```
const AppConditional = $component(() => {
  $script(() => {
    const flag = signal(true)
    function toggle() {
      flag.set(!flag())
    }
  })
  $render(() => html`
    <div>
      <button id="toggle" @click="${() => toggle()}">Toggle</button>
      ${flag()
        ? html`<div class="branch-a"><p>Branch A</p></div>`
        : html`<div class="branch-b"><p>Branch B</p></div>`}
    </div>
  `)
})
```

- [ ] **Step 2: Write `app-switch.nv` — 5-branch cycle**

```
const AppSwitch = $component(() => {
  $script(() => {
    const mode = signal(0)
    function cycle() {
      mode.set((mode() + 1) % 5)
    }
  })
  $render(() => html`
    <div>
      <button id="cycle" @click="${() => cycle()}">Cycle</button>
      <switch>
        <match when="${mode() === 0}"><div class="branch-0">Branch 0</div></match>
        <match when="${mode() === 1}"><div class="branch-1">Branch 1</div></match>
        <match when="${mode() === 2}"><div class="branch-2">Branch 2</div></match>
        <match when="${mode() === 3}"><div class="branch-3">Branch 3</div></match>
        <match><div class="branch-4">Branch 4</div></match>
      </switch>
    </div>
  `)
})
```

- [ ] **Step 3: Write `entry.ts`**

```typescript
// @ts-nocheck — .nv modules have no TypeScript declarations.
export { AppConditional } from './app-conditional.nv'
export { AppSwitch } from './app-switch.nv'
export { flushSync } from '@neutro/view/core'
// __test is intentionally not in src/core/index.ts (public API); import directly.
export { __test } from '@neutro/view/core/internal'
```

- [ ] **Step 4: Write `nv-benchmark-conditional.spec.ts`**

```typescript
/**
 * nv-benchmark-conditional — ADVISORY baseline for conditional and `<switch>`
 *
 * No load-bearing perf claim exists for these constructs; this records wall-clock
 * + node-alloc/free numbers for future same-session before/after comparison.
 * ADVISORY ONLY — logged, never asserted (no failable perf gate on these constructs).
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import * as esbuild from 'esbuild'
import { nvPlugin } from '../../src/renderer/nv-esbuild-plugin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const fixtureDir = join(__dirname, 'fixtures/benchmark-conditional')
const distDir = join(__dirname, 'dist')
const BUNDLE = join(distDir, 'nv-benchmark-conditional-bundle.js')

const WARMUP_STEPS = 5
const MEASURED_STEPS = 40

type CondGlobal = {
  AppConditional: { mount(p: Element, d: Document): () => void }
  AppSwitch: { mount(p: Element, d: Document): () => void }
  flushSync(): void
  __test: { nodeAllocCount: number; nodeFreeCount: number; resetNodeCounts(): void }
}

test.beforeAll(async () => {
  await mkdir(distDir, { recursive: true })
  await esbuild.build({
    entryPoints: [join(fixtureDir, 'entry.ts')],
    bundle: true,
    outfile: BUNDLE,
    format: 'iife',
    globalName: '__nvCond',
    platform: 'browser',
    target: 'es2022',
    metafile: false,
    sourcemap: false,
    minify: false,
    plugins: [
      nvPlugin(),
      {
        name: 'ts-resolve',
        setup(build) {
          build.onResolve({ filter: /\.js$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts')),
          }))
        },
      },
      {
        name: 'neutro-alias',
        setup(build) {
          build.onResolve({ filter: /^@neutro\/view\/core$/ }, () => ({
            path: join(repoRoot, 'src/core/index.ts'),
          }))
          build.onResolve({ filter: /^@neutro\/view\/renderer$/ }, () => ({
            path: join(repoRoot, 'src/renderer/index.ts'),
          }))
          build.onResolve({ filter: /^@neutro\/view\/renderer\/runtime$/ }, () => ({
            path: join(repoRoot, 'src/renderer/runtime.ts'),
          }))
          build.onResolve({ filter: /^@neutro\/view\/core\/internal$/ }, () => ({
            path: join(repoRoot, 'src/core/core.ts'),
          }))
        },
      },
    ],
  })
})

async function mountArm(
  page: import('@playwright/test').Page,
  arm: 'AppConditional' | 'AppSwitch',
): Promise<void> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
  await page.evaluate((armName) => {
    const g = (window as unknown as { __nvCond: CondGlobal }).__nvCond
    g[armName].mount(document.body, document)
    g.flushSync()
  }, arm)
}

async function flush(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __nvCond: CondGlobal }).__nvCond.flushSync()
  })
}

async function measure(
  page: import('@playwright/test').Page,
  arm: 'AppConditional' | 'AppSwitch',
  buttonId: string,
): Promise<{ avgMs: number; maxMs: number; allocCount: number; freeCount: number }> {
  await mountArm(page, arm)
  for (let i = 0; i < WARMUP_STEPS; i++) {
    await page.locator(buttonId).click()
    await flush(page)
  }
  await page.evaluate(() => {
    ;(window as unknown as { __nvCond: CondGlobal }).__nvCond.__test.resetNodeCounts()
  })
  const times: number[] = []
  for (let i = 0; i < MEASURED_STEPS; i++) {
    const t0 = Date.now()
    await page.locator(buttonId).click()
    await flush(page)
    times.push(Date.now() - t0)
  }
  const { allocCount, freeCount } = await page.evaluate(() => {
    const g = (window as unknown as { __nvCond: CondGlobal }).__nvCond
    return { allocCount: g.__test.nodeAllocCount, freeCount: g.__test.nodeFreeCount }
  })
  return {
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    maxMs: Math.max(...times),
    allocCount,
    freeCount,
  }
}

test('ADVISORY: conditional branch-swap baseline (logged, never asserted)', async ({ page }) => {
  const r = await measure(page, 'AppConditional', '#toggle')
  console.log(
    `\nADVISORY [conditional toggle] avg=${r.avgMs.toFixed(2)}ms max=${r.maxMs.toFixed(2)}ms alloc=${r.allocCount} free=${r.freeCount} over ${MEASURED_STEPS} toggles`,
  )
  expect(true).toBe(true)
})

test('ADVISORY: switch 5-branch cycle baseline (logged, never asserted)', async ({ page }) => {
  const r = await measure(page, 'AppSwitch', '#cycle')
  console.log(
    `\nADVISORY [switch cycle] avg=${r.avgMs.toFixed(2)}ms max=${r.maxMs.toFixed(2)}ms alloc=${r.allocCount} free=${r.freeCount} over ${MEASURED_STEPS} cycles`,
  )
  expect(true).toBe(true)
})
```

- [ ] **Step 5: Run it**

Run: `pnpm test:browser --project=chromium test/browser/nv-benchmark-conditional.spec.ts`
Expected: 2 tests PASS; console shows `ADVISORY [conditional toggle] ...` and `ADVISORY [switch cycle] ...` lines with numeric avg/max/alloc/free.

- [ ] **Step 6: Commit**

```bash
git add test/browser/fixtures/benchmark-conditional test/browser/nv-benchmark-conditional.spec.ts
git commit -m "test(benchmark): advisory conditional/switch branch-swap baselines"
```

---

## Task 6: Full regression pass, typecheck, lint, and landing report

**Files:** none (verification only)

- [ ] **Step 1: Confirm the churn gate still runs by default (no project filter excludes it)**

Run: `pnpm test:browser --list | grep -c "recycling-node-churn"`
Expected: non-zero count confirming `recycling-node-churn.spec.ts` tests are enumerated under the default `playwright test` invocation (matches `playwright.config.ts`'s `testMatch: '**/*.spec.ts'` with no per-file exclusions, per the exploration in this plan's prep). If this comes back zero, stop — that's a scope-changing finding per the commission, report it rather than proceeding.

- [ ] **Step 2: Run the full unit suite**

Run: `pnpm test`
Expected: all tests pass; record the exact count (compare against the stale `835/835` baseline noted in Global Constraints — an increase is fine, a decrease is not, since this plan adds no unit tests but also removes none).

- [ ] **Step 3: Run the full browser suite across all three browsers**

Run: `pnpm test:browser`
Expected: all tests pass, including the original 3 `8da893a` tests, the new 10-test churn matrix × 3 browsers, the 1 advisory recycle wall-clock test, and the 2 advisory conditional/switch tests. Record the exact new total.

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean (no errors, no warnings introduced by the new files).

- [ ] **Step 5: Confirm no `src/core/` diff**

Run: `git diff main --stat -- src/core/`
Expected: empty output.

- [ ] **Step 6: Push and report**

```bash
git push
git rev-parse HEAD
```

Report to the requester: landing SHA, exact before/after test counts (unit + browser), confirmation of the foil-venue scope correction (Deliverable 2/3 executed as nv-only in-repo advisory/failable logging, not a live Solid/Svelte/Lit/React/Vanilla comparison), confirmation that `8da893a`'s original 3 tests are unmodified and passing, **and the grow/shrink deviation as a named follow-up-commission candidate**: "`<recycle>`'s pool (`wireRecycledList`, `src/renderer/interpreter.ts:777-849`) has no free-list retention across a `windowN` resize — grow/shrink scenarios are tracked advisory-only (logged alloc/free numbers on every `pnpm test:browser` run, `test/browser/recycling-node-churn.spec.ts`'s `ADVISORY A2 matrix` tests) rather than failable. A future commission should read those numbers and decide whether high-water-mark pooling is worth building." Do not write the decision-log delta — that's the requester's step per the commission.

---

## Self-Review Notes

**Spec coverage:**
- Deliverable 1 (churn matrix, 5 scenarios, failable, real-browser, keyed contrast) → Task 1 (fixtures) + Task 2 (shared scenario defs) + Task 3 (spec extension). ✓
- Deliverable 2 (jfb-venue integration, timing logged not asserted) → Task 4, scoped per the premise correction to nv-only in-repo logging (foil comparison is out of scope; flagged explicitly). ✓
- Deliverable 3 (conditional/switch advisory baseline) → Task 5. ✓
- G0 disqualifiers: no `src/core/` diff (Task 6 Step 5 verifies), `8da893a` untouched (Task 1 Step 3, Task 3 Step 1 explicitly only *appends* after existing tests), no failable wall-clock `expect` anywhere (every timing test ends in `expect(true).toBe(true)`), conditional/switch never gated (Task 5's two tests are `ADVISORY`-labeled with the same sentinel), no JSDOM (all specs use Playwright's real-browser `page` fixture). ✓
- G1: same-session warmup/reset/measure discipline mirrored exactly from `8da893a` in Task 3's `runChurnScenario`. Distinct-path discipline: one `app-recycled.nv`/`app-keyed.nv` pair, one `scenarios.ts` helper, one `runChurnScenario`. ✓
- Full-suite regression + tsc/lint → Task 6. ✓

**Placeholder scan:** all code blocks are complete, runnable file contents — no TODOs, no "similar to Task N" elisions (Task 1's app-keyed.nv step spells out the full file rather than referencing app-recycled.nv's step).

**Type consistency:** `ChurnGlobal` (Task 3) matches the existing file's definition exactly (not redefined, reused). `MutationScenario`/`SCENARIOS`/`mutationStep` (Task 2) are imported with identical names/signatures in both Task 3 and Task 4. `CondGlobal` (Task 5) is a new, self-contained type scoped to its own spec file — no cross-file coupling needed since conditional/switch don't share fixtures with recycle.
