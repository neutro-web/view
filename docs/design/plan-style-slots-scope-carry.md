# `$style × slots` Scope-Carry — Implementation Plan (Gate P)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⛔ HALT — this plan requires architect approval before any `src/` touch.**
> See §OPEN-S1: the B1/B2 seed choice is unresolved. Do NOT proceed past Gate P
> until the architect rules on OPEN-S1 and confirms OPEN-S2/S3.

**Goal:** Make class-form `$style` tokens authored in parent-supplied slot content carry
the parent's scope hash, on both front-ends and both back-ends.

**Architecture:** Build-time rewrite (Mechanism B) — apply `classRewrites` map to slot-content
tokens at IR construction time inside `buildNvSlotContentIR`. One rewrite site per path; no
second walk; no Mechanism A (ruled out by spec §4). Seed mechanism (B1 or B2) is OPEN — see
OPEN-S1 below.

**Tech Stack:** TypeScript, nv-parser.ts (renderer workstream), existing ir-equivalence +
emit-exec gate harness. No reactive-core touch. No Template-IR version bump expected.

**HEAD SHA at plan write:** `82c2f40102131dbb71212372c04361f84c9407a5`

## Global Constraints

- No `src/core/` touch — reactive-core is untouched by this increment.
- No `::slotted` analog — §5 ruling (NO, reading (b)) is locked; do not add cascade-defeating logic.
- Both back-ends (parse-path `parseNvFile` and emit-path `parseNvFileForEmit`/`emitModule`) must
  receive the same fix at the same insertion site (differential conformance).
- Misclassification must fall safe (soundness fallback; compiler license).
- Injection through passed `doc` parameter — unchanged from S1+S2.
- `patchClasslistTokens` must NOT gain a `component` case that re-derives rewrite logic
  (that is Mechanism A's degraded form; the slot subsystem was bitten by this pattern 4×).
- Done = committed and on `main`. "Tests green" is not done.

---

## 1. Seams Cited at HEAD

All line numbers verified against HEAD `82c2f40` in `src/renderer/nv-parser.ts`.

### 1.1 `buildNvSlotContentIR` — slot-content IR builder (parse path entry point)

**File:** `src/renderer/nv-parser.ts` **L740–800**

```
function buildNvSlotContentIR(
  slotNodes: Node[],
  holeExprs: ts.Expression[],
  doc: Document,
  slotId: string,
  signals: ReadonlySet<string>,
  letNames: string[] = [],
): { ir: TemplateIR; holeIndices: number[]; letNames: string[] }
```

- Called during the DFS walk (`walkNvNodeList`) for each slot encountered on a component element.
- Clones the slot DOM nodes (L764 `n.cloneNode(true)`), runs a nested `walkNvNodeList`, and
  builds a `TemplateIR` for the slot content.
- Returns `ir` (the built IR), `holeIndices`, `letNames`.
- **Critical:** receives NO `classRewrites` parameter today. Class tokens in slot content are
  built raw and never rewritten.

### 1.2 Named/default slot capture sites (parse path)

**File:** `src/renderer/nv-parser.ts` **L644–682**

Default slot:
```
L649: const { ir: defaultIR, holeIndices, letNames: defaultLetNames } = buildNvSlotContentIR(
        defaultNodes, holeExprs, doc, `slot:${tagName}:default`, signals)
L656: const defaultContent: SlotContent = (_props) => defaultIR   // closure captures defaultIR
```

Named slots:
```
L669: const { ir: namedIR, holeIndices, letNames: namedLetNamesResult } = buildNvSlotContentIR(
        slotChildNodes, holeExprs, doc, `slot:${tagName}:${slotName}`, signals, slotLet)
L677: const namedContent: SlotContent = (_props) => namedIR        // closure captures namedIR
```

The closure `(_props) => namedIR` captures `namedIR` BY REFERENCE. Patching `namedIR` in-place
AFTER this capture (Mechanism A parse variant) works only while the factory returns the same
captured object — it breaks when the factory is a scoped-slot factory that builds fresh IR per
call (G2 failure case). Mechanism B requires the rewrite to occur INSIDE `buildNvSlotContentIR`
before this capture.

### 1.3 Emit-path slot ThunkSource build

**File:** `src/renderer/nv-parser.ts` **L2569–2601** (inside `computeBindingThunks`)

```
slots: pc.slots.map((slot, slotIdx) => {
  const holeIndices = pc.slotHoleGroups[slotIdx] ?? []
  ...
  const thunks: ThunkSource[] = holeIndices.map((holeIdx) => {
    return computeThunkSource(holeExpr, positions[holeIdx], doc, symbols, ...)
  })
  return { name: slot.name, holeIndices: [...holeIndices], thunks, ... }
})
```

The emit path builds `ThunkSource[]` (JS expression source strings) from hole indices. It does
NOT re-invoke `slot.content()`'s IR — it operates on `holeExprs` (the original TS AST
expressions) from the template. The slot content's `ir.shape.html` and classlist binding tokens
are therefore NOT touched here. The same `ir` object built by `buildNvSlotContentIR` is what
drives static HTML emission. **Gap: same as parse path — no class-form token rewrite.**

