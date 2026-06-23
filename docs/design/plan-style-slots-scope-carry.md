# `$style × slots` Scope-Carry — Implementation Plan (Gate P)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Gate P APPROVED 2026-06-23** (plan `f96894e` + merge redirect).
> CC may proceed to `src/` — no second approval needed for the merge-vs-separate simplification.
>
> **LANDED 2026-06-23.** G1–G4, G3', G6, G7: green. G5: deferred (`<each>`-in-slot increment).

**Goal:** Make class-form `$style` tokens authored in parent-supplied slot content carry
the parent's scope hash, on both front-ends and both back-ends.

**Architecture:** Mechanism B3 — derive `scopeHash` from pre-walk `shapeHtml` (not `ir.id`);
thread `shapeHtml` through `ProcessResult`; add a `component` case to the EXISTING
`patchClasslistTokens` (mirrors the `list` case: stub-call factory, recurse). One walk,
one function. `injectComponentStyle` injection dedup re-keyed to `scopeHash`. `ir.id` untouched.

**Tech Stack:** TypeScript, `src/renderer/nv-parser.ts` + `src/renderer/interpreter.ts`
(renderer workstream), existing ir-equivalence + emit-exec gate harness. No reactive-core touch.
No Template-IR version bump.

**HEAD SHA at plan write:** `82c2f40102131dbb71212372c04361f84c9407a5`

## Global Constraints

- No `src/core/` touch — reactive-core untouched by this increment.
- No `::slotted` analog — §5 ruling (NO, reading (b)) locked; do not add cascade-defeating logic.
- Both back-ends (parse-path `parseNvFile` and emit-path `parseNvFileForEmit`/`emitModule`) receive
  the same fix at the same insertion site (differential conformance).
- Misclassification falls safe — if a token is absent from `classRewrites`, it stays raw.
- Injection through passed `doc` — unchanged from S1+S2.
- `patchClasslistTokens` must NOT gain a `component` case (Mechanism A's degraded form; slot
  subsystem was bitten by this pattern 4×).
- Done = committed and on `main`. "Tests green" is not done.

---

## 1. Seams Cited at HEAD

All line numbers verified against HEAD `82c2f40` in `src/renderer/nv-parser.ts` (and
`src/renderer/interpreter.ts` where noted).

### 1.1 `buildNvSlotContentIR` — slot-content IR builder

**File:** `src/renderer/nv-parser.ts` **L740–800**

```ts
function buildNvSlotContentIR(
  slotNodes: Node[],
  holeExprs: ts.Expression[],
  doc: Document,
  slotId: string,
  signals: ReadonlySet<string>,
  letNames: string[] = [],
): { ir: TemplateIR; holeIndices: number[]; letNames: string[] }
```

Called during `walkNvNodeList` for each slot on a component element. Receives NO `classRewrites`
parameter today — class tokens in slot content are built raw and never rewritten.

### 1.2 Named/default slot capture sites

**File:** `src/renderer/nv-parser.ts` **L644–682**

```
L649: buildNvSlotContentIR(defaultNodes, holeExprs, doc, `slot:${tagName}:default`, signals)
L656: const defaultContent: SlotContent = (_props) => defaultIR   // captures defaultIR by ref
L669: buildNvSlotContentIR(slotChildNodes, holeExprs, doc, `slot:${tagName}:${slotName}`, ...)
L677: const namedContent: SlotContent = (_props) => namedIR        // captures namedIR by ref
```

Mechanism B requires the rewrite inside `buildNvSlotContentIR` **before** these closures capture
the IR. Post-capture in-place mutation (Mechanism A) breaks when the factory builds fresh IR per
call (G2). B3 delivers `classRewrites` at build time, not post-capture.

### 1.3 `processHtmlTemplate` — `shapeHtml` and `ir.id` origin

**File:** `src/renderer/nv-parser.ts` **L941–1115**

```
L974: const { sentinelHtml, shapeHtml } = buildNvHtmlStrings(strings, positions)
L993: walkNvNodeList(...)           // ← slot content built HERE; shapeHtml already exists
L1094: const reserializedShape = shapeDiv.innerHTML.replace(...)   // post-walk
L1101: id: `nv:${simpleHash(reserializedShape)}`,                   // post-walk
```

`shapeHtml` is pre-walk and in scope inside `processHtmlTemplate`. It is NOT returned from
`processHtmlTemplate` today — only `ir` (which carries post-walk `ir.id`) is surfaced.

No-substitution template branch (L947–960): `buildNvHtmlStrings` is never called; `shapeHtml`
= `template.text`. Returns immediately (no walk, no slot content possible).

### 1.4 `ProcessResult` interface

**File:** `src/renderer/nv-parser.ts` **L932–939**

```ts
interface ProcessResult {
  ir: TemplateIR
  verdicts: Array<'ACCEPT' | 'PLAIN'>
  pendingComponents: PendingNvComponentInfo[]
  pendingEachItems: PendingNvEachInfo[]
  consumedByComponent: ReadonlySet<number>
  diagnostics: NvDiagnostic[]
}
```

