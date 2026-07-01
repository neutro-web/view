# `<switch>`/`<match>` Control Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `<switch>`/`<match>` as a first-class multi-branch control-flow construct — one shared `SwitchBinding` IR node, authorable symmetrically from `.nv` (`<switch>`/`<match>` elements) and tagged (`match()` sentinel), interpreted and compiled at parity across all three renderer back-ends (interpreter, `emitted-mount.ts` compiler, `nv-emitter.ts` Mode-A module emitter).

**Architecture:** `SwitchBinding` generalizes `ConditionalBinding`'s proven single-effect/single-disposer pattern (`wireConditional`) from 2 branches to N ordered branches with first-match-wins + explicit fallback. No new disposal mechanism, no new reactive primitive — pure composition over `effect`/`createRoot`/`onCleanup`, same category as `<recycle>`/`conditional`. `.nv` gets a dedicated `<switch>`/`<match>` element (mirrors `<each>`/`<recycle>` recognition tier — NOT the ternary-detection path). Tagged gets a `match()` sentinel (mirrors `iff()`/`recycle()`).

**Tech Stack:** TypeScript, `ts.Node` AST parsing (nv-parser.ts), JSDOM-backed template walking, Vitest.

**Locked ruling:** `docs/decision-log.md` §`[2026-07-01] <switch>/<match> shape ruling: Option A` (lines 5105–5163). Do not re-derive or re-litigate. Read before starting if any ambiguity arises.

## Global Constraints

- Repo anchor: main `1d36e39`, Template-IR **v0.4.4**, contract **v0.4.3**. Verify actual `main` HEAD before starting (`git log -1`) — do not trust this SHA if time has passed.
- **All work happens on a feature branch, never directly on `main`.** Every `git commit` step below is a local commit on that branch. The branch lands via a single PR that is **squash-merged** (Task 11 makes this explicit) — this is what makes the G0 atomic-landing requirement (below) actually hold, since intermediate per-task commits legitimately have `tsc` red or asymmetric FE capability, and only the final squashed state on `main` matters for that gate.
- **G0 disqualifiers** (any one fails the commission outright — full G0/G1 text is reproduced in Task 11, Step 3):
  - No `src/core/` diff, anywhere, for any reason.
  - No effect-per-branch — one effect, one `branchDisposer` variable, looped `when()` reads.
  - `.nv` `<switch>` must NOT be built on, or extend, the ternary-detection path (nv-parser.ts:367, :2748).
  - Tagged `match()` and `.nv` `<switch>` must land in the same commit/PR — no window where `tsc` is red or one FE lacks the capability **on `main`** (intermediate branch commits may be red; the squash-merge is what enforces this for real).
  - `SwitchBinding` must always be reachable only via `createRoot`-scoped branch mounting with proper disposal.
- **`tsc --noEmit` exhaustiveness timeline** (verify this holds at implementation time — do not assume without checking, per "read the seams before you spec"): only `interpreter.ts`'s `wireBinding` switch and `html-tag.ts`'s `assertAllBindingKindsHandled` are confirmed to use a compile-time `never`-exhaustiveness check on `Binding['kind']`; `emitted-mount.ts`'s `emitSetup` switch has a generic runtime `default: throw` (confirm at Task 3 whether it's actually `never`-typed); `nv-emitter.ts`'s `emitBindingLiteral` switch is confirmed to be a runtime `default: throw`, not a type-level check. Given this, `tsc --noEmit` should go green as soon as **Task 2 (interpreter.ts) and Task 4 (html-tag.ts)** are both done — NOT at Task 5 or Task 7. Tasks 5–7 close *runtime* gaps (a `.nv` file or emitted module using `<switch>` would throw at parse/emit time before those tasks land, not fail `tsc`), not type-level ones. If Task 3 finds `emitted-mount.ts` DOES use a `never`-typed check, note the correction and update Task 9/11's expectations rather than silently reconciling it.
- Test-running cadence: each task's own steps run tests scoped to the file(s) it touches (fast iteration). In addition, run the **full suite** (`npm test` — confirm the exact script name from `package.json` first) at the end of Tasks 2, 4, 7, 9, and 11 — the points where a new `Binding` kind lands in a back-end, and thus the points most likely to regress something outside the touched file. Do not skip these full-suite checkpoints even though most individual task steps are scoped.
- Do not desugar to nested `ConditionalBinding`. Do not introduce a coverage-widening flag on `sync`/`pubsub`. If you find yourself needing either, stop and escalate — do not improvise past the gate.

---

## File Map

| File | Change |
|---|---|
| `src/renderer/ir.ts` | Add `SwitchBinding` type, add to `Binding` union |
| `src/renderer/interpreter.ts` | Add `wireSwitch`, add `'switch'` dispatch case |
| `src/compiler/emitted-mount.ts` | Add `'switch'` compiler dispatch case |
| `src/renderer/html-tag.ts` | Add `MatchSentinel`, `match()`, `isMatchSentinel`, `buildSwitchBinding`, wire into `walkNodeList`/`buildSlotContentIR`, add `'switch'` case to `assertAllBindingKindsHandled` |
| `src/renderer/nv-parser.ts` | Add `<switch>`/`<match>` string rewrite, `NvWalkedSwitch` walk detection, `pushSwitchBinding` (parse path), `PendingNvSwitchInfo` + `computeBindingThunks` switch handling + `ThunkSource` `'switch'` kind (emit path) |
| `src/renderer/nv-emitter.ts` | Add `'switch'` case to `emitBindingLiteral` |
| `test/renderer/interpreter.test.ts` | `wireSwitch` correctness + disposal tests (TC-SW series, mirrors TC-06 series) |
| `test/renderer/html-tag.test.ts` | FE-equivalence test for `match()` vs `.nv` `<switch>` |
| `test/renderer/nv-parser.test.ts` | `.nv` `<switch>`/`<match>` parse tests |
| `test/compiler/emitted-mount.test.ts` (or equivalent) | Compiler `'switch'` case test |

---

## Authoring surface (pinned, do not redesign at implementation time)