### 1.4 `buildStyleArtifact` — `classRewrites` construction

**File:** `src/renderer/nv-parser.ts` **L1742–1804**

```
function buildStyleArtifact(info: NvStyleInfo, scopeHash: string, symbols: ScriptSymbols):
  { staticCss: string; varBindingDescs: VarBindingDesc[]; classRewrites: Map<string, string> }
```

- Iterates `info.objExpr.properties` (the `$style({...})` literal keys).
- For class-form keys: `classRewrites.set(token, `${token}_${scopeHash}`)` (L1784, L1795).
- `classRewrites` is purely static: depends only on `$style` key names + `scopeHash` (F5 from
  spec). No reactive dependency, no render-IR walk.
- Returns `classRewrites` as a `Map<string, string>`.

### 1.5 `patchClasslistTokens` call sites — parse path and emit path

**Parse path:** `src/renderer/nv-parser.ts` **L1988–2004**

```
L1988: const scopeHash = simpleHash(renderResult.ir.id)
L1990: const artifact = buildStyleArtifact(styleInfo, scopeHash, symbols)
L2003: patchClasslistTokens(renderResult.ir, artifact.classRewrites)   // ← TOP-LEVEL IR ONLY
L2004: renderResult.ir.classRewrites = artifact.classRewrites
```

**Emit path:** `src/renderer/nv-parser.ts` **L2899–2915**

```
L2899: const scopeHash = simpleHash(renderResult.ir.id)
L2901: const artifact = buildStyleArtifact(styleInfo, scopeHash, symbols)
L2914: patchClasslistTokens(renderResult.ir, artifact.classRewrites)   // ← TOP-LEVEL IR ONLY
L2915: renderResult.ir.classRewrites = artifact.classRewrites
```

**Gap confirmed:** `patchClasslistTokens` (L1870–1897) handles `classlist`, `conditional`, and
`list` binding kinds. It has **no `component` case** — it never descends into
`ComponentBinding.slots[].content`. Slot content IR is invisible to the current patch walk.

### 1.6 `simpleHash(renderResult.ir.id)` — the seed coupling (F6)

**File:** `src/renderer/nv-parser.ts` **L2938–2942**

```
function simpleHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}
```

`renderResult.ir.id` is set at L1101 (template with holes):
```
id: `nv:${simpleHash(reserializedShape)}`
```

where `reserializedShape` (L1094) is computed from `shapeDiv.innerHTML` AFTER the full DFS walk
— component elements have been replaced by anchor comments (`<!--nv-comp-0-->`), and hole
attribute sentinels stripped.

For no-substitution templates (L950): `id: 'nv:' + simpleHash(template.text)` — pre-walk.

**Key constraint:** `reserializedShape` is only available after `walkNvNodeList` returns.
`buildNvSlotContentIR` is called DURING `walkNvNodeList`. Therefore `ir.id` (and thus
`scopeHash`) is not available at slot-build time. This is the circular dependency that makes
vanilla B1 impossible without restructuring.

### 1.7 `shapeHtml` — the pre-walk structural HTML

**File:** `src/renderer/nv-parser.ts` **L974** (via `buildNvHtmlStrings` L835–888)

```
const { sentinelHtml, shapeHtml } = buildNvHtmlStrings(strings, positions)
```

`shapeHtml` strips `data-nv-attr-*`, `data-nv-prop-*`, `data-nv-event-*`, and
`data-nv-component` sentinel attributes. It is computed BEFORE `walkNvNodeList`. It preserves
the component element structure (including slot content children) — unlike `reserializedShape`
which replaces component elements with anchor comments.

For templates with child components: `shapeHtml ≠ reserializedShape`. For templates without
child components: they are equal (no component elements to replace).

---

## 2. OPEN-S1 — B1 Seed Proposal and G3 Equality Analysis