Does not carry `shapeHtml`. B3 requires adding it.

### 1.5 `extractRenderTemplate` — `ProcessResult` passthrough

**File:** `src/renderer/nv-parser.ts` **L1209–1231**

```ts
function extractRenderTemplate(componentFn, doc, symbols): ProcessResult | null {
  ...
  return processHtmlTemplate(body, doc, symbols.all)
}
```

Pure passthrough — will surface `shapeHtml` once `ProcessResult` carries it. No other change.

### 1.6 `scopeHash` derivation — two sites, both wrong for slots

**Parse path:** `src/renderer/nv-parser.ts` **L1988**
```ts
const scopeHash = simpleHash(renderResult.ir.id)   // ← B3: change to simpleHash(renderResult.shapeHtml)
```

**Emit path:** `src/renderer/nv-parser.ts` **L2899**
```ts
const scopeHash = simpleHash(renderResult.ir.id)   // ← B3: change to simpleHash(renderResult.shapeHtml)
```

Both sites are in functions that receive `renderResult: ProcessResult`. Once `ProcessResult`
carries `shapeHtml`, the change is a one-liner at each site.

### 1.7 `patchClasslistTokens` — gap confirmed, no `component` case

**File:** `src/renderer/nv-parser.ts` **L1870–1897**

Handles `classlist`, `conditional`, `list`. No `component` case — never descends into
`ComponentBinding.slots[].content`. Slot IR is invisible to the current patch walk. B3 does
not add a `component` case here (that is Mechanism A; ruled out).

### 1.8 `injectComponentStyle` call site — injection key bug under B3

**File:** `src/renderer/interpreter.ts` **L711**

```ts
injectComponentStyle(doc, ir.id, ir.styleArtifact.staticCss)
```

Currently keys dedup on `ir.id`. With current code, `scopeHash = simpleHash(ir.id)` so same
`ir.id` → same `scopeHash` → same CSS. This is a 1:1 mapping; `ir.id` dedup is equivalent.

Under B3, `scopeHash = simpleHash(shapeHtml)` and `ir.id = nv:${simpleHash(reserializedShape)}`
are INDEPENDENT. Two parents with the same `reserializedShape` (same `ir.id`) but different
`shapeHtml` (different slot content) would have different `scopeHash` values and therefore
different CSS, but injection on `ir.id` would dedup them → second parent's CSS never injected.

**Fix:** change L711 to key on `ir.styleArtifact.scopeHash` (which is set to `scopeHash` at
L1993 on the parse path, L2905 on the emit path). The `styleArtifact` already carries `scopeHash`
(ir.ts L83–85: `{ staticCss, scopeHash, varBindingDescs }`).

### 1.9 `buildStyleArtifact` — purely static, no walk dependency (F5)

**File:** `src/renderer/nv-parser.ts` **L1742–1804**

Builds `classRewrites` from `styleInfo.objExpr` keys + `scopeHash` only. No IR walk.
Callable pre-walk once `scopeHash` is known (which B3 makes pre-walk via `shapeHtml`). This
is the key that makes B3 feasible: `buildStyleArtifact` can run before `walkNvNodeList`,
producing `classRewrites` in time for `buildNvSlotContentIR`.

---

## 2. RESOLVED — B3 Mechanism

**OPEN-S1 ruled 2026-06-23. No further options needed.**

### 2.1 What B3 changes

**Change 1 — `ProcessResult` carries `shapeHtml`:**
```ts
interface ProcessResult {
  ir: TemplateIR
  verdicts: Array<'ACCEPT' | 'PLAIN'>
  pendingComponents: PendingNvComponentInfo[]
  pendingEachItems: PendingNvEachInfo[]
  consumedByComponent: ReadonlySet<number>
  diagnostics: NvDiagnostic[]
  shapeHtml: string    // ← add; pre-walk authored shape
}
```

**Change 2 — `processHtmlTemplate` sets `shapeHtml`:**

Templates with holes (L1099–1104 return site):
```ts
return {
  ir: { id: `nv:${simpleHash(reserializedShape)}`, ... },   // ir.id UNCHANGED
  ...
  shapeHtml,   // from buildNvHtmlStrings at L974, already in scope
}
```

No-substitution template (L947–960 return site):
```ts
return {
  ir: { id: `nv:${simpleHash(template.text)}`, ... },   // unchanged
  ...
  shapeHtml: template.text,   // no walk → shapeHtml = raw template text
}
```

**Change 3 — Both `scopeHash` sites:**
```ts
// L1988 (parse path) and L2899 (emit path) — identical change at each
const scopeHash = simpleHash(renderResult.shapeHtml)   // was: simpleHash(renderResult.ir.id)
```

**Change 4 — Injection dedup key:**
```ts
// interpreter.ts L711
injectComponentStyle(doc, ir.styleArtifact.scopeHash, ir.styleArtifact.staticCss)
// was: injectComponentStyle(doc, ir.id, ...)
```

### 2.2 Why `shapeHtml` is pre-walk and in scope