`.nv`:
```html
<switch>
  <match when=${() => cond1}>
    <p>branch 1</p>
  </match>
  <match when=${() => cond2}>
    <p>branch 2</p>
  </match>
  <match>
    <p>fallback (no when= attribute)</p>
  </match>
</switch>
```
- `<switch>` is the outer element; each direct-child `<match>` element is one ordered branch.
- `<match when=${...}>` — `when=` is a reactive attribute hole (same sentinel mechanism as `<each>`'s `.of=`/`key=`). A `<match>` with no `when=` attribute is the fallback; there may be at most one, and if present it must be the last child (parse-time error otherwise, same footgun-guard style as `<recycle key=>`).
- No `let={}` — branches don't bind loop variables; they're plain nested content.

Tagged:
```ts
match(
  branches: readonly { when: () => boolean; body: () => TemplateIR }[],
  fallback?: (() => TemplateIR) | null,
): MatchSentinel
```
Used as `${match([{ when: () => cond1, body: () => html\`<p>branch 1</p>\` }, ...], () => html\`<p>fallback</p>\`)}`.

---

## Task 1: IR type — `SwitchBinding`

**Files:**
- Modify: `src/renderer/ir.ts`

**Interfaces:**
- Produces: `SwitchBinding` type, used by every subsequent task.

- [ ] **Step 1: Add the `SwitchBinding` type**

Add directly after `ConditionalBinding` (currently lines 151–157 per research) in `src/renderer/ir.ts`:

```typescript
export type SwitchBinding = BaseBinding & {
  kind: 'switch'
  /** Ordered branches — first truthy `when()` wins. */
  branches: readonly { when: ReactiveExpr<boolean>; body: TemplateIR }[]
  fallback: TemplateIR | null
}
```

- [ ] **Step 2: Add `SwitchBinding` to the `Binding` union**

Find the `Binding` union (lines 308–322 per research):

```typescript
export type Binding =
  | TextBinding
  | AttrBinding
  | PropBinding
  | EventBinding
  | ChildBinding
  | ConditionalBinding
  | ListBinding
  | RecycledListBinding
  | SyncBinding
  | ComponentBinding
  | SlotOutletBinding
  | ClassListBinding
  | StyleVarBinding
```

Change to:

```typescript
export type Binding =
  | TextBinding
  | AttrBinding
  | PropBinding
  | EventBinding
  | ChildBinding
  | ConditionalBinding
  | ListBinding
  | RecycledListBinding
  | SwitchBinding
  | SyncBinding
  | ComponentBinding
  | SlotOutletBinding
  | ClassListBinding
  | StyleVarBinding
```

- [ ] **Step 3: Run `tsc --noEmit` and confirm the exhaustiveness gate goes red**

Run: `npx tsc --noEmit`

Expected: FAIL, with errors at minimum in:
- `src/renderer/interpreter.ts` (`wireBinding`'s `switch` — the `default: { const _exhaustive: never = binding ...}` line no longer typechecks)
- `src/renderer/html-tag.ts` (`assertAllBindingKindsHandled`'s `default: { const exhaustive: never = kind ...}`)
- `src/compiler/emitted-mount.ts` (if it uses a similarly typed exhaustiveness check — confirm during Task 3)

This is expected and correct — it's the gate doing its job (per commission spec). Do not silence it; each subsequent task fixes one red site.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/ir.ts
git commit -m "feat(ir): add SwitchBinding to Binding union"
```

(This commit intentionally leaves `tsc` red across the repo. Do not open a PR at this point — see Global Constraints. Subsequent tasks fix it task-by-task; the full plan lands as one PR per Definition of Done.)

---

## Task 2: Interpreter — `wireSwitch`

**Files:**
- Modify: `src/renderer/interpreter.ts`
- Test: `test/renderer/interpreter.test.ts`

**Interfaces:**
- Consumes: `SwitchBinding` (Task 1), `effect`/`createRoot`/`onCleanup`/`getOwner` (already imported in interpreter.ts per research).
- Produces: `wireSwitch(binding: SwitchBinding, anchorNode: Node, doc: Document): void`, dispatched from `wireBinding`'s `case 'switch'`.

- [ ] **Step 1: Write the failing correctness test**

Add to `test/renderer/interpreter.test.ts`, near the existing `ConditionalBinding` TC-06 series (mirror their `makeConditionalIR` helper pattern — add a `makeSwitchIR` helper in the same file):

```typescript
function makeSwitchIR(
  branches: Array<{ when: () => boolean; body: TemplateIR }>,
  fallback: TemplateIR | null,
): TemplateIR {
  return {
    id: 'test-switch',
    shape: { html: '<div><!--anchor--></div>', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'switch',
        pathIndex: 0,
        branches,
        fallback,
      } as SwitchBinding,
    ],
  }
}

function staticBranchIR(html: string): TemplateIR {
  return { id: `test-branch-${html}`, shape: { html, bindingPaths: [] }, bindings: [] }
}

test('TC-SW01  first-match-wins: branch 1 and branch 2 both true, only branch 1 renders', () => {
  const ir = makeSwitchIR(
    [
      { when: () => true, body: staticBranchIR('<span class="one">1</span>') },
      { when: () => true, body: staticBranchIR('<span class="two">2</span>') },
    ],
    null,
  )
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element
  expect(div.querySelector('.one') !== null, 'branch 1 rendered').toBe(true)
  expect(div.querySelector('.two') === null, 'branch 2 did not render').toBe(true)

  dispose()
  rmParent(parent)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/renderer/interpreter.test.ts -t "TC-SW01"`
Expected: FAIL — `wireBinding` throws `Unknown binding kind: switch` (the `default` exhaustiveness branch at interpreter.ts:178 per research).

- [ ] **Step 3: Implement `wireSwitch`**

Add directly after `wireConditional` (lines 848–888 per research) in `src/renderer/interpreter.ts`:

```typescript
function wireSwitch(binding: SwitchBinding, anchorNode: Node, doc: Document): void {
  // Anchor is a Comment node; branches mount before it. Direct generalization of
  // wireConditional: same single-effect/single-disposer pattern, N ordered branches
  // instead of 2, first-match-wins instead of boolean toggle.
  const parent = anchorNode.parentNode
  if (parent === null) {
    throw new Error('[nv/interpreter] SwitchBinding: anchor has no parent')
  }

  let branchDisposer: (() => void) | null = null

  effect(() => {
    if (branchDisposer !== null) {
      branchDisposer()
      branchDisposer = null
    }

    let template: TemplateIR | null = null
    for (const branch of binding.branches) {
      if (branch.when()) {
        template = branch.body
        break
      }
    }
    if (template === null) template = binding.fallback

    if (template === null) return

    branchDisposer = createRoot((dispose) => {
      const { roots } = mountFragment(template as TemplateIR, parent, doc, anchorNode)
      onCleanup(() => {
        for (const n of roots) {
          if (n.parentNode !== null) n.parentNode.removeChild(n)
        }
      })
      return dispose
    })

    onCleanup(() => {
      if (branchDisposer !== null) {
        branchDisposer()
        branchDisposer = null
      }
    })
  })
}
```

Note: the effect reads every `branch.when()` up to and including the first truthy one, in order, each run — this is the "single effect reads all `when()` conditions... short-circuiting on the first true" semantics from the ruling. Branches after the match are NOT read that run (short-circuit via the `for`/`break`), matching first-match-wins tracking semantics (later branches' conditions don't need to be dependencies until an earlier one goes false).

- [ ] **Step 4: Wire the dispatch case**

In `wireBinding`'s switch (lines 114–182 per research), add directly after the `case 'conditional':` block:

```typescript
    case 'switch': {
      wireSwitch(binding, targetNode, doc)
      break
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/renderer/interpreter.test.ts -t "TC-SW01"`
Expected: PASS

- [ ] **Step 6: Write and pass the fallback test**

Add:

```typescript
test('TC-SW02  fallback renders when no branch matches; null-safe when fallback absent', () => {
  const irWithFallback = makeSwitchIR(
    [{ when: () => false, body: staticBranchIR('<span class="a">a</span>') }],
    staticBranchIR('<span class="fb">fb</span>'),
  )
  const parent1 = mkParent()
  const dispose1 = mount(irWithFallback, parent1, document)
  flushSync()
  expect(parent1.querySelector('.fb') !== null, 'fallback rendered').toBe(true)
  dispose1()
  rmParent(parent1)

  const irNoFallback = makeSwitchIR(
    [{ when: () => false, body: staticBranchIR('<span class="a">a</span>') }],
    null,
  )
  const parent2 = mkParent()
  const dispose2 = mount(irNoFallback, parent2, document)
  flushSync()
  const div2 = parent2.querySelector('div') as Element
  // Only the anchor comment remains — no branch content, no error.
  expect(div2.childNodes.length, 'no accumulated DOM with absent fallback').toBe(1)
  dispose2()
  rmParent(parent2)
})
```

Run: `npx vitest run test/renderer/interpreter.test.ts -t "TC-SW02"`
Expected: PASS

- [ ] **Step 7: Write and pass the N-branch-swap disposal test (mirrors TC-06e)**

```typescript
test('TC-SW03  swap across all branches + fallback repeatedly: no accumulated DOM', () => {
  const active = signal(0) // 0, 1, 2 → branches; 3 → no match (fallback)
  const ir = makeSwitchIR(
    [
      { when: () => active() === 0, body: staticBranchIR('<span class="b0">0</span>') },
      { when: () => active() === 1, body: staticBranchIR('<span class="b1">1</span>') },
      { when: () => active() === 2, body: staticBranchIR('<span class="b2">2</span>') },
    ],
    staticBranchIR('<span class="fb">fb</span>'),
  )
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element
  const N = 20
  for (let i = 0; i < N; i++) {
    active.set(i % 4)
    flushSync()
    expect(
      div.childNodes.length,
      `swap ${i}: expected 2 childNodes (branch + anchor), got ${div.childNodes.length}`,
    ).toBe(2)
    // Owner-tree assertion, not just DOM count — the G1 gate explicitly requires this
    // ("asserts owner-tree child count returns to baseline after each swap") because a
    // leaked effect/signal from a disposed branch can have zero DOM footprint. Read how
    // TC-06e (the ConditionalBinding equivalent, test/renderer/interpreter.test.ts
    // lines 958-988 per research) asserts this — if TC-06e does NOT already have an
    // owner-tree assertion, add one to TC-06e too in this same step (both must hold the
    // same bar). Use whatever owner-introspection the codebase's test harness already
    // exposes (search for `getOwner`, `.children.length`, or similar in
    // test/renderer/interpreter.test.ts before inventing a new introspection point).
  }

  dispose()
  rmParent(parent)
})
```

Run: `npx vitest run test/renderer/interpreter.test.ts -t "TC-SW03"`
Expected: PASS

- [ ] **Step 8: Confirm (or add) a `wireConditional` parent-teardown test, then write and pass the `wireSwitch` parent-teardown bridge test (mirrors TC-06h)**

The commission requires: "mirror the existing `wireConditional` parent-teardown test if one exists; if not, write one for both `wireConditional` and `wireSwitch` for parity." Before writing TC-SW04, grep `test/renderer/interpreter.test.ts` for an existing `ConditionalBinding` parent-region-teardown test (TC-06h per the research pass, lines ~1055–1080). If it exists, proceed straight to TC-SW04 below. If it does NOT exist, write it first (same shape as TC-SW04 below but wrapping a plain `ConditionalBinding` instead of a `SwitchBinding`), confirm it passes against the existing `wireConditional`, then write TC-SW04.

```typescript
test('TC-SW04  parent region dispose while a branch is mounted: full cleanup', () => {
  const active = signal(0)
  const switchIR = makeSwitchIR(
    [{ when: () => active() === 0, body: staticBranchIR('<span class="b0">0</span>') }],
    null,
  )
  // Mount switchIR nested inside a ConditionalBinding's consequent so disposing the
  // OUTER conditional tears down the inner switch's active branch via the onCleanup bridge.
  const outerCond = signal(true)
  const wrapperIR: TemplateIR = {
    id: 'wrapper',
    shape: { html: '<div><!--outer--></div>', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'conditional',
        pathIndex: 0,
        condition: () => outerCond(),
        consequent: switchIR,
        alternate: null,
      } as ConditionalBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(wrapperIR, parent, document)
  flushSync()
  expect(parent.querySelector('.b0') !== null, 'inner switch branch mounted').toBe(true)

  outerCond.set(false)
  flushSync()
  expect(parent.querySelector('.b0') === null, 'inner switch branch torn down with parent').toBe(
    true,
  )

  dispose()
  rmParent(parent)
})
```

Run: `npx vitest run test/renderer/interpreter.test.ts -t "TC-SW04"`
Expected: PASS

- [ ] **Step 9: Run full interpreter test suite — confirm no regressions**

Run: `npx vitest run test/renderer/interpreter.test.ts`
Expected: PASS, all tests including the pre-existing `ConditionalBinding` TC-06 series.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/interpreter.ts test/renderer/interpreter.test.ts
git commit -m "feat(interpreter): add wireSwitch for SwitchBinding"
```

---

## Task 3: Compiler — `emitted-mount.ts` `'switch'` case

**Files:**
- Modify: `src/compiler/emitted-mount.ts`
- Test: wherever `emitted-mount.ts`'s existing `'conditional'` case is tested (locate via `grep -rn "case 'conditional'" test/` before writing — likely `test/compiler/emitted-mount.test.ts`; if no dedicated file exists, add tests to the file that already exercises `emitSetup`/`wireSpecs` for `ConditionalBinding`)

**Interfaces:**
- Consumes: `SwitchBinding` (Task 1), `emitSetup` (existing recursive per-branch emit function used by the `'conditional'` case).
- Produces: `'switch'` case in the `emitSetup` binding-kind switch (lines 179–742 per research).

- [ ] **Step 1: Locate the exact test file for the `'conditional'` case**

Run: `grep -rln "ConditionalBinding\|emitted-mount" test/` and identify the file exercising `emitSetup`'s conditional branch (branch-swap + disposal). Read it fully before writing new tests — match its harness (how it constructs a `SwitchBinding`-equivalent binding, how it invokes `wire`, how it asserts DOM state) exactly; do not invent a new harness.

- [ ] **Step 2: Write the failing test**

Following the located harness's pattern (pseudocode below — replace with the actual harness's helper names once Step 1 is done):

```typescript
test('emitSetup: switch binding first-match-wins + branch swap disposal', () => {
  // Construct a SwitchBinding with 2 branches + fallback, using the same
  // TemplateIR-construction helpers the existing 'conditional' test uses.
  // Assert: (a) first-match-wins on initial mount, (b) branch swap disposes
  // outgoing branch DOM (childNodes count returns to baseline), (c) fallback
  // renders when toggled to no-match state.
})
```

- [ ] **Step 3: Run test to verify it fails**

Run the harness's test command scoped to the new test.
Expected: FAIL — `emitSetup`'s `default` case throws `Binding kind 'switch' is not implemented.` (line ~740 per research).

- [ ] **Step 4: Implement the `'switch'` case**

Add directly after the existing `case 'conditional':` block (lines 328–400 per research) in `src/compiler/emitted-mount.ts`:

```typescript
      case 'switch': {
        // Recursively emit each branch's setup at emit time, same pattern as 'conditional'.
        // Independent empty verdicts map per branch — branch bindings have their own
        // pathIndices and would receive wrong verdicts if the outer map were passed through.
        const branchSetups: Array<{ when: ReactiveExpr<boolean>; setup: ReturnType<typeof emitSetup>['setup'] }> = []
        for (const branch of binding.branches) {
          const emptyVerdicts = new Map<number, BindingErasureVerdict>()
          const { setup, diagnostics: bDiags } = emitSetup(branch.body, emptyVerdicts)
          for (const d of bDiags) diagnostics.push(d)
          branchSetups.push({ when: branch.when, setup })
        }

        const emptyFallbackVerdicts = new Map<number, BindingErasureVerdict>()
        const { setup: fallbackSetup, diagnostics: fDiags } = binding.fallback
          ? emitSetup(binding.fallback, emptyFallbackVerdicts)
          : { setup: null, diagnostics: [] as string[] }
        for (const d of fDiags) diagnostics.push(d)

        wireSpecs.push({
          accessor,
          // NOTE: confirm the real parameter name at implementation time — the existing
          // 'conditional' case's wire() callback names its third param `before`, not
          // `anchorNode`; match whatever the actual file uses (cosmetic, but keep it
          // consistent with the surrounding case blocks rather than inventing a new name).
          wire(anchorNode, doc) {
            // Interpreter semantics (ground truth, wireSwitch): single effect reads all
            // branch.when() in order, first truthy wins; one branchDisposer; same
            // createRoot-per-branch + onCleanup bridge as 'conditional'.
            const parent = anchorNode.parentNode
            if (parent === null) {
              throw new Error('[nv/emit] SwitchBinding: anchor has no parent')
            }

            let branchDisposer: (() => void) | null = null

            effect(() => {
              if (branchDisposer !== null) {
                branchDisposer()
                branchDisposer = null
              }

              let matched: ReturnType<typeof emitSetup>['setup'] | null = null
              for (const b of branchSetups) {
                if (b.when()) {
                  matched = b.setup
                  break
                }
              }
              const activeSetup = matched ?? fallbackSetup
              if (activeSetup === null) return

              branchDisposer = createRoot((dispose) => {
                const { roots } = activeSetup(parent, doc, anchorNode)
                onCleanup(() => {
                  for (const n of roots) {
                    if (n.parentNode !== null) n.parentNode.removeChild(n)
                  }
                })
                return dispose
              })

              onCleanup(() => {
                if (branchDisposer !== null) {
                  branchDisposer()
                  branchDisposer = null
                }
              })
            })
          },
        })
        break
      }
```

Adjust the exact `ReturnType<typeof emitSetup>['setup']` typing to whatever `emitSetup`'s actual return type is named in the file (read it precisely at Step 1/implementation time — the research summary shows it returns `{ setup, diagnostics }` where `setup` is a function of `(parent, doc, anchorNode) => { roots }`; use the file's real type alias if one exists rather than a `ReturnType` extraction, for readability).

- [ ] **Step 5: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 6: Run full compiler test suite**

Run: `npx vitest run test/compiler/`
Expected: PASS, no regressions (including the pre-existing `'conditional'` and `'recycled-list'`-not-implemented tests).

- [ ] **Step 7: Commit**

```bash
git add src/compiler/emitted-mount.ts test/compiler/
git commit -m "feat(compiler): add switch binding case to emitted-mount"
```

---

## Task 4: Tagged FE — `match()` sentinel + wiring

**Files:**
- Modify: `src/renderer/html-tag.ts`
- Test: `test/renderer/html-tag.test.ts`

**Interfaces:**
- Consumes: `SwitchBinding` (Task 1).
- Produces: `MatchSentinel`, `match()`, `isMatchSentinel()`, `buildSwitchBinding()` — consumed by Task 6's FE-equivalence test and by any downstream `.nv`-parity code.

- [ ] **Step 1: Add `MatchSentinel` type + `match()` builder**

Add directly after `RecycledSentinel`/`recycle()` (lines 280–302 per research) in `src/renderer/html-tag.ts`:

```typescript
/** Opaque sentinel returned by `match(branches, fallback)` — the tagged-template switch form. */
export interface MatchSentinel {
  readonly __nvMatch: true
  readonly branches: readonly { when: () => boolean; body: () => TemplateIR }[]
  readonly fallback: (() => TemplateIR) | null
}

function isMatchSentinel(v: unknown): v is MatchSentinel {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as Record<string, unknown>).__nvMatch === true &&
    Array.isArray((v as MatchSentinel).branches) &&
    (v as MatchSentinel).branches.every(
      (b) => typeof b.when === 'function' && typeof b.body === 'function',
    ) &&
    ((v as MatchSentinel).fallback === null || typeof (v as MatchSentinel).fallback === 'function')
  )
}

/**
 * Create a switch (multi-branch) sentinel for the tagged-template side.
 * Write `${match([{ when: () => a, body: () => html\`<p>A</p>\` }, ...], () => html\`<p>fb</p>\`)}`
 * for reactive N-branch first-match-wins control flow. Both `when` and `body` MUST be
 * thunks — a raw value is evaluated before `html()` ever sees it and can't be detected
 * as reactive, same reason `iff()`'s branches are thunks. Mirrors `.nv`'s `<switch>`/
 * `<match>` element form; both produce `SwitchBinding`.
 */
export function match(
  branches: readonly { when: () => boolean; body: () => TemplateIR }[],
  fallback?: (() => TemplateIR) | null,
): MatchSentinel {
  return { __nvMatch: true, branches, fallback: fallback ?? null }
}
```

- [ ] **Step 2: Add `buildSwitchBinding`**

Add directly after `buildConditionalBinding` (lines 986–1005 per research):

```typescript
function buildSwitchBinding(pathIndex: number, sentinel: MatchSentinel): SwitchBinding {
  const { branches, fallback } = sentinel
  const binding = {
    kind: 'switch',
    pathIndex,
    // Resolve thunks HERE, eagerly — same convention buildConditionalBinding uses for
    // ConditionalBinding.consequent/alternate. SwitchBinding.branches[].body and
    // .fallback in ir.ts (Task 1) are already-resolved TemplateIR, not thunks; the
    // thunk layer exists only at the MatchSentinel/ConditionalSentinel level and is
    // resolved exactly once, right here, when the binding is built. Do not carry
    // thunks through into SwitchBinding itself — that would diverge from how every
    // other structural binding kind (conditional, list, recycled-list) already works.
    branches: branches.map((b) => ({ when: b.when, body: b.body() })),
    fallback: fallback !== null ? fallback() : null,
  } satisfies SwitchBinding
  assertAllBindingKindsHandled(binding.kind)
  return binding
}
```

- [ ] **Step 3: Wire detection into `walkNodeList`**

In the `walkNodeList` sentinel-detection chain (lines 697–720 per research), add an `else if` branch for the switch sentinel, following the existing `lists`/`conditionals`/`recycledLists` array pattern. First add a `switches` accumulator array alongside the existing `lists`/`conditionals`/`recycledLists` arrays (wherever those are declared in the enclosing function — locate via `grep -n "const conditionals" src/renderer/html-tag.ts` before editing), then:

```typescript
  } else if (isMatchSentinel(exprs[idx])) {
    // Switch sentinel: the comment IS the switch anchor — record path, skip text-hole.
    switches.push({
      anchorPath: computePath(node, root),
      origIdx: idx,
      sentinel: exprs[idx] as MatchSentinel,
    })
    consumed.add(idx)
  }
```
inserted as an additional `else if` arm before the final `else { holeInfos.push(...) }` fallback, in the same position/priority as the existing `isRecycledSentinel` check (order among sibling sentinel types doesn't matter — they're mutually exclusive on `__nv*` discriminants — but keep it grouped with its siblings for readability).

Then wire `switches` through to wherever `conditionals`/`lists`/`recycledLists` get converted into bindings after the walk (this is the site that calls `buildConditionalBinding`/`buildRecycledListBinding` — locate via `grep -n "buildConditionalBinding\|buildRecycledListBinding" src/renderer/html-tag.ts`), adding the parallel call:

```typescript
  for (const { anchorPath, sentinel } of switches) {
    const pathIndex = allPaths.length
    allPaths.push(anchorPath)
    bindings.push(buildSwitchBinding(pathIndex, sentinel))
  }
```

Match the existing loop's exact surrounding code (variable names, whether it destructures `origIdx` too) rather than inventing new shape — read the real conditional/recycled-list loop bodies at implementation time. There are TWO call sites to update, both required (the commission explicitly names both: "Wire detection into `html()`/`buildSlotContentIR`"):
1. `buildSlotContentIR` (nv-parser.ts naming aside — the `html-tag.ts` version, in the ~885–1000 region per research).
2. The top-level `html()` function's own conversion loop, which is a SEPARATE call site around lines ~1245–1263 (per live-repo verification — do not assume the `buildSlotContentIR` fix alone covers top-level `html()` usage; both must independently call `buildSwitchBinding` for `match()` to work at both the top level and inside slot content).

- [ ] **Step 4: Add the `case 'list'`/`'conditional'`/`'recycled-list'` sibling guard update**

In the exclusion-list check near line 1171–1173 per research (`!isEachSentinel(exprs[i]) && !isConditionalSentinel(exprs[i]) && !isRecycledSentinel(exprs[i])`), add `&& !isMatchSentinel(exprs[i])` so a `match()` sentinel isn't misclassified as a plain text hole in whatever downstream check this guards (read the surrounding function to confirm purpose before editing — likely a "this hole was already consumed structurally" assertion).

- [ ] **Step 5: Add the `'switch'` case to `assertAllBindingKindsHandled`**

In `src/renderer/html-tag.ts` (lines 371–398 per research), add `case 'switch':` to the grouped case list with `'list'`/`'conditional'`/`'recycled-list'`:

```typescript
    case 'list': // each() sentinel — walkNodeList detection, wired in html()/buildSlotContentIR
    case 'conditional': // iff() sentinel — walkNodeList detection, wired in html()/buildSlotContentIR
    case 'recycled-list': // recycle() sentinel — buildRecycledListBinding, wired in html()/buildSlotContentIR
    case 'switch': // match() sentinel — walkNodeList detection, wired in html()/buildSlotContentIR
    case 'component': // data-nv-component element — makeUnresolvedComponentBinding
      break
```

- [ ] **Step 6: Write the failing test**

Add to `test/renderer/html-tag.test.ts`:

```typescript
it('match(): first-match-wins with fallback produces a SwitchBinding', () => {
  const { doc, html } = setup()
  const state = signal(0)
  const ir = html`<div>${match(
    [
      { when: () => state() === 0, body: () => html`<span class="zero">0</span>` },
      { when: () => state() === 1, body: () => html`<span class="one">1</span>` },
    ],
    () => html`<span class="fb">fb</span>`,
  )}</div>`

  const binding = ir.bindings[0]
  expect(binding?.kind).toBe('switch')
})
```

- [ ] **Step 7: Run test, expect fail then implement, then pass**

Run: `npx vitest run test/renderer/html-tag.test.ts -t "match()"`
Expected first: FAIL (compile error or `match` not exported / sentinel not detected).
After Steps 1–5 above are implemented: PASS.

- [ ] **Step 8: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: `html-tag.ts`'s exhaustiveness error from Task 1 Step 3 is now gone. Remaining red sites (if any) belong to `.nv`-path files not yet touched — confirm via the error list that only `nv-parser.ts`/`nv-emitter.ts` remain, if anything.

- [ ] **Step 9: Run full html-tag test suite**

Run: `npx vitest run test/renderer/html-tag.test.ts`
Expected: PASS, no regressions.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/html-tag.ts test/renderer/html-tag.test.ts
git commit -m "feat(tagged): add match() sentinel producing SwitchBinding"
```

---

## Task 5: `.nv` parse path — `<switch>`/`<match>` element recognition

> **Gate-P checkpoint — do not skip.** The commission requires the concrete element/
> attribute surface to be "approved at Gate-P before touching `src/`." The "Authoring
> surface (pinned...)" section near the top of this plan IS that pinned surface. If this
> plan has not yet been explicitly approved by the commissioner before starting this
> task, STOP and get that approval now — this is the first task that writes `.nv`-side
> `src/` code implementing that surface. Tasks 1–4 (IR type, interpreter, compiler,
> tagged FE) do not depend on the `.nv` authoring surface and were safe to build first;
> this task is the actual gate.

**Files:**
- Modify: `src/renderer/nv-parser.ts`
- Test: `test/renderer/nv-parser.test.ts`

**Interfaces:**
- Consumes: `SwitchBinding` (Task 1), `buildNvSlotContentIR` (existing, used identically by `<each>`/`<recycle>` body processing).
- Produces: `.nv` `<switch>`/`<match>` parseable into `SwitchBinding` via `parseNvFile` (structural/parse-path only — reactive item factories deferred to Task 6's emit path).

This task mirrors the `<recycle>` element-detection pattern (nv-parser.ts:655–733 per research) as closely as possible; `<switch>` has no `.of=`/`key=`/`let=` — instead it has N `<match>` children, each with an optional `when=` attribute hole.

- [ ] **Step 1: Add the string-rewrite step**

In `buildNvHtmlStrings`'s caller (the `sentinelHtml` rewrite block, nv-parser.ts:1279–1288 per research), add rewrites for `<switch>` and `<match>` alongside the existing `<each>`/`<recycle>` rewrites:

```typescript
  const sentinelHtml = rawSentinelHtml
    .replace(/<each(\s[^>]*)?>/g, (_, attrs) => `<template data-nv-each${attrs ?? ''}>`)
    .replace(/<\/each>/g, '</template>')
    .replace(/<recycle(\s[^>]*)?>/g, (_, attrs) => `<template data-nv-recycle${attrs ?? ''}>`)
    .replace(/<\/recycle>/g, '</template>')
    .replace(/<switch(\s[^>]*)?>/g, (_, attrs) => `<template data-nv-switch${attrs ?? ''}>`)
    .replace(/<\/switch>/g, '</template>')
    .replace(/<match(\s[^>]*)?>/g, (_, attrs) => `<template data-nv-match${attrs ?? ''}>`)
    .replace(/<\/match>/g, '</template>')
```

`<template>` nesting (a `<template data-nv-switch>` containing `<template data-nv-match>` children) is valid HTML — `<template>` content is an isolated document fragment, so nested `<template>` elements parse and survive exactly like nested real elements would. Confirm this holds during Step 6's test run; if JSDOM's `<template>` handling flattens or reorders nested templates unexpectedly, that's new information — stop and escalate per the "halt at an undecided design gate" rule (this would mean the pinned authoring form needs a different DOM encoding, which is a shape question, not an implementation detail).

- [ ] **Step 2: Add the `NvWalkedSwitch` interface**

Add alongside `NvWalkedEach`/`NvWalkedRecycle` (nv-parser.ts:507–523 per research):

```typescript
interface NvWalkedMatchBranch {
  /** Hole index for the `when=` attribute, or -1 for the fallback (no `when=`). */
  whenHoleIdx: number
  bodyIR: TemplateIR
  bodyHoleIndices: number[]
}

interface NvWalkedSwitch {
  anchorPath: NodePath
  branches: NvWalkedMatchBranch[]
  /** True if the last branch has no `when=` (is the fallback). */
  hasFallback: boolean
}
```

- [ ] **Step 3: Add `switches` to `NvWalkResult` and the walk function's local state**

In `NvWalkResult` (nv-parser.ts:525–532 per research), add `switches: NvWalkedSwitch[]`. In `walkNvNodeList`'s local declarations (nv-parser.ts:549–554 per research), add `const switches: NvWalkedSwitch[] = []`. Update the function's final `return` (nv-parser.ts:892 per research) to include `switches`.

- [ ] **Step 4: Add `<switch>` element detection to the walk**

Add directly after the `<recycle>` detection block (nv-parser.ts:655–733 per research), before component detection:

```typescript
      // <switch> element detection — after <recycle> block, before component detection.
      if (el.tagName.toLowerCase() === 'template' && el.hasAttribute('data-nv-switch')) {
        const switchEl = el as HTMLTemplateElement
        const matchChildren = Array.from(switchEl.content.children).filter(
          (c) => c.tagName.toLowerCase() === 'template' && c.hasAttribute('data-nv-match'),
        ) as HTMLTemplateElement[]

        if (matchChildren.length === 0) {
          throw new Error('[nv] <switch> requires at least one <match> child')
        }

        const branches: NvWalkedMatchBranch[] = []
        let hasFallback = false

        matchChildren.forEach((matchEl, branchIdx) => {
          // Find when= hole index from data sentinel (attr sentinel — same mechanism as <each key=>).
          let whenHoleIdx = -1
          for (let k = 0; k < holeExprs.length; k++) {
            if (matchEl.getAttribute(`data-nv-attr-${k}`) === 'when') {
              whenHoleIdx = k
              matchEl.removeAttribute(`data-nv-attr-${k}`)
              consumed.add(k)
            }
          }

          const isFallback = whenHoleIdx === -1
          if (isFallback) {
            if (hasFallback) {
              throw new Error('[nv] <switch> may have at most one fallback <match> (no when=)')
            }
            if (branchIdx !== matchChildren.length - 1) {
              throw new Error(
                '[nv] <switch> fallback <match> (no when=) must be the last child',
              )
            }
            hasFallback = true
          }

          const bodyNodes = Array.from(matchEl.content.childNodes)
          const { ir: bodyIR, holeIndices: bodyHoleIndices } = buildNvSlotContentIR(
            bodyNodes,
            holeExprs,
            doc,
            `switch:branch:${switches.length}:${branchIdx}`,
            signals,
          )
          for (const idx of bodyHoleIndices) consumed.add(idx)

          branches.push({ whenHoleIdx, bodyIR, bodyHoleIndices })
        })

        const switchIndex = switches.length
        const anchor = doc.createComment(`nv-switch-${switchIndex}`)
        if (switchEl.parentNode === null) {
          throw new Error('[nv] <switch> element has no parent — cannot compute binding path')
        }
        switchEl.parentNode.replaceChild(anchor, switchEl)
        const anchorPath = computePath(anchor, root)

        switches.push({ anchorPath, branches, hasFallback })
        return // don't recurse into <switch> body (already processed via .content)
      }

      // Footgun guard: a stray <match> NOT consumed as a direct child of a <switch>
      // (e.g. <match> used bare, or nested more than one level inside <switch>) reaches
      // this point because <switch>'s own handling above only inspects its immediate
      // .content.children and returns without recursing further. Without this guard, an
      // unconsumed <template data-nv-match> would silently walk as an ordinary (empty,
      // invisible) <template> element — same class of silent-footgun the <recycle key=>
      // guard prevents elsewhere in this file. Fail loudly instead.
      if (el.tagName.toLowerCase() === 'template' && el.hasAttribute('data-nv-match')) {
        throw new Error('[nv] <match> is only valid as a direct child of <switch>')
      }
```

- [ ] **Step 4b: Write and pass the stray-`<match>` footgun test**

```typescript
it('bare <match> outside <switch> throws a parse-time error', () => {
  const doc = /* same harness as other nv-parser tests in this task */
  const source =
    'const C = $component(() => {\n' +
    '  $script(() => {})\n' +
    '  $render(() => html`<div><match><span>orphan</span></match></div>`)\n' +
    '})\n'
  expect(() => parseNvFile(source, 'match-bare.nv', doc)).toThrow(/only valid as a direct child of <switch>/)
})
```

Run and confirm PASS. This closes the gap flagged during Gate-P review: `<match>` must be rejected outside `<switch>`, not silently rendered as empty content.

- [ ] **Step 5: Add `pushSwitchBinding` helper**

Add alongside `pushListBinding`/`pushRecycledListBinding` (nv-parser.ts:931–987 per research):

```typescript
function pushSwitchBinding(ws: NvWalkedSwitch, allPaths: NodePath[], bindings: Binding[]): void {
  const pathIndex = allPaths.length
  allPaths.push(ws.anchorPath)
  const stubExpr = (() => false) as ReactiveExpr<boolean>
  const branchCount = ws.hasFallback ? ws.branches.length - 1 : ws.branches.length
  bindings.push({
    kind: 'switch',
    pathIndex,
    // PARSE-PATH ONLY: structural IR shape for FE-equivalence checking (mirrors
    // pushRecycledListBinding's stub-expr convention — real reactive `when` thunks
    // come from parseNvFileForEmit, not this structural-only path).
    branches: ws.branches.slice(0, branchCount).map((b) => ({ when: stubExpr, body: b.bodyIR })),
    fallback: ws.hasFallback ? (ws.branches[ws.branches.length - 1] as NvWalkedMatchBranch).bodyIR : null,
  } satisfies SwitchBinding)
}
```

- [ ] **Step 6: Wire `switches` through to the top-level binding-build site**

At the top-level template-build site (nv-parser.ts:1300–1365 per research, where `pendingLists`/`pendingRecycleLists` are destructured from `walkNvNodeList`'s result and converted via `pushListBinding`/`pushRecycledListBinding`), add the parallel destructure and loop:

```typescript
  const {
    holeInfos,
    holePaths,
    components: pendingComponents,
    consumed: consumedByComponent,
    lists: pendingLists,
    recycledLists: pendingRecycleLists,
    switches: pendingSwitches,
  } = walkNvNodeList(Array.from(frag.childNodes), holeExprs, doc, frag, signals, processdiagnostics)
```

and, alongside the existing `pushRecycledListBinding` loop:

```typescript
  // Add switch bindings from <switch> elements.
  for (const ws of pendingSwitches) {
    pushSwitchBinding(ws, allPaths, bindings)
  }
```

Also thread `pendingSwitches` through `buildNvSlotContentIR` (the slot-content sibling of this top-level path — locate via `grep -n "recycledLists: slotRecycledLists" src/renderer/nv-parser.ts`, nv-parser.ts:1032 per research) with the same `switches: slotSwitches` pattern, so `<switch>` works inside component slot bodies exactly as `<recycle>` does (D-SS-2 parity).

- [ ] **Step 7: Write the failing test**

Add to `test/renderer/nv-parser.test.ts`:

```typescript
it('parses <switch>/<match> into a SwitchBinding with 2 branches + fallback', () => {
  const doc = /* however this file's existing tests construct a Document — mirror the nearest <recycle> test's setup exactly */
  const source =
    'const C = $component(() => {\n' +
    '  $script(() => { const state = signal(0) })\n' +
    '  $render(() => html`<div><switch>' +
    '<match when=${state === 0}><span class="zero">0</span></match>' +
    '<match when=${state === 1}><span class="one">1</span></match>' +
    '<match><span class="fb">fb</span></match>' +
    '</switch></div>`)\n' +
    '})\n'
  const results = parseNvFile(source, 'switch.nv', doc)
  const ir = results[0]!.ir
  const binding = ir.bindings[0]
  expect(binding?.kind).toBe('switch')
  const sb = binding as SwitchBinding
  expect(sb.branches.length).toBe(2)
  expect(sb.fallback).not.toBeNull()
})
```

(Match the actual `Document` construction and `$render`/`html` call conventions used by the nearest existing `<recycle>` parse test in this file — read it first, do not guess the harness shape.)

- [ ] **Step 8: Run test, expect fail, then implement Steps 1–6, then pass**

Run: `npx vitest run test/renderer/nv-parser.test.ts -t "switch"`
Expected sequence: FAIL (no `<switch>` handling) → implement → PASS.

- [ ] **Step 9: Write and pass the footgun-guard tests**

```typescript
it('<switch> with fallback not last throws a parse-time error', () => {
  const doc = /* same harness */
  const source =
    'const C = $component(() => {\n' +
    '  $script(() => { const state = signal(0) })\n' +
    '  $render(() => html`<div><switch>' +
    '<match><span class="fb">fb</span></match>' +
    '<match when=${state === 0}><span class="zero">0</span></match>' +
    '</switch></div>`)\n' +
    '})\n'
  expect(() => parseNvFile(source, 'switch-bad.nv', doc)).toThrow(/fallback.*last/)
})

it('<switch> with two fallback <match> (no when=) throws a parse-time error', () => {
  const doc = /* same harness */
  const source =
    'const C = $component(() => {\n' +
    '  $script(() => {})\n' +
    '  $render(() => html`<div><switch>' +
    '<match><span class="a">a</span></match>' +
    '<match><span class="b">b</span></match>' +
    '</switch></div>`)\n' +
    '})\n'
  expect(() => parseNvFile(source, 'switch-bad2.nv', doc)).toThrow(/at most one fallback/)
})
```

Run and confirm both PASS.

- [ ] **Step 10: Run `tsc --noEmit` and full nv-parser test suite**

Run: `npx tsc --noEmit` — expect the `.nv`-path exhaustiveness errors (if any remained after Task 4) to persist until Task 6/7 finish the emit path and `nv-emitter.ts`; parse-path-only usage should already typecheck since `SwitchBinding` construction here satisfies the type.
Run: `npx vitest run test/renderer/nv-parser.test.ts` — expect PASS, no regressions.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/nv-parser.ts test/renderer/nv-parser.test.ts
git commit -m "feat(nv-parser): recognize <switch>/<match> elements, produce SwitchBinding (parse path)"
```

---

## Task 6: `.nv` emit path — `ThunkSource` `'switch'` kind + `computeBindingThunks`

**Files:**
- Modify: `src/renderer/nv-parser.ts`
- Test: `test/renderer/nv-parser.test.ts` (or the file that exercises `parseNvFileForEmit`)

**Interfaces:**
- Consumes: `NvWalkedSwitch`/`pendingSwitches` (Task 5).
- Produces: `ThunkSource` `'switch'` variant; `PendingNvSwitchInfo`; wired into `computeBindingThunks` and `NvEmitPayload.bindingThunks`, consumed by Task 7's `nv-emitter.ts`.

> **Halt checkpoint — scope confirmation, not an invented decision.** This task (and
> Task 7) implement `SwitchBinding` support for `nv-emitter.ts`'s Mode-A module emitter
> — a THIRD back-end the original commission text does not name (it says "interpreted
> and compiled at parity," i.e. 2 back-ends: the interpreter and `emitted-mount.ts`).
> This plan's Self-Review Notes argue Mode-A is real end-user surface and its omission
> would leave a functional gap, not a hypothetical one — but that is this plan's
> judgment call, not a ruling from the commissioner. Per AGENTS.md's "halt at an
> undecided design gate" rule: before starting this task, confirm with the commissioner
> that Mode-A support is in-scope for this commission (or already implicitly approved,
> e.g. if this plan itself was reviewed and accepted with this section intact). If it is
> explicitly declined, skip Tasks 6–7 and instead add a task that makes `nv-emitter.ts`
> throw a clear, deliberate "not yet supported" error for `'switch'` (mirroring how
> `emitted-mount.ts` already does for `'recycled-list'`) so the gap is visible rather
> than silent.

- [ ] **Step 1: Add the `'switch'` `ThunkSource` variant**

In the `ThunkSource` union (nv-parser.ts:96–150 per research), add after the `'recycled-list'` variant:

```typescript
  | {
      kind: 'switch'
      branches: Array<{ whenSrc: string; bodyThunks: ThunkSource[] }>
      fallbackThunks: ThunkSource[] | null
    }
```

- [ ] **Step 2: Add `PendingNvSwitchInfo` type**

Find `PendingNvEachInfo`/`PendingNvRecycleInfo` type definitions (locate via `grep -n "interface PendingNvEachInfo\|interface PendingNvRecycleInfo" src/renderer/nv-parser.ts`) and add a parallel:

```typescript
interface PendingNvSwitchInfo {
  branches: Array<{ whenHoleIdx: number; bodyHoleIndices: number[]; bodyIR: TemplateIR }>
  hasFallback: boolean
}
```

- [ ] **Step 3: Thread `pendingSwitchItems` through the emit-payload plumbing**

Mirror `pendingEachItems`/`pendingRecycleItems` (nv-parser.ts:1237–1238, 1260–1261, 1423, 1430 per research) — add `pendingSwitchItems: PendingNvSwitchInfo[]` to the relevant result type, initialize to `[]` in the empty-branch case, and populate from `pendingSwitches` (Task 5) at the same site as the existing `.map()` calls:

```typescript
    pendingSwitchItems: pendingSwitches.map((ws) => ({
      branches: ws.branches.map((b) => ({
        whenHoleIdx: b.whenHoleIdx,
        bodyHoleIndices: b.bodyHoleIndices,
        bodyIR: b.bodyIR,
      })),
      hasFallback: ws.hasFallback,
    })),
```

- [ ] **Step 4: Wire `pendingSwitchItems` into `computeBindingThunks`**

In `computeBindingThunks` (nv-parser.ts:2946–3090+ per research), add a `pendingSwitchItems: PendingNvSwitchInfo[]` parameter (alongside `pendingRecycleItems`), and add a `switchThunks` computation mirroring `recycledListThunks` (nv-parser.ts:3049–3080+ per research):

```typescript
  const switchThunks: ThunkSource[] = pendingSwitchItems.map((ps) => {
    const branchThunks = ps.branches
      .filter((b) => b.whenHoleIdx !== -1)
      .map((b) => {
        const whenExpr = holeExprs[b.whenHoleIdx] as ts.Expression
        const whenSrc = eraseSignalReadsInNode(whenExpr, symbols.all, propsAccessors)
        const bodyThunks: ThunkSource[] = b.bodyHoleIndices.map((holeIdx) => {
          const holeExpr = holeExprs[holeIdx]
          if (holeExpr === undefined)
            throw new Error(`[nv/switch] Body hole index ${holeIdx} out of range`)
          return computeThunkSource(
            holeExpr,
            positions[holeIdx] as PosKind,
            doc,
            symbols,
            diagnostics,
            propsParamName,
            propsAccessors,
          )
        })
        return { whenSrc, bodyThunks }
      })

    const fallbackBranch = ps.hasFallback ? ps.branches[ps.branches.length - 1] : undefined
    const fallbackThunks: ThunkSource[] | null =
      fallbackBranch !== undefined
        ? fallbackBranch.bodyHoleIndices.map((holeIdx) => {
            const holeExpr = holeExprs[holeIdx]
            if (holeExpr === undefined)
              throw new Error(`[nv/switch] Fallback body hole index ${holeIdx} out of range`)
            return computeThunkSource(
              holeExpr,
              positions[holeIdx] as PosKind,
              doc,
              symbols,
              diagnostics,
              propsParamName,
              propsAccessors,
            )
          })
        : null

    return { kind: 'switch' as const, branches: branchThunks, fallbackThunks }
  })
```

Add `switchThunks` to whatever combined return/accumulation `computeBindingThunks` produces (read the function's tail — the research pass captured `componentThunks`/`listThunks`/`recycledListThunks` being computed but not the final combine step; locate and follow that pattern exactly, likely a single flat array assembled in binding order via each binding's `pathIndex`).

Update every call site of `computeBindingThunks` (nv-parser.ts:2762–2763, 2779–2780, 3323–3324 per research — there are at least 3) to pass `pendingSwitchItems` through, sourcing it from whichever `ProcessResult`/walk result is in scope at each site (mirror exactly how `pendingRecycleItems` is threaded at each of those 3 sites).

- [ ] **Step 5: Write the failing emit-path test**

```typescript
it('parseNvFileForEmit produces switch ThunkSource with reactive when expressions', () => {
  const doc = /* same harness as Task 5 tests */
  const source =
    'const C = $component(() => {\n' +
    '  $script(() => { const state = signal(0) })\n' +
    '  $render(() => html`<div><switch>' +
    '<match when=${state === 0}><span class="zero">0</span></match>' +
    '<match><span class="fb">fb</span></match>' +
    '</switch></div>`)\n' +
    '})\n'
  const results = parseNvFileForEmit(source, 'switch-emit.nv', doc)
  const emit = results[0]!.emit
  expect(emit).toBeDefined()
  const switchThunk = emit!.bindingThunks.find((t) => t.kind === 'switch')
  expect(switchThunk).toBeDefined()
  if (switchThunk?.kind === 'switch') {
    expect(switchThunk.branches.length).toBe(1)
    expect(switchThunk.branches[0]!.whenSrc).toContain('state()')
    expect(switchThunk.fallbackThunks).not.toBeNull()
  }
})
```

- [ ] **Step 6: Run test, expect fail, then implement Steps 1–4, then pass**

Run: `npx vitest run test/renderer/nv-parser.test.ts -t "switch ThunkSource"`
Expected sequence: FAIL → implement → PASS.

- [ ] **Step 7: Run `tsc --noEmit` and full nv-parser test suite**

Run: `npx tsc --noEmit` — the `nv-emitter.ts` `default: throw` case (not a type-level exhaustiveness check per research) will NOT show as a `tsc` error for the missing `'switch'` case there; that gap is closed in Task 7 and caught by a runtime test, not by `tsc`. Confirm no OTHER `tsc` errors remain related to `SwitchBinding`/`ThunkSource`.
Run: `npx vitest run test/renderer/nv-parser.test.ts` — expect PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/nv-parser.ts test/renderer/nv-parser.test.ts
git commit -m "feat(nv-parser): emit switch ThunkSource for parseNvFileForEmit"
```

---

## Task 7: `nv-emitter.ts` — `'switch'` case in `emitBindingLiteral`

**Files:**
- Modify: `src/renderer/nv-emitter.ts`
- Test: wherever `emitModule`'s output is tested end-to-end (locate via `grep -rln "emitModule" test/`)

**Interfaces:**
- Consumes: `SwitchBinding` (Task 1), `ThunkSource` `'switch'` variant (Task 6).
- Produces: `'switch'` case in `emitBindingLiteral`'s switch (nv-emitter.ts:85–262 per research), generating the module-source-text form of a `SwitchBinding` literal.

- [ ] **Step 1: Locate and read the existing `emitModule` end-to-end test harness**

Run: `grep -rln "emitModule" test/` and read the file(s) found — specifically how they assert on a `<recycle>` or `<each>`'s emitted module text (likely `expect(moduleSrc).toContain(...)` or an eval-and-run pattern). Match that harness exactly.

- [ ] **Step 2: Write the failing test**

Following the located harness's pattern:

```typescript
it('emitModule: <switch>/<match> emits a SwitchBinding literal with reactive when + fallback', () => {
  // Parse a component with <switch>/<match> via parseNvFileForEmit (Task 5/6),
  // call emitModule([result]), and assert the emitted source text contains
  // `kind: 'switch'`, the erased `when` expression, and (if the harness evals
  // the module) that mounting it renders the correct branch.
})
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — `emitBindingLiteral`'s `default` case throws `Unsupported binding kind for emit: switch`.

- [ ] **Step 4: Implement the `'switch'` case**

Add directly after the `'recycled-list'` case (nv-emitter.ts:194–214 per research), before `'classlist'`:

```typescript
    case 'switch': {
      if (thunk.kind !== 'switch') throw new Error('[nv/emitter] SwitchBinding thunk kind mismatch')
      const swb = binding as SwitchBinding
      const i2 = `${indent}  `
      const branchLiterals = swb.branches
        .map((b, idx) => {
          const branchThunk = thunk.branches[idx]
          if (!branchThunk)
            throw new Error(`[nv/emitter] Missing switch branch thunk at index ${idx}`)
          const bodyLiteral = emitIrLiteral(b.body, branchThunk.bodyThunks, i2)
          return `{ when: () => (${branchThunk.whenSrc}), body: ${bodyLiteral} }`
        })
        .join(',\n' + i2)
      const fallbackLiteral =
        swb.fallback === null
          ? 'null'
          : emitIrLiteral(swb.fallback, thunk.fallbackThunks ?? [], i2)
      return [
        `{ kind: 'switch', ${pathEntry},`,
        `${i2}branches: [${branchLiterals}],`,
        `${i2}fallback: ${fallbackLiteral} }`,
      ].join('\n')
    }
```

Add `SwitchBinding` to the `import type { ... } from './ir.js'` block at the top of `nv-emitter.ts` (nv-emitter.ts:22–37 per research), alongside `ConditionalBinding`/`RecycledListBinding`.

- [ ] **Step 5: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 6: Run `tsc --noEmit` — confirm fully clean**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors, repo-wide. This is the first point in the plan where `tsc --strict` should be fully green again (the exhaustiveness gate from Task 1 Step 3 is now satisfied everywhere).

- [ ] **Step 7: Run the full test suite**

Run: `npm test` (or the repo's actual full-suite script — confirm via `package.json`'s `scripts.test` before running)
Expected: PASS, every existing binding kind's tests green, no regressions anywhere.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/nv-emitter.ts test/
git commit -m "feat(nv-emitter): emit SwitchBinding literal for module emit (Mode A)"
```

---

## Task 8: FE-equivalence gate — `match()` vs `.nv` `<switch>`

**Files:**
- Modify: `test/renderer/html-tag.test.ts`

**Interfaces:**
- Consumes: `match()` (Task 4), `.nv` `<switch>` parse path (Task 5), `irStructurallyEqual` (the SHARED oracle at `test/renderer/ir-equivalence.ts:309`, signature `(doc, a, b) => IrDiff` — NOT the differently-signatured same-named local helper in `test/renderer/nv-parser.test.ts:98`; `html-tag.test.ts`'s existing `iff()` equivalence test already imports the `ir-equivalence.ts` one, confirm the import at Step 1 matches that), `parseNvFile` (existing).

This is a G1-gated Tier-1 correctness requirement — dedicated task so it isn't buried inside Task 4 or Task 5's per-file tests.

- [ ] **Step 1: Write the FE-equivalence test**

Add to `test/renderer/html-tag.test.ts`, directly after the existing `iff()`/`.nv` ternary equivalence test (lines 162–184 per research), following its exact structure:

```typescript
it('G1  FE-equivalence: match() and .nv <switch>/<match> produce irStructurallyEqual SwitchBinding', () => {
  const { doc, html } = setup()

  const state = signal(0)
  const ttIr = html`<div>${match(
    [
      { when: () => state() === 0, body: () => html`<span>A</span>` },
      { when: () => state() === 1, body: () => html`<span>B</span>` },
    ],
    () => html`<span>C</span>`,
  )}</div>`

  const source =
    'const C = $component(() => {\n' +
    '  $script(() => { const state = signal(0) })\n' +
    '  $render(() => html`<div><switch>' +
    '<match when=${state === 0}><span>A</span></match>' +
    '<match when=${state === 1}><span>B</span></match>' +
    '<match><span>C</span></match>' +
    '</switch></div>`)\n' +
    '})\n'
  const results = parseNvFile(source, 'switch-equiv.nv', doc)
  const nvIr = results[0]!.ir

  const result = irStructurallyEqual(doc, ttIr, nvIr)
  expect(result.equal, result.reason).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails (or reveals a structural mismatch)**

Run: `npx vitest run test/renderer/html-tag.test.ts -t "FE-equivalence: match"`

If it fails with a structural-mismatch reason (not a missing-feature error, since Tasks 4/5 are already done by this point) — that's a real bug in one of the two build paths, not an expected red state. Debug via `superpowers:systematic-debugging` before proceeding; do not paper over a genuine structural divergence.

- [ ] **Step 3: Extend `irStructurallyEqual`'s comparator for `'switch'`**

Find the comparator's `case 'conditional':` in `test/renderer/ir-equivalence.ts` (around lines 213–223 per research) and add a parallel `case 'switch':`. Do NOT edit the differently-signatured same-named helper local to `nv-parser.test.ts` — that one doesn't back the `html-tag.test.ts` FE-equivalence test and editing it would silently no-op this gate.

```typescript
    case 'switch': {
      const bs = b as SwitchBinding
      if (a.branches.length !== bs.branches.length)
        return { equal: false, reason: `${p}.branches length mismatch` }
      for (let i = 0; i < a.branches.length; i++) {
        const bodyRes = irStructurallyEqual(
          undefined,
          (a.branches[i] as SwitchBinding['branches'][number]).body,
          (bs.branches[i] as SwitchBinding['branches'][number]).body,
        )
        if (!bodyRes.equal) return { equal: false, reason: `${p}.branches[${i}].body → ${bodyRes.reason}` }
      }
      if ((a.fallback === null) !== (bs.fallback === null))
        return { equal: false, reason: `${p}.fallback nullity mismatch` }
      if (a.fallback !== null && bs.fallback !== null) {
        const fbRes = irStructurallyEqual(undefined, a.fallback, bs.fallback)
        if (!fbRes.equal) return { equal: false, reason: `${p}.fallback → ${fbRes.reason}` }
      }
      break
    }
```

(Note: `when` thunks are intentionally NOT compared — same reason `condition` isn't compared in the `'conditional'` case; the oracle checks IR *structure*, not closure identity/behavior, per the existing pattern.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/renderer/html-tag.test.ts -t "FE-equivalence: match"`
Expected: PASS.

- [ ] **Step 5: Run full html-tag test suite**

Run: `npx vitest run test/renderer/html-tag.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/renderer/html-tag.test.ts src/
git commit -m "test(fe-parity): G1 gate — match() and .nv <switch> produce structurally identical SwitchBinding"
```

---

## Task 9: Owner-tree / observer-count regression sweep

**Files:**
- No new source changes expected — verification-only task.

**Interfaces:**
- Consumes: everything from Tasks 1–8.

- [ ] **Step 1: Run the full test suite once more, clean**

Run: `npm test` (repo's actual script — reconfirm from `package.json`)
Expected: 100% pass, including every pre-existing binding kind (`text`, `attr`, `prop`, `event`, `child`, `conditional`, `list`, `recycled-list`, `sync`, `component`, `slot-outlet`, `classlist`, `style-var`) — no kind's suite regressed.

- [ ] **Step 2: Confirm no `src/core/` diff**

Run: `git diff main --stat -- src/core/`
Expected: empty output. If non-empty, STOP — this is a G0 disqualifier; do not proceed to Definition of Done. Escalate per the commission's escalation reminder rather than trying to shrink or justify the diff.

- [ ] **Step 3: Confirm `tsc --strict` clean**

Run: `npx tsc --noEmit --strict` (or the repo's actual strict-check script if `tsc --noEmit` alone doesn't apply `--strict` — check `tsconfig.json`'s `compilerOptions.strict` first; if already `true` there, plain `npx tsc --noEmit` suffices and this step is a duplicate of Task 7 Step 6 — run it anyway as a final confirmation)
Expected: zero errors.

- [ ] **Step 4: Grep for accidental effect-per-branch or new disposal patterns**

Run: `grep -n "wireSwitch\|SwitchBinding" src/renderer/interpreter.ts src/compiler/emitted-mount.ts`
Manually confirm: exactly one `effect(() => {...})` call site per implementation (interpreter + compiler), each containing exactly one `branchDisposer` variable, no per-branch `effect()` calls. This is a manual re-read, not a mechanical check — read both implementations once more end-to-end against Task 2 Step 3 / Task 3 Step 4's code.

- [ ] **Step 5: No commit needed — this is a verification checkpoint. If any check fails, fix and re-run before Task 10.**

---

## Task 10: `.nv` `<switch>` inside `<each>`/`<recycle>` body — nesting sanity check

**Files:**
- Modify: `test/renderer/nv-parser.test.ts`

**Interfaces:**
- Consumes: Task 5/6's `<switch>` parsing, existing `<each>`/`<recycle>` body-processing (`buildNvSlotContentIR`).

This isn't in the original spec's explicit gate list, but `<recycle>`-inside-`<each>` is an explicit hard error in the existing codebase (nv-parser.ts:1077–1080 per research — "recycle nested inside each body"), which signals nesting interactions are a known sharp edge for this class of construct. Verify `<switch>` doesn't silently misbehave in the same position before calling this done.

- [ ] **Step 1: Write a nesting test**

```typescript
it('<switch> works correctly nested inside an <each> body', () => {
  const doc = /* same harness as prior nv-parser tests */
  const source =
    'const C = $component(() => {\n' +
    '  $script(() => { const items = signal([{ id: 1, kind: 0 }]) })\n' +
    '  $render(() => html`<div><each .of=${items} key=${(i) => i.id} let={item}>' +
    '<switch><match when=${item.kind === 0}><span>zero</span></match><match><span>fb</span></match></switch>' +
    '</each></div>`)\n' +
    '})\n'
  const results = parseNvFile(source, 'switch-in-each.nv', doc)
  const ir = results[0]!.ir
  // Assert the <each>'s ListBinding.itemTemplate body contains a SwitchBinding at the expected path.
  const listBinding = ir.bindings.find((b) => b.kind === 'list')
  expect(listBinding).toBeDefined()
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run test/renderer/nv-parser.test.ts -t "nested inside an <each>"`

If it fails: since `<switch>` body processing reuses `buildNvSlotContentIR` exactly as `<each>`/`<recycle>` bodies do (Task 5 Step 4), it should compose without special-casing. If it does NOT pass cleanly, that's new information about an interaction the ruling didn't anticipate — debug via `superpowers:systematic-debugging`; do not add a nesting-specific hack without first confirming the root cause isn't a Task 5 implementation bug.

- [ ] **Step 3: Commit**

```bash
git add test/renderer/nv-parser.test.ts
git commit -m "test(nv-parser): verify <switch> composes correctly nested inside <each> body"
```

---

## Task 11: Final verification pass + report

**Files:**
- None — verification and reporting only.

- [ ] **Step 1: Verify at actual `main` HEAD, not by summary**

Run: `git fetch && git log origin/main -1` and `git diff origin/main --stat` to see the full accumulated diff of this branch against the real current `main` (re-fetch — time may have passed since the plan's anchor SHA `1d36e39`/research pass). Read the actual diff, not this plan's description of it.

- [ ] **Step 2: Re-run full suite + strict typecheck one final time**

Run: `npm test && npx tsc --noEmit`
Expected: 100% green.

- [ ] **Step 3: Confirm every G0/G1 gate from the commission spec**

Checklist (re-verify each against the actual diff, not from memory):
- [ ] No `src/core/` diff.
- [ ] Single effect + single `branchDisposer` in both interpreter and compiler `wireSwitch` implementations.
- [ ] `.nv` `<switch>` is a dedicated element (string-rewrite + `walkNvNodeList` detection), not built on the ternary path.
- [ ] `match()` landed with `assertAllBindingKindsHandled`'s `'switch'` case, in the same set of commits as the `.nv` form (no red-`tsc` window in what ships).
- [ ] `SwitchBinding` only reachable via `createRoot`-scoped branch mounting with disposal (interpreter + compiler both verified in Task 9 Step 4).
- [ ] First-match-wins verified (TC-SW01 / Task 4 Step 6 / Task 8).
- [ ] Fallback null-safety verified (TC-SW02).
- [ ] N-branch swap disposal verified, no leaks (TC-SW03).
- [ ] Parent-teardown bridge verified (TC-SW04).
- [ ] FE-equivalence gate passes (Task 8).
- [ ] Interpreter/compiler/Mode-A-emitter parity (Tasks 2, 3, 7 all implement `'switch'`).
- [ ] No regression on any existing binding kind (Task 9 Step 1).
- [ ] `tsc --strict` clean (Task 9 Step 3, Task 11 Step 2).
- [ ] Distinct-path discipline: `wireSwitch`/compiler `'switch'` case reuse `wireConditional`'s disposal mechanics (single effect, single disposer, `createRoot`-per-branch, `onCleanup` bridge) rather than forking a cosmetically-different copy — re-read both implementations once more now and confirm neither has drifted into a second degraded-copy path (same check as Task 9 Step 4, repeated here as the final gate item since it's a named requirement in the commission separate from G0/G1).

- [ ] **Step 4: Open the PR and squash-merge**

Push the feature branch, open a PR against `main`, and **squash-merge it** (not a regular merge) — this is what makes the G0 "same commit/PR, no window where `tsc` is red or one FE lacks the capability" requirement actually true on `main`'s history, per the Global Constraints note. Confirm CI (if configured) passes on the PR before merging. This is a real push/merge action — confirm with whoever is driving this session before pushing or merging, per this environment's standing rule to check before hard-to-reverse or shared-state actions.

- [ ] **Step 5: Report**

Per the commission: after the squash-merge, run `git fetch && git log origin/main -1` to get the real landed SHA, and report that SHA plus any deviations from the spec (there should be none without prior flagging — check Task 5 Step 1's escalation note, Task 6's halt-checkpoint note, and Task 8 Step 2's debugging note for any that fired during execution). Do NOT write the decision-log delta — the commissioner does that.

---

## Self-Review Notes

**Spec coverage check:** every section of the commission is covered — IR shape (Task 1), interpreter semantics/disposal (Task 2), `.nv` authoring form + footguns (Task 5, Task 10), tagged authoring form (Task 4), exhaustiveness gate (Tasks 1/4/5/7), G0 disqualifiers (Global Constraints + Task 9), G1 gates (Tasks 2/4/8/9), distinct-path discipline (Task 2/3 explicitly reuse `wireConditional`'s pattern via generalization, not duplication — the code shares the identical disposal shape, differing only in the branch-selection loop), definition of done (Task 11).

**Third back-end discovered during research not named in the commission:** the commission spec only mentions "interpreted and compiled at parity" (2 back-ends), but this codebase has a third: `nv-emitter.ts`'s Mode-A module emitter (used by `parseNvFileForEmit` + `emitModule`, generating standalone JS module source with inline IR literals). Tasks 6–7 cover this, now gated behind an explicit halt checkpoint at the top of Task 6 rather than silently built past (per AGENTS.md's "halt at an undecided design gate" rule — a prior draft of this plan resolved this by argument in prose without an actual stop point, which the three-part review correctly flagged as a soft axiom violation).

**Three-part review findings applied (2026-07-01):** this plan was reviewed by three independent passes — spec/gate coverage against the verbatim commission, code-accuracy against the live repo, and internal coherence/AGENTS.md compliance — before execution began. Fixes folded in: (1) TC-SW03 now requires an owner-tree assertion, not just DOM child count, per G1's literal wording; (2) Task 2 Step 8 now checks for/adds a `wireConditional` parent-teardown test for parity, per the commission's explicit fallback instruction; (3) Global Constraints now specifies feature-branch + squash-merge workflow, resolving the G0 atomic-landing requirement for real rather than by assertion, with an explicit merge step added to Task 11; (4) an explicit Gate-P checkpoint was added at the top of Task 5 (the first task touching the pinned `.nv` authoring surface); (5) Task 4 Step 3 now names both required wiring sites (`buildSlotContentIR` AND the separate top-level `html()` call site) instead of treating them as one; (6) the `tsc`-green timeline in Global Constraints was corrected — it goes green after Task 2 + Task 4 (both compile-time exhaustiveness checks), not Task 5 or Task 7 as earlier internally-contradictory task text claimed; (7) the "full suite every task" constraint was narrowed to match what the tasks actually do (full suite at Tasks 2/4/7/9/11, scoped elsewhere) instead of an unenforced blanket claim; (8) Task 8 now names the exact `irStructurallyEqual` file (`test/renderer/ir-equivalence.ts`) to avoid editing a same-named but unrelated local test helper; (9) Task 3's compiler code now flags the `before`-vs-`anchorNode` parameter-naming nuance to check at implementation time; (10) Task 11's gate checklist now includes distinct-path discipline as its own line item, not just narrative.

**Placeholder scan:** no TBD/TODO markers; every step has concrete code or an exact command with expected output. Two spots intentionally defer exact-shape decisions to implementation time (Task 4 Step 3's loop-insertion site, Task 6 Step 4's combine-step) because the research pass did not capture that exact code and guessing its shape risks a plan built on an unread seam (violates "read the seams before you spec") — each of those instructs reading the real code first, not guessing.

**Type consistency check:** `SwitchBinding.branches[].when: ReactiveExpr<boolean>` (Task 1) is consumed identically in `wireSwitch` (Task 2), `emitted-mount.ts`'s case (Task 3), `buildSwitchBinding` (Task 4), and `pushSwitchBinding` (Task 5) — same field names (`branches`, `when`, `body`, `fallback`) used throughout, no renaming drift. `ThunkSource`'s `'switch'` variant (Task 6: `branches: Array<{ whenSrc, bodyThunks }>`, `fallbackThunks`) is consumed with matching field names in `nv-emitter.ts` (Task 7). `MatchSentinel`'s `branches: { when, body }[]` (Task 4) matches the public `match()` signature from the commission spec verbatim.