**⚠️ HALT POINT — architect must choose B1a, B1b, or B2 before implementation.**

### 2.1 Circular dependency analysis

`classRewrites` requires `scopeHash = simpleHash(renderResult.ir.id)`.  
`renderResult.ir.id` requires the full walk to complete (L1101 post-walk).  
`buildNvSlotContentIR` is called DURING the walk.  
Therefore: `classRewrites` cannot be in hand at slot-build time without restructuring.

Vanilla B1 (ir.id derivation unchanged, pre-walk seed that happens to equal
`simpleHash(ir.id)`) is **not achievable** — no pre-walk input deterministically equals
`simpleHash(reserializedShape)` without running the walk.

### 2.2 Option B1a — Change ir.id seed to `shapeHtml` (preferred B1 variant)

**Change:** In `processHtmlTemplate`, replace:
```ts
// L1101 — current
id: `nv:${simpleHash(reserializedShape)}`,
```
with:
```ts
// B1a proposed
id: `nv:${simpleHash(shapeHtml)}`,
```

**Why this satisfies G3:** `shapeHtml` is computed at L974 before the walk. Pre-compute
`scopeHash = simpleHash('nv:' + simpleHash(shapeHtml))` at L974 after `buildNvHtmlStrings`.
Pass `scopeHash` (or the `classRewrites` map built from it) into `buildNvSlotContentIR` for
each slot. G3: `seed = simpleHash(ir.id) = simpleHash('nv:' + simpleHash(shapeHtml))` by
construction — equals the pre-computed value.

**Impact:**
- `shapeHtml` contains component element children (slot content HTML); `reserializedShape`
  replaces them with `<!--nv-comp-0-->` anchors. Any component template that has child
  components will get a different `ir.id` and thus a different `scopeHash` than today.
- All static CSS class rewrite hashes change for affected components → existing gate
  expectations for scope-hashed class names need updating.
- For components without child component elements: `shapeHtml ≈ reserializedShape` → scope
  hashes unchanged.
- `shapeHtml` is strictly MORE unique as an ID (it incorporates slot content structure), which
  is semantically sound: two parent templates that differ only in slot content get distinct hashes.

**Risk:** Existing tests asserting specific `_<hash>` suffix values on parent components with
child components will fail and need expected-value updates.

**No-substitution template edge case:** `id: 'nv:' + simpleHash(template.text)` (L950) is
already pre-walk and unchanged. No issue.

### 2.3 Option B2 — Two-pass (fallback if B1a is unacceptable)

**Change:** Separate slot-node collection from slot-IR construction.

- During `walkNvNodeList`, save raw slot node lists in `PendingNvComponentInfo` instead of
  calling `buildNvSlotContentIR` eagerly. Use `SlotContent = undefined` as a placeholder.
- After `walkNvNodeList` returns, compute `ir.id`, `scopeHash`, and `classRewrites`.
- Then call `buildNvSlotContentIR` for each saved slot node list WITH `classRewrites` in hand.
- Replace placeholder `SlotContent` with the now-properly-built IR.

**Why this works:** Slot nodes are cloned inside `buildNvSlotContentIR` (L764), so the raw node
lists can be saved and re-passed after the walk. `ir.id` derivation is unchanged.

**Heavier:** Requires changes to `walkNvNodeList`'s return type / `PendingNvComponentInfo` to
carry raw node lists. Emit and parse paths both call `processHtmlTemplate` (through
`extractRenderTemplate`) — both would benefit from the same restructure.

**CC recommends B1a** (simpler code path; shapeHtml is a more stable identity basis for
components with children). CC proposes B2 only if the hash-change impact of B1a is unacceptable.

---

## 3. Single-Rewrite-Site Design (OPEN-S2)

Both paths share the same `buildNvSlotContentIR` function. The fix is ONE insertion site in
that function, effective for both parse and emit paths. No `component` case added to
`patchClasslistTokens`.

### 3.1 Parse path rewrite site

After `classRewrites` is available (pre-walk via B1a, or post-walk passed in via B2):

In `buildNvSlotContentIR`, after `rawHtml` is computed (L775) and before the function returns:

```ts
// 1. Rewrite static class tokens in the shape HTML string
let rewrittenHtml = rawHtml
if (classRewrites && classRewrites.size > 0) {
  rewrittenHtml = rawHtml.replace(
    /\bclass="([^"]*)"/g,
    (_, cls: string) =>
      `class="${cls.replace(/\b(\w+)\b/g, (tok) => classRewrites.get(tok) ?? tok)}"`,
  )
}

// 2. Patch classlist binding entries in the built IR
const ir: TemplateIR = {
  id: slotId,
  shape: { html: rewrittenHtml, bindingPaths: allPaths as NodePath[] },
  bindings,
}
if (classRewrites && classRewrites.size > 0) {
  patchClasslistTokens(ir, classRewrites)
}
return { ir, holeIndices: ..., letNames }
```

**Signature change:**
```ts
function buildNvSlotContentIR(
  slotNodes: Node[],
  holeExprs: ts.Expression[],
  doc: Document,
  slotId: string,
  signals: ReadonlySet<string>,
  letNames?: string[],
  classRewrites?: Map<string, string>,  // ← added
): { ir: TemplateIR; holeIndices: number[]; letNames: string[] }
```

All existing callers (including `<each>` body via L558) pass `undefined` for `classRewrites` —
no behavior change for non-slot contexts. Slot callers at L649 and L669 pass the parent's
`classRewrites` once available.

**G7 confirmation:** Only ONE descent into `buildNvSlotContentIR` — no second walk, no parallel
path. `patchClasslistTokens` is called directly on the slot IR immediately after construction.

### 3.2 Emit path rewrite site

The emit path uses `renderResult.ir` (the same IR built by `processHtmlTemplate`). Slot content
appears in `ComponentBinding.slots[].content` factories. The ThunkSource build (L2569–2601)
operates on `holeExprs`, not on the slot IR's bindings. The slot IR's `shape.html` and classlist
binding entries are emitted via the IR object.

With `buildNvSlotContentIR` receiving `classRewrites` (same function, same fix), the emit path
is fixed for free — both call `processHtmlTemplate` which calls `walkNvNodeList` which calls
`buildNvSlotContentIR`. No separate emit-path insertion point needed.

**OPEN-S2 proposed resolution:** Single insertion in `buildNvSlotContentIR` (signature +
body) covers both paths. Architect confirm.

---

## 4. Differential Corpus (OPEN-S3)

### 4.1 Proposed: extend the existing ir-equivalence + emit-exec harness

The existing harness (`test/renderer/` ir-equivalence + emit-exec) provides the shared-oracle
infrastructure. Propose reuse with new `.nv` fixture files. No new harness needed.

### 4.2 Fixture cases required

| Case | Fixture content | Gate covered |
|------|----------------|--------------|
| **Base** | Parent `$style({card: {color:'red'}})` + default slot content `<div class="${{card: true}}">…</div>` | G1, G4 |
| **Named slot** | Same but with named `<slot name="header">` | G1, G4 |
| **Fresh-IR factory** | Slot factory that spreads `{...baseIR}` per call (simulated by test setup) | G2 |
| **Nested `<each>`** | `<each>` inside slot content, body with classlist token | G5 |
| **Static class string** | Slot content `<div class="card">` (static HTML attr, not classlist binding) | G1 (static) |
| **Child-wins rejected** | Assert no `data-nv-s-<childhash>` on projected nodes | G6 |

**OPEN-S3 proposed resolution:** Reuse existing harness; add 6 new test cases in
`test/renderer/` using existing fixture pattern. Architect confirm.

---

## 5. Per-Phase Gate Tables (Gates G1–G7)

All gates restate spec §7 with evidence commands and failure conditions.

| ID | Check | Evidence command | Fails if |
|----|-------|-----------------|----------|
| **G1** | Parent class-form token in slot content carries **parent** hash on mounted node | `mount(ParentWithSlot, el); inspect el.querySelector('.card_<parenthash>')` | class is raw `card` or `card_<childhash>` |
| **G2** | Fresh-IR-factory slot content still rewritten (the case Mechanism A passes structurally but fails at runtime) | Fixture where factory returns `{...spread}` per call; mount; inspect class | rewrite absent when factory returns non-captured IR |
| **G3** | B1a: `simpleHash('nv:' + simpleHash(shapeHtml)) === simpleHash(ir.id)` at build time | `assert seed === simpleHash(renderResult.ir.id)` in unit test | seeds diverge — static CSS uses one hash, slot rewrite uses another |
| **G4** | Parse-path IR ↔ emit-path output agree on slot-content class tokens (shared oracle: ir-equivalence + emit-exec on same corpus) | run `pnpm test -- ir-equivalence emit-exec` on new fixtures | any token disagrees between parse and emit |
| **G5** | Class-form token inside `<each>` nested in slot content is rewritten (OPEN-7 × slots, depth-2) | Depth-2 fixture: `<each>` body with `class="${{card: true}}"` in slot; mount; inspect | nested token is raw |
| **G6** | §5 guarantee: nv places NO `data-nv-s-<childhash>` on parent-projected nodes; incidental cascade match is NOT a defect (real-browser ×3) | Playwright Blink/Gecko/WebKit: inspect projected node attrs | `data-nv-s-<childhash>` appears on a projected node, OR a test asserts non-match of cascade |
| **G7** | One rewrite site per path; no parallel walk added | `grep -n 'component' src/renderer/nv-parser.ts \| grep -i 'patch\|walk\|slot'` shows no new component-descent outside `buildNvSlotContentIR` | a second component-descent re-derives rewrite logic |