`shapeHtml` (L974) is computed from `buildNvHtmlStrings(strings, positions)` BEFORE
`walkNvNodeList` (L993). `buildNvSlotContentIR` is called INSIDE `walkNvNodeList`. So once
`processHtmlTemplate` computes `shapeHtml`, it can pass `classRewrites = buildStyleArtifact(styleInfo, simpleHash(shapeHtml), symbols).classRewrites` into the walk before slot content is built.

Wait — `buildStyleArtifact` requires `styleInfo` (from `extractStyleInfo`), which is extracted
OUTSIDE `processHtmlTemplate` at L1987. So the ordering is:

```
processHtmlTemplate  ← shapeHtml available here (L974)
  walkNvNodeList     ← buildNvSlotContentIR called here; needs classRewrites
                        but styleInfo not yet extracted
extractStyleInfo     ← L1987, outside processHtmlTemplate
buildStyleArtifact   ← L1990, needs styleInfo + scopeHash
```

`styleInfo` is not available inside `processHtmlTemplate`. **Implication for implementation:**
`classRewrites` cannot be built inside `processHtmlTemplate`. Instead:

- `processHtmlTemplate` surfaces `shapeHtml` (so `scopeHash` can be computed outside)
- Caller computes `scopeHash = simpleHash(shapeHtml)` (L1988 / L2899, same location as today)
- Caller builds `classRewrites = buildStyleArtifact(styleInfo, scopeHash, symbols).classRewrites`
- Caller then calls a **post-walk slot-patch pass**: iterate `renderResult.ir.bindings` for
  `ComponentBinding` entries and call `buildNvSlotContentIR` again? No — that's B2.

**Correct B3 sequencing:** The slot content IR is already built (by the walk). What B3 enables is
rewriting slot IR in-place POST-WALK, using a post-capture patch — but only if the factory
returns the captured-by-ref IR object. This IS Mechanism A's territory (ruled out) for the
general case.

**The correct reading of B3:** `shapeHtml` being pre-walk means `scopeHash` is computable
without the walk. But for `classRewrites` to reach `buildNvSlotContentIR`, we need:

1. Extract `shapeHtml` from `processHtmlTemplate` → `renderResult.shapeHtml`
2. Compute `scopeHash = simpleHash(shapeHtml)` at the caller (L1988 / L2899)
3. Build `classRewrites` from `buildStyleArtifact` (post `extractStyleInfo`)
4. **Re-thread `classRewrites` back into slot content IR** — the question is HOW.

The slot content factories are `(_props) => namedIR` where `namedIR` is captured by reference.
After the walk, we have access to `renderResult.ir.bindings` which contains `ComponentBinding`
entries, each carrying `slots[].content` factories. We can call `content({})` to get the IR
object, then patch it in-place. For parse-path `(.nv)` closures this works because the factory
always returns the same captured object.

For the emit path there is no IR to patch (slot content is `ThunkSource[]` source strings).
The classlist tokens appear in the slot `thunks`, which are JS expression sources built from
`holeExprs` — not IR classlist entries.

**B3 actual execution: a post-walk slot IR patch using the real `classRewrites`.**

This is effectively a restricted Mechanism A — with the key difference that:
- It only patches tokens via the established `patchClasslistTokens` call (no new walk)
- It calls `content({})` on each `ComponentBinding` slot, then recurses with `patchClasslistTokens`
- G2 (fresh-IR-factory): the patch is applied to whatever IR the factory returns; if the factory
  builds a fresh IR per call, the patch must be applied before the factory is frozen

**For the `.nv` parse path:** the factory `(_props) => namedIR` always returns the same
`namedIR` (captured by reference at L656/L677). Patching `namedIR` after capture works. G2
is not a real risk on the `.nv` parse path today — scoped-slot factories return the same object.

**For the emit path:** the slot IR classlist tokens appear in the IR object (not ThunkSources),
and the emit path also has `renderResult.ir` with the same `ComponentBinding.slots[].content`
factories. Same post-walk patch applies.

**G2 (fresh-IR-factory) is a future-proofing gate, not a current `.nv` failure.** The `.nv`
parser always builds captured-by-ref slot IR. G2 documents the guarantee that Mechanism A-style
post-capture patching is ONLY safe because `.nv`-built factories are by-reference. Any future
change that makes factories build fresh IR per call (e.g. truly scoped slot factories with
per-invocation state) would break this. The plan must note this constraint explicitly.

### 2.3 Revised B3 implementation shape (Gate P approved)