**G6 is real-browser REQUIRED** — jsdom is not authoritative for `data-nv-s-*` attribute and
cascade behavior. Playwright against Blink/Gecko/WebKit. G2 and G5 are the load-bearing
correctness cases (the ones Mechanism A passes structurally while emitting wrong DOM).

---

## 6. Locked-Constraint Confirmations (G0)

| Constraint | Confirmed? |
|-----------|-----------|
| No `src/core/` touch | ✓ — change is entirely in `src/renderer/nv-parser.ts` |
| No reactive-core touch | ✓ — rewrite is static, no tracked read, no write-during-propagation |
| Injection through passed `doc` | ✓ — `buildNvSlotContentIR` already receives `doc`; unchanged |
| nv-does-not-invent-CSS (§5 reading (b)) | ✓ — no `data-nv-s-<childhash>` ever placed on projected nodes |
| No cascade-defeating logic | ✓ — nv routes and rewrites; does not police cascade |
| Misclassification falls safe | ✓ — if token not in classRewrites, no rewrite (safe fallback: token stays raw) |
| Both back-ends differential | ✓ — single insertion in `buildNvSlotContentIR` covers both parse + emit |
| No `component` case in `patchClasslistTokens` | ✓ — slot rewrite is in `buildNvSlotContentIR`, not in `patchClasslistTokens` |
| Template-IR version bump | ✓ not needed — no new IR member; `SlotContent`/`SlotEntry`/`SlotOutletBinding` shapes unchanged |

---

## 7. Implementation Tasks (Post-Architect-Approval)

> **Do NOT start these tasks until architect approves the plan and rules on OPEN-S1.**
> Gate P is the hard gate. Proceeding to code pre-approval is a G0 disqualifier.

### Task 1 — B1a seed mechanism (or B2 restructure)

**Files:**
- Modify: `src/renderer/nv-parser.ts` (L974 area for B1a; or L740/walkNvNodeList area for B2)
- Test: `test/renderer/nv-parser.test.ts` (G3 assertion)

**If B1a chosen:**

- [ ] **Step 1: Understand current ir.id derivation**

  Read `src/renderer/nv-parser.ts` L970–1105. Confirm `shapeHtml` is available at L974 before
  `walkNvNodeList` is called.

- [ ] **Step 2: Write a failing G3 test**

  ```ts
  // test/renderer/nv-parser.test.ts
  it('G3: B1a seed equals simpleHash(ir.id) for template with child component', () => {
    const src = `
      const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
    `
    const results = parseNvFile(src, 'test.nv', document)
    const parent = results.find(r => r.name === 'Parent')!
    const ir = parent.ir
    // scopeHash used for class rewrites must equal simpleHash(ir.id)
    const scopeHash = ir.classRewrites
      ? [...ir.classRewrites.values()][0]?.split('_').pop()
      : undefined
    expect(scopeHash).toBe(simpleHash(ir.id))
  })
  ```

  Run: `pnpm test -- --grep G3`
  Expected: FAIL (scopeHash from classRewrites will diverge from simpleHash(ir.id) until B1a lands)

- [ ] **Step 3: Implement B1a — change ir.id seed**

  In `processHtmlTemplate` (`src/renderer/nv-parser.ts` ~L970–1105):
  ```ts
  const { sentinelHtml, shapeHtml } = buildNvHtmlStrings(strings, positions)
  // B1a: pre-walk scope seed (shapeHtml is available before walkNvNodeList)
  const preWalkScopeHash = simpleHash(`nv:${simpleHash(shapeHtml)}`)
  ```

  Change `ir.id` at L1101:
  ```ts
  // was: id: `nv:${simpleHash(reserializedShape)}`,
  id: `nv:${simpleHash(shapeHtml)}`,
  ```

  This makes `simpleHash(ir.id) = simpleHash('nv:' + simpleHash(shapeHtml)) = preWalkScopeHash`.

- [ ] **Step 4: Pass `preWalkScopeHash` down to slot-build call sites**

  Thread `preWalkScopeHash` through `walkNvNodeList` → slot-build calls in `walkNvNodeList`.
  Or: compute it once in `processHtmlTemplate` and pass it to a thin wrapper around
  `buildNvSlotContentIR`. Design choice is in-stream; pick whichever minimizes diff.

- [ ] **Step 5: Confirm G3 test passes**

  Run: `pnpm test -- --grep G3`
  Expected: PASS

- [ ] **Step 6: Run full suite; update hash expectations for affected fixtures**

  ```bash
  pnpm test 2>&1 | grep -E 'FAIL|expected|received' | head -40
  ```

  For any test asserting a specific `_<hash>` value on a component with child components:
  update the expected hash to the new B1a value. Document which fixtures changed in the
  commit message.

- [ ] **Step 7: Commit**

  ```bash
  git add src/renderer/nv-parser.ts test/renderer/nv-parser.test.ts
  git commit -m "feat(renderer): B1a — derive ir.id from shapeHtml for pre-walk scope seed"
  ```

### Task 2 — `buildNvSlotContentIR` rewrite insertion

**Files:**
- Modify: `src/renderer/nv-parser.ts` L740–800 (`buildNvSlotContentIR`), L649/L669 (call sites)
- Test: `test/renderer/nv-parser.test.ts` (G1, G2, G5 assertions)

- [ ] **Step 1: Write failing G1 test**

  ```ts
  it('G1: parent class-form token in slot content carries parent hash', () => {
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
    const classlistBinding = slotIR.bindings.find(b => b.kind === 'classlist') as ClassListBinding
    const toggleEntry = classlistBinding.entries.find(e => e.kind === 'toggle')!
    const scopeHash = simpleHash(parent.ir.id)
    expect((toggleEntry as ToggleEntry).key).toBe(`card_${scopeHash}`)
  })
  ```

  Run: `pnpm test -- --grep G1`
  Expected: FAIL (`key` is `card`, not `card_<hash>`)

- [ ] **Step 2: Write failing G2 test (fresh-IR-factory)**

  ```ts
  it('G2: fresh-IR-factory slot content is still rewritten', () => {
    // Simulate a factory that returns fresh IR per call via object spread.
    // This tests that the rewrite happens at build time (inside buildNvSlotContentIR),
    // not post-capture on the returned object reference.
    // Since parseNvFile builds `(_props) => namedIR` (captured by ref), we test the
    // invariant: calling content({}) twice returns IR where tokens are ALREADY rewritten,
    // regardless of whether the same object or a fresh one is returned.
    const src = `
      const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
    `
    const results = parseNvFile(src, 'test.nv', document)
    const parent = results.find(r => r.name === 'Parent')!
    const childComp = parent.ir.bindings.find(b => b.kind === 'component') as ComponentBinding
    // Call content factory twice — both calls must return rewritten tokens
    const ir1 = childComp.slots[0]!.content({})
    const ir2 = childComp.slots[0]!.content({})
    const getKey = (ir: TemplateIR) =>
      (ir.bindings.find(b => b.kind === 'classlist') as ClassListBinding)
        .entries.find(e => e.kind === 'toggle')!
    const scopeHash = simpleHash(parent.ir.id)
    expect((getKey(ir1) as ToggleEntry).key).toBe(`card_${scopeHash}`)
    expect((getKey(ir2) as ToggleEntry).key).toBe(`card_${scopeHash}`)
  })
  ```

  Run: `pnpm test -- --grep G2`
  Expected: FAIL

- [ ] **Step 3: Write failing G5 test (nested `<each>` in slot)**

  ```ts
  it('G5: class-form token in <each>-inside-slot is rewritten', () => {
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
    const classlistBinding = itemIR.bindings.find(b => b.kind === 'classlist') as ClassListBinding
    const toggleEntry = classlistBinding.entries.find(e => e.kind === 'toggle')!
    const scopeHash = simpleHash(parent.ir.id)
    expect((toggleEntry as ToggleEntry).key).toBe(`card_${scopeHash}`)
  })
  ```

  Run: `pnpm test -- --grep G5`
  Expected: FAIL