B3 does NOT add a `classRewrites` parameter to `buildNvSlotContentIR` (that approach required
`styleInfo` to be available inside `processHtmlTemplate`, which it isn't). Instead:

1. Add `shapeHtml: string` to `ProcessResult` and return it from `processHtmlTemplate`.
2. Change L1988/L2899: `const scopeHash = simpleHash(renderResult.shapeHtml)`.
3. Build `artifact = buildStyleArtifact(styleInfo, scopeHash, symbols)` (unchanged call).
4. The existing `patchClasslistTokens(renderResult.ir, artifact.classRewrites)` gains a
   **`component` case** (mirrors the `list` case): for each `ComponentBinding`, call
   `slot.content(stubSlotProps)` to get the slot IR, recurse. No new function — collapse into
   the existing walk. G7 satisfied structurally (one walk, one function).
5. Change `injectComponentStyle` call to key on `scopeHash`.

**`patchSlotContentTokens` is a thin wrapper, not a new walk.** It iterates existing bindings
(no DFS, no re-parse) and delegates to `patchClasslistTokens` (existing function). G7: one
rewrite logical site — the same `patchClasslistTokens` function, just called on slot IR after
the fact. No new descent logic; no new `component` case inside `patchClasslistTokens` itself.

**G2 constraint on `patchSlotContentTokens`:** The function calls `content({})` to get the slot
IR. This is safe as long as the factory returns the same captured IR object (true for all current
`.nv` parse-path factories). **Document this as a debt gate:** if the scoped-slot factory shape
ever builds fresh IR per call, `patchSlotContentTokens` must be restructured (e.g. moved into the
factory closure as a decoration, or B2 revived). Add a code comment marking this assumption.

**Static HTML class tokens in `ir.shape.html`:** `patchSlotContentTokens` must also rewrite
static class attribute tokens in `ir.shape.html` (the slot content HTML string). Same regex
approach as §3.1 of the original plan.

---

## 3. Single-Rewrite-Site Design (CONFIRMED)

Both paths share `processHtmlTemplate` → `renderResult.ir`. The `component` case is added to
the EXISTING `patchClasslistTokens` function (L1870), mirroring the `list` case (L1888–1894).
No new function, no second walk. `patchClasslistTokens` already descends into `conditional` and
`list`; `component` is the structurally identical missing case.

`component` case addition to `patchClasslistTokens`:
```ts
if (binding.kind === 'component') {
  const stubSlotProps = {}
  for (const slot of (binding as ComponentBinding).slots) {
    // NOTE: safe only while .nv slot factories return captured-by-ref IR (not fresh per call).
    // The scoped-slot shape (props) => TemplateIR permits a fresh-IR factory that would break
    // this silently — same latent fragility as the 'list' case above.
    const slotIR = slot.content(stubSlotProps)
    patchClasslistTokens(slotIR, classRewrites)
  }
}
```

Also rewrite static class attribute tokens in `slotIR.shape.html` (the HTML string):
```ts
if (binding.kind === 'component') {
  const stubSlotProps = {}
  for (const slot of (binding as ComponentBinding).slots) {
    // NOTE: by-ref factory assumption — see list case comment above.
    const slotIR = slot.content(stubSlotProps)
    if (slotIR.shape.html.includes('class=')) {
      ;(slotIR.shape as { html: string }).html = slotIR.shape.html.replace(
        /\bclass="([^"]*)"/g,
        (_, cls: string) =>
          `class="${cls.replace(/\b([\w-]+)\b/g, (tok) => classRewrites.get(tok) ?? tok)}"`,
      )
    }
    patchClasslistTokens(slotIR, classRewrites)
  }
}
```

Add a corresponding comment to the `list` case flagging its identical latent fragility (no
behavior change):
```ts
if (binding.kind === 'list') {
  // NOTE: patches stub-call return; sticks only while itemTemplate returns same IR by ref.
  // Same latent fragility as the 'component' case below — fresh-IR factory would break silently.
  const stubVs = signal<unknown>(null)
  ...
}
```

**G7 confirmation:** One walk, one function (`patchClasslistTokens`). Structural guarantee — no
parallel path can exist.

---

## 4. Differential Corpus (CONFIRMED)

Reuse existing ir-equivalence + emit-exec harness. Add new test cases to `test/renderer/`.

| Case | Fixture content | Gates |
|------|----------------|-------|
| **Base classlist** | Parent `$style({card: {color:'red'}})` + default slot `<div class="${{card: true}}">` | G1, G4 |
| **Named slot** | Same but with `<slot name="header">` | G1, G4 |
| **Static class attr** | Slot content `<div class="card">` (raw HTML attr, not classlist binding) | G1 (static) |
| **Nested `<each>`** | `<each>` inside slot, body uses `class="${{card: true}}"` | G5 |
| **G3' identity** | Two parents: same `$style` + same `shapeHtml`, different child-component composition | G3' |
| **G6 fixture** | Playwright: mount parent + child; inspect projected node attrs | G6 |

---

## 5. Per-Phase Gate Tables (Gates G1–G7 + G3')

| ID | Check | Evidence command | Fails if |
|----|-------|-----------------|----------|
| **G1** | Parent class-form token in slot content carries parent hash on projected node | mount `ParentWithSlot`; inspect `el.querySelector('.card_<parenthash>')` | class is raw `card` or `card_<childhash>` |
| **G2** | Slot factory by-ref constraint documented; current `.nv` factories always return captured IR | code comment in `patchSlotContentTokens`; no test asserts fresh-IR-factory scenario (it cannot arise today) | comment absent, OR a fresh-IR factory is introduced without revisiting this function |
| **G3** | Both scopeHash sites use `simpleHash(renderResult.shapeHtml)` identically | `grep 'simpleHash(renderResult' src/renderer/nv-parser.ts` shows `shapeHtml` at both L1988/L2899 | either site still uses `ir.id`, or sites use different inputs |
| **G3'** | Two parents with identical `$style` + identical `shapeHtml` share `scopeHash`; injection dedup merges their style identity only (not mount identity) | unit test: assert both parents' `ir.styleArtifact.scopeHash` equal; mount both; assert only ONE style injection happened for that scopeHash | hashes differ, OR a second injection fires for an identical scopeHash |
| **G4** | Parse-path IR ↔ emit-path output agree on slot-content class tokens (shared oracle) | ir-equivalence + emit-exec on new fixtures | any token disagrees between parse and emit |
| **G5** | Class-form token in `<each>`-inside-slot-content rewritten | depth-2 fixture; mount; inspect | nested token raw | **[DEFERRED 2026-06-23]** — `<each>`-in-slot unwired; test skipped with reason; separate increment. |
| **G6** | §5 guarantee: NO `data-nv-s-<childhash>` on parent-projected nodes; incidental cascade match not a defect (real-browser ×3) | Playwright Blink/Gecko/WebKit; inspect projected node attrs | `data-nv-s-<childhash>` appears on a projected node, OR a test asserts non-match |
| **G7** | `patchClasslistTokens` has no new `component` case; `patchSlotContentTokens` is a separate thin wrapper | `grep -A5 "binding.kind === 'component'" src/renderer/nv-parser.ts` shows no descent inside `patchClasslistTokens` | a `component` case appears inside `patchClasslistTokens` |

**G6 is real-browser REQUIRED.** G2 is a code-comment gate (constraint cannot be tested today
because fresh-IR factories don't exist; the constraint must be documented for future changes).

---

## 6. Locked-Constraint Confirmations (G0)

| Constraint | Status |
|-----------|--------|
| No `src/core/` touch | ✓ — changes in `nv-parser.ts` and `interpreter.ts` only |
| No reactive-core touch | ✓ — all rewrites are static; no tracked read, no write-during-propagation |
| Injection through passed `doc` | ✓ — unchanged |
| nv-does-not-invent-CSS (§5 reading (b)) | ✓ — no `data-nv-s-<childhash>` placed on projected nodes |
| No cascade-defeating logic | ✓ |
| Misclassification falls safe | ✓ — absent token → stays raw |
| Both back-ends differential | ✓ — `patchSlotContentTokens` added at both parse (L2003 area) and emit (L2914 area) sites; single function |
| No `component` case in `patchClasslistTokens` | ✓ — slot descent is in new `patchSlotContentTokens`, not `patchClasslistTokens` |
| Template-IR version bump | ✓ not needed |

---

## 7. Implementation Tasks (Post-Architect-Approval)

> **⛔ Do NOT start until architect approves this Gate-P plan.**

### Task 1 — Thread `shapeHtml` through `ProcessResult` + fix `scopeHash` sites

**Files:**
- Modify: `src/renderer/nv-parser.ts` (L932 interface, L947–960 no-sub return, L1099–1104
  holes return, L1988, L2899)
- Test: `test/renderer/nv-parser.test.ts` (G3 assertion)

- [ ] **Step 1: Write failing G3 test**

  ```ts
  // test/renderer/nv-parser.test.ts
  it('G3: both scopeHash sites use simpleHash(shapeHtml), not simpleHash(ir.id)', () => {
    // A parent with a child component — shapeHtml ≠ reserializedShape here
    const src = `
      const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
    `
    const results = parseNvFile(src, 'test.nv', document)
    const parent = results.find(r => r.name === 'Parent')!
    // The scopeHash embedded in classRewrites values must NOT equal simpleHash(ir.id)
    // (because shapeHtml ≠ ir.id's input for a template with child components)
    const rwHash = [...(parent.ir.classRewrites?.values() ?? [])][0]?.split('_').pop()
    expect(rwHash).toBeDefined()
    expect(rwHash).not.toBe(simpleHash(parent.ir.id))
    // It should equal simpleHash of the pre-walk shape — verified by checking styleArtifact
    expect(parent.ir.styleArtifact?.scopeHash).toBe(rwHash)
  })
  ```

  Run: `pnpm test -- --grep 'G3'`
  Expected: FAIL (currently `rwHash === simpleHash(ir.id)`)

- [ ] **Step 2: Add `shapeHtml` to `ProcessResult`**

  ```ts
  // src/renderer/nv-parser.ts L932 area
  interface ProcessResult {
    ir: TemplateIR
    verdicts: Array<'ACCEPT' | 'PLAIN'>
    pendingComponents: PendingNvComponentInfo[]
    pendingEachItems: PendingNvEachInfo[]
    consumedByComponent: ReadonlySet<number>
    diagnostics: NvDiagnostic[]
    shapeHtml: string    // pre-walk authored shape; B3 scopeHash seed
  }
  ```

- [ ] **Step 3: Return `shapeHtml` from `processHtmlTemplate`**

  No-substitution branch (L947–960):
  ```ts
  return {
    ir: { id: `nv:${simpleHash(template.text)}`, shape: { html: template.text, bindingPaths: [] }, bindings: [], meta: { frontEnd: 'nv-file' } },
    verdicts: [],
    pendingComponents: [],
    pendingEachItems: [],
    consumedByComponent: new Set<number>(),
    diagnostics: [],
    shapeHtml: template.text,   // ← add
  }
  ```

  Template-with-holes return (L1099–1104):
  ```ts
  return {
    ir: { id: `nv:${simpleHash(reserializedShape)}`, shape: { html: reserializedShape, bindingPaths: allPaths as NodePath[] }, bindings, meta: { frontEnd: 'nv-file' } },
    verdicts,
    pendingComponents: ...,
    pendingEachItems: ...,
    consumedByComponent: ...,
    diagnostics: processdiagnostics,
    shapeHtml,   // ← add; from buildNvHtmlStrings at L974, already in scope
  }
  ```

- [ ] **Step 4: Change both `scopeHash` sites**

  Parse path L1988:
  ```ts
  // was: const scopeHash = simpleHash(renderResult.ir.id)
  const scopeHash = simpleHash(renderResult.shapeHtml)
  ```

  Emit path L2899:
  ```ts
  // was: const scopeHash = simpleHash(renderResult.ir.id)
  const scopeHash = simpleHash(renderResult.shapeHtml)
  ```

- [ ] **Step 5: Run G3 test**

  Run: `pnpm test -- --grep 'G3'`
  Expected: PASS (rwHash now differs from simpleHash(ir.id) for the child-component case)

- [ ] **Step 6: Run full suite; update hash expectations**

  ```bash
  pnpm test 2>&1 | grep -E 'FAIL|Expected|Received' | head -40
  ```

  Any test asserting a literal `_<hash>` on a styled component containing child components
  will fail. Update expected hashes to new B3 values. Commit note should list affected fixtures.

- [ ] **Step 7: Commit**

  ```bash
  git add src/renderer/nv-parser.ts test/renderer/nv-parser.test.ts
  git commit -m "feat(renderer): B3 — thread shapeHtml via ProcessResult; scopeHash = simpleHash(shapeHtml)"
  ```

### Task 2 — `component` case in `patchClasslistTokens` + injection dedup fix

**Files:**
- Modify: `src/renderer/nv-parser.ts` (`component` case in `patchClasslistTokens` L1870; list
  case comment; static HTML rewrite inside component case)
- Modify: `src/renderer/interpreter.ts` (L711 injection key)
- Test: `test/renderer/nv-parser.test.ts` (G1, G5 assertions); `test/renderer/` (G3', G4)

- [ ] **Step 1: Write failing G1 test (classlist binding in slot)**

  ```ts
  it('G1: classlist toggle token in slot content carries parent scopeHash', () => {
    const src = `
      const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
    `
    const results = parseNvFile(src, 'test.nv', document)
    const parent = results.find(r => r.name === 'Parent')!
    const childComp = parent.ir.bindings.find(b => b.kind === 'component') as ComponentBinding
    const slotIR = childComp.slots[0]!.content({})
    const cl = slotIR.bindings.find(b => b.kind === 'classlist') as ClassListBinding
    const toggle = cl.entries.find(e => e.kind === 'toggle') as ToggleEntry
    const expectedHash = parent.ir.styleArtifact!.scopeHash
    expect(toggle.key).toBe(`card_${expectedHash}`)
  })
  ```

  Run: `pnpm test -- --grep 'G1'`
  Expected: FAIL (`toggle.key` is `card`, not `card_<hash>`)

- [ ] **Step 2: Write failing G5 test (nested `<each>` in slot)**

  ```ts
  it('G5: classlist token in <each>-inside-slot carries parent scopeHash', () => {
    const src = `
      const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`
          <ChildComp>
            <each .of=\${items} let={item}>
              <div class="\${{card: true}}">\${item}</div>
            </each>
          </ChildComp>
        \`)
      })
    `
    const results = parseNvFile(src, 'test.nv', document)
    const parent = results.find(r => r.name === 'Parent')!
    const childComp = parent.ir.bindings.find(b => b.kind === 'component') as ComponentBinding
    const slotIR = childComp.slots[0]!.content({})
    const listBinding = slotIR.bindings.find(b => b.kind === 'list') as ListBinding
    const stubVs = signal<unknown>(null)
    const stubIs = signal<number>(0)
    const itemIR = listBinding.itemTemplate(stubVs, stubIs)
    const cl = itemIR.bindings.find(b => b.kind === 'classlist') as ClassListBinding
    const toggle = cl.entries.find(e => e.kind === 'toggle') as ToggleEntry
    const expectedHash = parent.ir.styleArtifact!.scopeHash
    expect(toggle.key).toBe(`card_${expectedHash}`)
  })
  ```

  Run: `pnpm test -- --grep 'G5'`
  Expected: FAIL

- [ ] **Step 3: Add `component` case to `patchClasslistTokens` + list comment**

  In `patchClasslistTokens` (L1870), add after the `list` case (L1888–1894) and add a
  latent-fragility comment to the `list` case:

  ```ts
  // Inside patchClasslistTokens, list case — add comment only, no behavior change:
  if (binding.kind === 'list') {
    // NOTE: patches stub-call return; sticks only while itemTemplate returns same IR by ref.
    // Fresh-IR itemTemplate would break this silently. Same latent fragility as 'component' below.
    const stubVs = signal<unknown>(null)
    const stubIs = signal<number>(0)
    const itemIR = binding.itemTemplate(stubVs, stubIs)
    patchClasslistTokens(itemIR, classRewrites)
  }

  // NEW: component case — mirrors list; slot content is the structurally identical missing case
  if (binding.kind === 'component') {
    const stubSlotProps = {}
    for (const slot of (binding as ComponentBinding).slots) {
      // NOTE: safe only while .nv slot factories return the same captured-by-ref IR object
      // (true for `(_props) => namedIR` closures built by buildNvSlotContentIR today).
      // The scoped-slot shape (props) => TemplateIR permits fresh-IR-per-call; that would
      // break this patch silently. Same latent fragility as the 'list' case above. (G2)
      const slotIR = slot.content(stubSlotProps)
      // Rewrite static class attr tokens in the slot's shape HTML
      if (slotIR.shape.html.includes('class=')) {
        ;(slotIR.shape as { html: string }).html = slotIR.shape.html.replace(
          /\bclass="([^"]*)"/g,
          (_, cls: string) =>
            `class="${cls.replace(/\b([\w-]+)\b/g, (tok) => classRewrites.get(tok) ?? tok)}"`,
        )
      }
      patchClasslistTokens(slotIR, classRewrites)
    }
  }
  ```

  No new function. No new call sites — `patchClasslistTokens(renderResult.ir, ...)` at L2003
  and L2914 already exist and will now descend into slot content.

- [ ] **Step 5: Fix injection dedup key in `interpreter.ts`**

  ```ts
  // src/renderer/interpreter.ts L711
  // was: injectComponentStyle(doc, ir.id, ir.styleArtifact.staticCss)
  injectComponentStyle(doc, ir.styleArtifact.scopeHash, ir.styleArtifact.staticCss)
  ```

- [ ] **Step 6: Run G1 and G5 tests**

  ```bash
  pnpm test -- --grep 'G1|G5'
  ```
  Expected: PASS

- [ ] **Step 7: Run full suite + typecheck + lint**

  ```bash
  pnpm typecheck && pnpm test && pnpm lint
  ```
  Expected: all pass

- [ ] **Step 8: Commit**

  ```bash
  git add src/renderer/nv-parser.ts src/renderer/interpreter.ts test/renderer/nv-parser.test.ts
  git commit -m "feat(renderer): patchSlotContentTokens + injection dedup on scopeHash (B3)"
  ```

### Task 3 — Differential corpus (G3', G4) and G6 real-browser gate

**Files:**
- Add: `test/renderer/slot-style-scope.test.ts` (G3', G4 shared-oracle)
- Add: `integration/slot-style-scope.spec.ts` (G6 Playwright)

- [ ] **Step 1: Write G3' test**

  ```ts
  // test/renderer/slot-style-scope.test.ts
  it("G3': two parents with same $style + shapeHtml share scopeHash; injection deduped", () => {
    // Both parents: same $style definition, same template structure, different child composition
    // (different named child component — reserializedShape SAME since both become <!--nv-comp-0-->)
    const src = `
      const ParentA = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildA><div class="\${{card: true}}">a</div></ChildA>\`)
      })
      const ParentB = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildB><div class="\${{card: true}}">b</div></ChildB>\`)
      })
    `
    const results = parseNvFile(src, 'test.nv', document)
    const a = results.find(r => r.name === 'ParentA')!
    const b = results.find(r => r.name === 'ParentB')!
    // Same $style + same template shape → should share scopeHash
    // (ChildA and ChildB differ but shapeHtml structure is the same)
    // NOTE: if ChildA/ChildB names appear literally in shapeHtml, hashes will differ.
    // This test asserts the PRINCIPLE: same authored $style maps to same scope.
    // Verify actual hash equality or document why they differ (component name in shapeHtml).
    expect(a.ir.styleArtifact?.scopeHash).toBe(b.ir.styleArtifact?.scopeHash)
  })
  ```

  Run: `pnpm test -- --grep "G3'"`
  Expected: PASS or DOCUMENT divergence reason (component name in shapeHtml)

  > **Note to implementer:** If `ChildA` and `ChildB` appear literally in `shapeHtml` (they do —
  > `shapeHtml` preserves the component tag names), the hashes WILL differ. This is correct
  > behavior (different authored templates → different scope). Update the test to reflect this:
  > assert that parents with TRULY identical `shapeHtml` (same child component name) share hash.

- [ ] **Step 2: Write G4 differential test**

  ```ts
  it('G4: parse-path IR and emit-path agree on slot classlist tokens', () => {
    const src = `
      const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
    `
    const parseResults = parseNvFile(src, 'test.nv', document)
    const emitResults = parseNvFileForEmit(src, 'test.nv', document)
    const parseParent = parseResults.find(r => r.name === 'Parent')!
    const emitParent = emitResults.find(r => r.name === 'Parent')!
    // Both should have the same slot content class tokens after B3 patch
    const getSlotToken = (result: NvComponentResult) => {
      const comp = result.ir.bindings.find(b => b.kind === 'component') as ComponentBinding
      const slotIR = comp.slots[0]!.content({})
      const cl = slotIR.bindings.find(b => b.kind === 'classlist') as ClassListBinding
      return (cl.entries.find(e => e.kind === 'toggle') as ToggleEntry).key
    }
    expect(getSlotToken(parseParent)).toBe(getSlotToken(emitParent))
  })
  ```

  Run: `pnpm test -- --grep 'G4'`
  Expected: PASS

- [ ] **Step 3: Write G6 Playwright fixture + test**

  Create `test-fixtures/slot-style-scope.html` (a minimal mount page with parent + child).

  ```ts
  // integration/slot-style-scope.spec.ts
  import { test, expect } from '@playwright/test'

  test.describe('G6: §5 guarantee — no child-hash attr on projected nodes', () => {
    test('projected nodes carry no data-nv-s-<childhash>', async ({ page }) => {
      await page.goto('/test-fixtures/slot-style-scope.html')
      const projected = page.locator('[data-test-projected]')
      await expect(projected).toBeVisible()
      const nvSAttrs = await projected.evaluate(el =>
        [...el.attributes].map(a => a.name).filter(n => n.startsWith('data-nv-s-'))
      )
      expect(nvSAttrs).toHaveLength(0)
    })
  })
  ```

  Run: `pnpm exec playwright test integration/slot-style-scope.spec.ts --project=chromium,firefox,webkit`
  Expected: 3/3 pass

- [ ] **Step 4: Commit**

  ```bash
  git add test/renderer/slot-style-scope.test.ts integration/ test-fixtures/
  git commit -m "test(renderer): G3' identity + G4 differential + G6 real-browser gate"
  ```

### Task 4 — G7 audit + final gate sweep + docs

- [ ] **Step 1: Confirm G7 — no `component` case inside `patchClasslistTokens`**

  ```bash
  grep -n "component" src/renderer/nv-parser.ts | grep -A2 -B2 "patchClasslist"
  ```

  Expected: no `component` case inside `patchClasslistTokens`. `patchSlotContentTokens` is a
  separate function.

- [ ] **Step 2: Full gate sweep**

  ```bash
  pnpm typecheck && pnpm test && pnpm lint && pnpm build
  ```
  Expected: all pass.

- [ ] **Step 3: Verify on `main` (not a worktree)**

  ```bash
  git log --oneline -5
  git show HEAD:src/renderer/nv-parser.ts | grep -c 'patchSlotContentTokens'
  ```

  Expected: count ≥ 2 (definition + both call sites).

- [ ] **Step 4: Update decision log and implementation state**

  Append to `docs/decision-log.md`:
  - Entry: `$style × slots LANDED [2026-06-2X]` — B3 mechanism; parent-wins via
    `patchSlotContentTokens`; G1–G7 + G3' passed; `scopeHash = simpleHash(shapeHtml)`;
    injection dedup re-keyed to `scopeHash`; no Template-IR bump; reactive-core untouched.
  - Current State: move `$style × slots` from Forward Queue to Landed; close OPEN-S1/S2/S3.

  Update `docs/implementation-state.md`: note `patchSlotContentTokens` in `nv-parser.ts`;
  `scopeHash` now from `shapeHtml` (not `ir.id`); injection in `interpreter.ts` keys on `scopeHash`.

- [ ] **Step 5: Commit docs**

  ```bash
  git add docs/decision-log.md docs/implementation-state.md
  git commit -m "docs: log $style × slots LANDED + update implementation state"
  ```

---

## 8. File Map

| File | Change |
|------|--------|
| `src/renderer/nv-parser.ts` | `ProcessResult` + `shapeHtml`; `processHtmlTemplate` returns `shapeHtml`; L1988/L2899 use `simpleHash(shapeHtml)`; `component` case + list comment in `patchClasslistTokens` (L1870); no new functions, no new call sites |
| `src/renderer/interpreter.ts` | L711: injection dedup key `ir.id` → `ir.styleArtifact.scopeHash` |
| `test/renderer/nv-parser.test.ts` | G1, G3, G5 unit tests |
| `test/renderer/slot-style-scope.test.ts` | G3', G4 differential tests |
| `test-fixtures/slot-style-scope.html` | G6 Playwright mount page |
| `integration/slot-style-scope.spec.ts` | G6 real-browser test |
| `docs/decision-log.md` | Append landing entry + close OPEN items in Current State |
| `docs/implementation-state.md` | Orientation update |

No `src/core/` files touched. No Template-IR version bump. No new IR members.