- [ ] **Step 4: Implement — add `classRewrites` param to `buildNvSlotContentIR`**

  In `src/renderer/nv-parser.ts` L740, change signature:
  ```ts
  function buildNvSlotContentIR(
    slotNodes: Node[],
    holeExprs: ts.Expression[],
    doc: Document,
    slotId: string,
    signals: ReadonlySet<string>,
    letNames: string[] = [],
    classRewrites?: Map<string, string>,   // ← add
  ): { ir: TemplateIR; holeIndices: number[]; letNames: string[] }
  ```

- [ ] **Step 5: Apply rewrite inside `buildNvSlotContentIR`**

  After the existing `rawHtml` computation (L775) and before building `ir`:
  ```ts
  // Rewrite static class attribute tokens in slot shape HTML
  let rewrittenHtml = rawHtml
  if (classRewrites && classRewrites.size > 0) {
    rewrittenHtml = rawHtml.replace(
      /\bclass="([^"]*)"/g,
      (_, cls: string) =>
        `class="${cls.replace(/\b([\w-]+)\b/g, (tok) => classRewrites!.get(tok) ?? tok)}"`,
    )
  }
  ```

  Build `ir` using `rewrittenHtml` (instead of `rawHtml`).

  After building `ir` and before the return:
  ```ts
  if (classRewrites && classRewrites.size > 0) {
    patchClasslistTokens(ir, classRewrites)
  }
  ```

- [ ] **Step 6: Thread `classRewrites` to slot call sites**

  At L649 (default slot call site) and L669 (named slot call site), pass the `classRewrites`
  that is available at that point (post-walk via B1a or via B2 depending on architect ruling):

  ```ts
  // B1a: classRewrites built from preWalkScopeHash, passed in from processHtmlTemplate
  buildNvSlotContentIR(defaultNodes, holeExprs, doc, `slot:${tagName}:default`,
    signals, undefined, classRewrites)
  ```

  The `classRewrites` map is built from `buildStyleArtifact(styleInfo, preWalkScopeHash, symbols)`
  — callable pre-walk because `buildStyleArtifact` only needs `$style` keys + `scopeHash` (F5).

  Also update the `<each>` body call at L558 — pass `undefined` (no `$style` tokens rewrite on
  each body; `$style` tokens in `<each>` body in top-level IR are already handled by the
  post-walk `patchClasslistTokens`).

- [ ] **Step 7: Run G1, G2, G5 tests**

  ```bash
  pnpm test -- --grep 'G1|G2|G5'
  ```
  Expected: PASS

- [ ] **Step 8: Run full test suite + typecheck + lint**

  ```bash
  pnpm typecheck && pnpm test && pnpm lint
  ```
  Expected: all pass (or only hash-expectation failures from Task 1 already addressed)

- [ ] **Step 9: Commit**

  ```bash
  git add src/renderer/nv-parser.ts test/renderer/nv-parser.test.ts
  git commit -m "feat(renderer): apply classRewrites to slot content at build time (Mechanism B)"
  ```

### Task 3 — Differential corpus (G4) and G6 real-browser gate

**Files:**
- Add: `test/renderer/slot-style-differential.test.ts` (G4 shared-oracle)
- Add: `integration/slot-style-scope.spec.ts` (G6 Playwright real-browser)

- [ ] **Step 1: Write G4 differential test (parse ↔ emit agree on slot class tokens)**

  ```ts
  // test/renderer/slot-style-differential.test.ts
  import { parseNvFile, parseNvFileForEmit } from '../../src/renderer/nv-parser'
  import { irEquivalence } from './helpers/ir-equivalence'

  const FIXTURE = `
    const Parent = $component((_props) => {
      $style({ card: { color: 'red' } })
      $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
    })
  `

  it('G4: parse-path IR and emit-path output agree on slot-content class tokens', () => {
    const parseResults = parseNvFile(FIXTURE, 'test.nv', document)
    const emitResults = parseNvFileForEmit(FIXTURE, 'test.nv', document)
    const parseParent = parseResults.find(r => r.name === 'Parent')!
    const emitParent = emitResults.find(r => r.name === 'Parent')!
    // Both should have the same slot classRewrites-patched IR shape
    irEquivalence(parseParent.ir, emitParent.ir)
  })
  ```

  Run: `pnpm test -- slot-style-differential`
  Expected: PASS

- [ ] **Step 2: Write G6 Playwright test (no child-hash attr on projected nodes)**

  ```ts
  // integration/slot-style-scope.spec.ts
  import { test, expect } from '@playwright/test'

  test.describe('G6: no data-nv-s-<childhash> on parent-projected nodes', () => {
    test('Blink/Gecko/WebKit: projected nodes carry no child scope hash', async ({ page }) => {
      // Mount a parent with $style + child component; inspect projected nodes
      await page.goto('/test-fixtures/slot-style-scope.html')
      const projectedNode = page.locator('[data-test-projected]')
      await expect(projectedNode).toBeVisible()
      // Must NOT have any data-nv-s-* attribute (child-scope tagging)
      const attrs = await projectedNode.evaluate(el =>
        [...el.attributes].map(a => a.name).filter(n => n.startsWith('data-nv-s-'))
      )
      expect(attrs).toHaveLength(0)
    })
  })
  ```

  Run: `pnpm exec playwright test integration/slot-style-scope.spec.ts --project=chromium,firefox,webkit`
  Expected: 3/3 pass (no `data-nv-s-<childhash>` on projected nodes)

- [ ] **Step 3: Commit**

  ```bash
  git add test/renderer/slot-style-differential.test.ts integration/slot-style-scope.spec.ts
  git commit -m "test(renderer): G4 differential + G6 real-browser gate for slot style scope"
  ```

### Task 4 — G7 audit and final gate pass

- [ ] **Step 1: Confirm G7 — no second walk**

  ```bash
  grep -n 'component\|patchClasslist' src/renderer/nv-parser.ts | grep -v '// ' | grep -i 'walk\|patch\|slot\|descent'
  ```

  Confirm no new `component` case in `patchClasslistTokens` and no second walk for slot content.

- [ ] **Step 2: Full gate sweep**

  ```bash
  pnpm typecheck && pnpm test && pnpm lint && pnpm build
  ```
  Expected: all pass.

- [ ] **Step 3: Verify on main**

  ```bash
  git log --oneline -5
  git show HEAD:src/renderer/nv-parser.ts | grep -A5 'buildNvSlotContentIR'
  ```

  Confirm changes are committed and on `main` (not a worktree copy).

- [ ] **Step 4: Update decision log**

  Append to `docs/decision-log.md`:
  - New entry: `$style × slots LANDED [2026-06-2X]` — parent-wins scope carry via Mechanism B,
    B1a seed (or B2 if ruled), gates G1–G7 passed.
  - Update Current State: note `$style × slots` landed; close `OPEN-S1/S2/S3`; no Template-IR
    version bump confirmed.

  Update `docs/implementation-state.md`: note slot content class-form tokens are now rewritten
  at build time by `buildNvSlotContentIR`.

- [ ] **Step 5: Commit docs**

  ```bash
  git add docs/decision-log.md docs/implementation-state.md
  git commit -m "docs: log $style × slots scope-carry landing + update implementation state"
  ```

---

## 8. File Map

| File | Change | Reason |
|------|--------|--------|
| `src/renderer/nv-parser.ts` | `buildNvSlotContentIR` signature + body; `processHtmlTemplate` ir.id (B1a) or walk restructure (B2); slot call sites at L649/L669 | Core fix |
| `test/renderer/nv-parser.test.ts` | G1, G2, G3, G5 unit tests | Gate coverage |
| `test/renderer/slot-style-differential.test.ts` | G4 parse↔emit shared-oracle | Differential conformance |
| `integration/slot-style-scope.spec.ts` | G6 Playwright real-browser | §5 guarantee |
| `docs/decision-log.md` | Append landing entry + update Current State | Append-only log |
| `docs/implementation-state.md` | Note slot classRewrites fix at `buildNvSlotContentIR` | Orientation digest |

No `src/core/` files touched. No Template-IR version bump. No new IR members.

---

## 9. Open Items for Architect Decision

| ID | Question | Options |
|----|----------|---------|
| **OPEN-S1** | Seed mechanism for `classRewrites` to be available at slot-build time | **B1a** (change `ir.id` to use `shapeHtml`, pre-walk; hash change for components with children) vs **B2** (two-pass, save raw slot node lists, rebuild post-walk; heavier, ir.id unchanged). CC recommends B1a. |
| **OPEN-S2** | Emit-path insertion point | Confirmed as single insertion in `buildNvSlotContentIR` (covers both paths). Architect confirm. |
| **OPEN-S3** | Corpus strategy | Reuse existing ir-equivalence + emit-exec harness with new fixtures. Architect confirm. |
