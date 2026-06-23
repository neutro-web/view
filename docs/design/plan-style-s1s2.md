# Plan — Increment S1+S2: `$style` scoping + dynamic lowering

> **Status: AWAITING ARCHITECT APPROVAL (Gate P)**
> No `src/` file is touched until this plan is approved.
> Spec authoritative: `docs/design/spec-style-s1s2-scoping-and-lowering.md`

**Branch:** `feat/style-s1s2` off `main` at `427970e`
**Seams read at HEAD:** `427970e` — all line numbers verified against this commit.

---

## Seam inventory (read at `427970e`)

| File | Key seam | Lines |
|---|---|---|
| `src/renderer/ir.ts` | `Binding` union (11 members), `BaseBinding`, `ReactiveExpr<T>`, IR v0.4.1 header | 37, 87–91, 256–267 |
| `src/renderer/interpreter.ts` | `mount(ir, parent, doc)` signature, `wireBinding` switch, `wireProp` body | 108–161, 252–264, 676 |
| `src/renderer/nv-parser.ts` | `NvStyleInfo`, `ScriptSymbols`, `extractStyleInfo`, `eraseSignalReadsInNode`, `simpleHash` | 153–163, 174–181, 1240–1295, 1305–1362, 2708–2712 |
| `src/renderer/nv-emitter.ts` | `emitBindingLiteral` switch, classlist case pattern | 80–207, 183–201 |
| `src/compiler/emitted-mount.ts` | `emitSetup` signature, binding wire switch | 132–139, 158–624 |
| `test/renderer/ir-equivalence.ts` | `bindingEqual` signature and switch cases | 65–158 |
| `test/browser/real-browser.spec.ts` | existing spec pattern (`loadNv`, `page.evaluate`, `window.__nv`) | 1–1275 |
| `test/browser/nv-entry.ts` | bundle entry exports | all |

**Confirmed: no injection machinery in `interpreter.ts`** — no `doc.head`, `<style>`, `adoptedStyleSheets`, or `styleSheet` access. Injection is built new in this increment.

**Confirmed: `wireProp` sink** (L252–264) — `el[name] = binding.expr()`. No `setProperty` path. `StyleVarBinding` requires a new `wireStyleVar`, not `wireProp` reuse.

---

## Global constraints (P.5 — locked, fenced as G0)

| Constraint | Mechanism |
|---|---|
| **L.1** No `src/core/` touch | All new code in `src/renderer/` and `src/compiler/`; evidence: `git diff --stat main -- src/core/` empty |
| **L.2** Injection through passed `doc`, never global `document` | Injection module takes `doc: Document`; grep injection file for `document\.` → zero |
| **L.3** Factory analyzed compile-time, never re-run | Dynamic decls extract thunk `() => (reactiveExpr)` at parse time; Phase 3 gate asserts injection count stable across value changes |
| **L.4** nv does not invent CSS semantics | Discriminant routes/rewrites only; no CSS validation; mixed/selector keys emitted as-written |
| **L.5** Misclassification falls to dynamic | Static classification requires ALL erasure-reads absent; any ambiguity → treat as dynamic (correct but slower, never wrong) |
| **L.6** Both back-ends differential-tested | Shared-oracle corpus: interpreter vs emitted produce identical scoped CSS + identical `StyleVarBinding` sets |

---

## Files touched per phase

### Phase 1 — discriminant + `KNOWN_ELEMENT_TAGS`

**Create:**
- `src/renderer/style-classify.ts` — `classifyStyleKey`, `KNOWN_ELEMENT_TAGS`

**Modify:**
- (none — no IR, no emitter, no interpreter touch in Phase 1)

**Test:**
- `test/renderer/style-classify.test.ts` — unit tests for all G1.1–G1.7 cases

### Phase 2 — static scoping + injection

**Create:**
- `src/renderer/style-inject.ts` — injection registry (`WeakMap<Document, StyleRegistry>`), `injectComponentStyle(doc, identityHash, cssText)`, `StyleRegistry` type

**Modify:**
- `src/renderer/nv-parser.ts` — `buildStyleArtifact` helper: iterates `NvStyleInfo.objExpr.properties`, applies Phase 1 discriminant, produces `{ staticCss: string, varBindingDescs: VarBindingDesc[] }` (Phase 2 uses staticCss only; varBindingDescs placeholder for Phase 3)
- `src/renderer/interpreter.ts` — `case 'style-var'` stub (throws "not yet implemented" to preserve type exhaustiveness; real wiring in Phase 3); inject static CSS at mount via `injectComponentStyle`
- `src/compiler/emitted-mount.ts` — same stub + inject call
- `test/browser/nv-entry.ts` — export `injectComponentStyle` for browser gate assertion of injection count

**Test:**
- `test/renderer/style-inject.test.ts` — unit: dedup (N mounts → 1 inject), per-doc isolation
- `test/browser/style-scoping.spec.ts` — browser: G2.1–G2.6

### Phase 3 — `StyleVarBinding` + dynamic lowering (IR bump v0.4.2)

**Modify:**
- `src/renderer/ir.ts` — add `StyleVarBinding` union member; bump version comment to v0.4.2; add to `Binding` union
- `src/renderer/interpreter.ts` — replace stub with real `wireStyleVar`; `case 'style-var': wireStyleVar(binding, targetNode)`
- `src/renderer/nv-parser.ts` — complete `buildStyleArtifact` to populate `varBindingDescs`; `extractStyleInfo` call sites emit `StyleVarBinding[]` from varBindingDescs
- `src/renderer/nv-emitter.ts` — `case 'style-var'` in `emitBindingLiteral`
- `src/compiler/emitted-mount.ts` — `case 'style-var'` in wire switch
- `test/renderer/ir-equivalence.ts` — `case 'style-var'` in `bindingEqual`

**Test:**
- `test/renderer/style-lowering.test.ts` — unit: static/dynamic split classification; `StyleVarBinding` shape
- `test/browser/style-scoping.spec.ts` — extend: G3.2–G3.7

### Phase 4 — `$style × ClassListBinding` (OPEN-7)

**Modify:**
- `src/renderer/nv-parser.ts` — class-rewrite propagation to classlist tokens at same element
- `src/renderer/nv-emitter.ts` — ensure rewritten class token flows into classlist toggle key

**Test:**
- `test/browser/style-scoping.spec.ts` — extend: G4.1–G4.3
- `test/renderer/style-classify.test.ts` — extend: class-rewrite × classlist unit case

---

## OPEN point resolution proposals (P.2)

### OPEN-1 — Selector-form qualification — **RULED: `:where()` from the start**

**Ruling (architect, 2026-06-23):** use `:where([data-nv-s-<h>]) <sel>` unconditionally. Specificity-neutral from day one; no baseline-then-migrate path.

**Emitted form:** for selector-form key `<sel>`, emit `:where([data-nv-s-<hash>]) <sel>`. For class-form key `card`, the class-rewrite (`card_<hash>`) is the scoping mechanism — no attribute-hash qualification needed for class-form keys.

**Browser compat:** `:where()` Chrome 88+, Safari 14+, Firefox 78+. Confirmed broad enough for this project's targets.

**CC must use this form everywhere** — no descendant-prefix fallback, no compound variant.

### OPEN-2 — `declHash` includes property name?

**Options:**
- (a) `declHash = simpleHash(identityHash + '|' + propertyName)` — two dynamic decls on the same selector (e.g., `color: theme()` and `background: alt()`) produce distinct custom properties
- (b) `declHash = simpleHash(identityHash + '|' + declarationIndex)` — position-stable, order-sensitive

**Recommendation:** (a) — property-name inclusion prevents collision when two dynamic values on the same selector have the same declaration site index after an edit. Cheaper than a positional index, more meaningful.

**Resolution trigger:** Phase 3 implementation. CC uses (a) unless architect rules otherwise.

### OPEN-3 — Dynamic value coercion at `setProperty`

**Options:**
- (a) Number → `String(v)`, null/undefined → `removeProperty`, boolean/other → throw at compile time (type error in emitted thunk signature)
- (b) Number → `String(v)`, null/undefined → `removeProperty`, boolean → `String(v)` (silent coerce)

**Recommendation:** (a) — the `expr` type is `ReactiveExpr<string | number | null | undefined>`. Boolean and objects are out of type; TypeScript will catch them at compile time in emitted thunks. Runtime coercion of booleans silently produces `"true"`/`"false"` strings which are never valid CSS property values — better to fail visibly.

**Resolution trigger:** Phase 3 implementation. CC uses (a).

### OPEN-4 — Injection registry shape + lifetime

**Options:**
- (a) Per-`doc` `WeakMap<Document, Map<string, HTMLStyleElement>>` — keys are `identityHash`; `WeakMap` ensures garbage collection when `doc` goes away
- (b) Process-global `Map<string, HTMLStyleElement>` — simpler but breaks multi-document and test isolation

**Recommendation:** (a). The existing `mount(ir, parent, doc)` contract already threads `doc`; the per-`doc` WeakMap is the only option consistent with L.2 and SSR/multi-doc isolation. Process-global is a G0 violation (would require global `document` access).

**Resolution trigger:** Phase 2 implementation. CC uses (a).

### OPEN-5 — `<style>` vs `adoptedStyleSheets` (browser-gated)

**Options:**
- (a) `doc.head.appendChild(styleEl)` — universal baseline; works everywhere
- (b) `doc.adoptedStyleSheets.push(sheet)` — constructable stylesheets; better perf for many components; Chrome 73+, Firefox 101+, Safari 16.4+

**Recommendation:** (a) as the Phase 2 baseline. Report browser compat from the Phase 2 gate. `adoptedStyleSheets` is an optimization that can be added in a follow-on without changing the injection contract (the `StyleRegistry` shape abstracts the insertion mechanism).

**Resolution trigger:** Phase 2 browser gate. CC uses (a); architect may approve (b) as a follow-on.

### OPEN-6 — Teardown policy

**Options:**
- (a) Never remove injected styles (recommended) — once hoisted, the stylesheet stays for the lifetime of the document. For run-once-mounts-many, the style set is bounded (one per component identity) and re-injection churn outweighs the leak.
- (b) Remove on last-instance unmount — requires a refcount per `(doc, identityHash)` pair; complex, and churn-prone if components mount/unmount frequently.

**Recommendation:** (a). The registry is `WeakMap<Document, Map<identityHash, HTMLStyleElement>>` — bounded, and the `WeakMap` key is `doc` so it GCs with the document. The stylesheet set is not a growing leak (it grows only with the number of distinct component identities used, not instances).

**Resolution trigger:** Phase 2 implementation. CC uses (a).

### OPEN-7 — `$style × ClassListBinding` rewrite consistency

**Context (read at `427970e`):** `ClassListBinding` entries have `{ kind: 'static', token: string }` and `{ kind: 'toggle', key: string, expr }`. The `token`/`key` strings are the CSS class names as emitted. If a `$style` class-form key `card` rewrites to `card_<hash>`, the classlist toggle/static entry for `card` must also use `card_<hash>` — otherwise the component styles `card_<hash>` but the element's classlist toggles `card`.

**Resolution:** Phase 4 builds the class-rewrite map (all class-form keys → `key_<hash>`) during `buildStyleArtifact`. The classlist emission (`nv-parser.ts` classlist extraction path) queries this map: if the key is in the rewrite map, use the rewritten token. The map is per-component-identity and lives for the duration of the parse.

**Resolution trigger:** Phase 4 implementation. CC reads the `ClassListBinding` shape at HEAD and confirms the token/key field names before building the propagation.

---

## Per-phase gate tables (P.3)

### Phase 1 gates

**G0 (Phase 1):**
- Evidence: `git diff --stat 427970e -- src/renderer/ir.ts src/renderer/interpreter.ts src/renderer/nv-emitter.ts src/compiler/emitted-mount.ts` → empty (none of these files touched)
- Evidence: `git diff --stat 427970e -- src/renderer/style-classify.ts test/renderer/style-classify.test.ts` → non-empty (only these two files changed)

**G1 (Phase 1):**

| Item | Evidence command | Failure condition |
|---|---|---|
| G1.1 single bare class | `pnpm test -- --reporter=verbose test/renderer/style-classify.test.ts` matching "classify('card') → class-form" | test absent or result ≠ class-form |
| G1.2 space-separated class list | test matching "classify('card active') → class-form, 2 tokens" | result ≠ class-form or token count ≠ 2 |
| G1.3 single bare tag → selector | test matching "classify('button') → selector-form" | result ≠ selector-form |
| G1.4 sigil/combinator → selector | tests for `.x`, `[x]`, `&:hover`, `a>b`, `:is(p)` each → selector-form | any ≠ selector-form |
| G1.5 mixed tag+class → selector (as-written) | test matching "classify('button card') → selector-form" | result ≠ selector-form or any token rewritten |
| G1.6 tag set is ONE constant | `grep -n 'KNOWN_ELEMENT_TAGS' src/renderer/style-classify.ts` → exactly one definition | multiple definitions; or tag checks at call sites |
| G1.7 pattern boundary | tests for `2col` (fails `^-?[_a-zA-Z]`→selector), `-x` and `_x` (valid → class) | misclassification |

**Test suite:** `pnpm test` green (607 baseline + new Phase 1 tests); `tsc --strict` clean; biome clean.

---

### Phase 2 gates

**G0 (Phase 2):**
- Evidence: `git diff --stat HEAD -- src/renderer/ir.ts` → empty (no IR touch)
- Evidence: grep `src/renderer/style-inject.ts` and `src/renderer/interpreter.ts` for `document\.` (bare global) → zero matches

**G1 (Phase 2) — real-browser (Playwright/Chromium):**

| Item | Evidence | Failure condition |
|---|---|---|
| G2.1 class-rewrite scopes IN | `pnpm test:browser` output for "scoped-class-in" test: `classList.contains('card_<hash>')` is true on component node | component node unstyled or has `card` not `card_<hash>` |
| G2.2 class-rewrite scopes OUT | "scoped-class-out" test: node outside component with class `card` NOT styled by scoped rule | outside node picks up scoped style |
| G2.3 selector-form attribute-hash scopes | "attr-hash-scope" test: selector-form key styles only nodes carrying `data-nv-s-<hash>` attr | leaks to non-carrying node |
| G2.4 hoist-once dedup | "dedup-N-instances" test: mount 3 instances → `doc.querySelectorAll('style[data-nv-s]').length === 1` (or equivalent single-entry assertion) | style count scales with instance count |
| G2.5 injection via `doc` | "multi-doc-isolation" test: inject into `doc2 = document.implementation.createHTMLDocument()`; assert `document.head` unchanged | global `document.head` modified |
| G2.6 differential (shared oracle) | "differential-static" test: interpreter and emitted produce identical `data-nv-s-<hash>` attr on root AND identical scoped CSS text | non-identical output |

**Note:** G2.1–G2.3 require Playwright/Chromium. jsdom not authoritative for cascade. `pnpm test:browser` is the evidence command. CC reports the full Playwright run output, not "passed."

**Test suite:** `pnpm test` green (≥607); `pnpm test:browser` green for new style-scoping tests; `tsc --strict` clean; biome clean.

---

### Phase 3 gates

**G0 (Phase 3):**
- Evidence: `git diff src/renderer/ir.ts` — ONLY `StyleVarBinding` type + union line added; no existing member's shape changed
- Evidence: `git diff --stat 427970e -- src/core/` → empty

**G1 (Phase 3) — real-browser:**

| Item | Evidence | Failure condition |
|---|---|---|
| G3.1 additive IR | `git diff src/renderer/ir.ts` shows only: new `StyleVarBinding` type + addition to union | any existing member shape changed |
| G3.2 dynamic update | "dynamic-update" test: signal write → `getComputedStyle(el).getPropertyValue('--nv-<hash>')` changes | property stale |
| G3.3 null → removeProperty | "null-remove" test: set signal null → `el.style.getPropertyValue('--nv-<hash>') === ''` (property absent) | property retains value |
| G3.4 no re-injection on update (L.3) | "no-reinject" test: record `doc.querySelectorAll('style[data-nv-s]').length` before + after 10 signal writes → equal | injection count increases |
| G3.5 misclassification safe (L.5) | "ambiguous-classify" test: value with reactive read but edge-case erasure → lowered as dynamic, not static | baked static |
| G3.6 differential | "differential-dynamic" test: interpreter vs emitted produce identical `StyleVarBinding` sets + identical hoisted CSS with `var(--nv-…)` substitution | non-identical |
| G3.7 wireStyleVar owner cleanup | "stylevar-dispose" test: mount + dispose → effect torn down (signal write after dispose does not call `setProperty`) | `setProperty` called after dispose |

**Template-IR surface note:** `ir.ts` version comment bumped from v0.4.1 to v0.4.2; `docs/design/nv-template-ir.md` cross-ref updated on landing (not in plan scope — flagged for architect at landing).

---

### Phase 4 gates

**G0 (Phase 4):**
- No `ClassListBinding` shape changes (add-only propagation; existing token/key fields used as-is)
- No new IR members

**G1 (Phase 4) — real-browser:**

| Item | Evidence | Failure condition |
|---|---|---|
| G4.1 rewrite flows to toggle | "style-×-classlist" test: `$style` key `card` + classlist toggle `card` → toggled class on element is `card_<hash>`, not `card` | toggle emits unscoped `card` |
| G4.2 styled when toggled on | same test: toggle true → scoped CSS rule applies (verified via `getComputedStyle`) | unstyled when toggled on |
| G4.3 differential | interpreter vs emitted: identical class rewrite + classlist token | non-identical |

---

## Differential test corpus (P.4)

The differential test (shared-oracle) runs both back-ends (interpreter `mount` + emitted `emitMount`) against the same IR and asserts identical output. Corpus cases:

### Static-only corpus (Phase 2)

| ID | `$style` input | Expected output |
|---|---|---|
| D.1 | `$style({ card: 'color:red' })` | class-form key; scoped CSS `.card_<hash>{ color:red }`; root gets `data-nv-s-<hash>` |
| D.2 | `$style({ 'card active': 'font-weight:bold' })` | two tokens rewritten: `.card_<h> .active_<h>` both scoped |
| D.3 | `$style({ button: 'padding:0' })` | selector-form (tag); `[data-nv-s-<h>] button { padding:0 }` |
| D.4 | `$style({ '.foo': 'color:blue' })` | selector-form (sigil); `[data-nv-s-<h>] .foo { color:blue }` |
| D.5 | `$style({ 'button card': 'margin:0' })` | selector-form (mixed); `[data-nv-s-<h>] button card { margin:0 }` |
| D.6 | `$style({ card: 'color:red', button: 'padding:0' })` | mixed keys; two scoping routes in one component |

### Dynamic corpus (Phase 3)

| ID | `$style` input | Expected dynamic output |
|---|---|---|
| D.7 | `$style(() => ({ card: color() }))` | hoisted: `.card_<h>{ color: var(--nv-<dh>) }`; `StyleVarBinding { varName:'--nv-<dh>', expr:()=>color() }` |
| D.8 | `$style(() => ({ card: color(), 'font-size': size() }))` | two dynamic decls → two distinct `--nv-` vars; no re-injection on update |
| D.9 | `$style(() => ({ card: 'red' }))` | static inside factory; hoisted, no `StyleVarBinding` |
| D.10 | `$style(() => ({ card: color(), button: 'padding:0' }))` | mixed static+dynamic; one StyleVarBinding, selector-form static baked |

### Cross-concern corpus (Phase 4)

| ID | `$style` + template | Expected |
|---|---|---|
| D.11 | `$style({ card: 'color:red' })` + `class={{ card: show() }}` | toggle key is `card_<hash>`; styled when `show()` true |

---

## Task decomposition for subagent execution

The four phases map to four sequential tasks. Each task is independently reviewable and landable. Implementation begins after Gate P architect approval.

### Task 1 — Phase 1: discriminant + `KNOWN_ELEMENT_TAGS`

**Files:**
- Create: `src/renderer/style-classify.ts`
- Create: `test/renderer/style-classify.test.ts`

**Deliverable:** `classifyStyleKey(key: string): { form: 'class', tokens: string[] } | { form: 'selector' }` + `KNOWN_ELEMENT_TAGS: ReadonlySet<string>`. All G1.1–G1.7 tests green.

**Interface produced (consumed by Tasks 2–4):**
```ts
// src/renderer/style-classify.ts
export type ClassifyResult =
  | { form: 'class'; tokens: string[] }   // tokens: the whitespace-split bare-class names
  | { form: 'selector' }

export function classifyStyleKey(key: string): ClassifyResult

export const KNOWN_ELEMENT_TAGS: ReadonlySet<string>  // HTML+SVG; MathML deferred
```

**Regex (verbatim from spec §2):** `^-?[_a-zA-Z][_a-zA-Z0-9-]*$`

**Tag set guidance:** include at minimum: all HTML void elements + common block/inline elements + common SVG elements. `KNOWN_ELEMENT_TAGS` must be a single named `ReadonlySet<string>` constant — no inlining at call sites.

**Tests required (all failable):**
- `classify('card')` → `{ form: 'class', tokens: ['card'] }`
- `classify('card active')` → `{ form: 'class', tokens: ['card', 'active'] }`
- `classify('button')` → `{ form: 'selector' }` (tag name)
- `classify('.x')` → `{ form: 'selector' }`
- `classify('[x]')` → `{ form: 'selector' }`
- `classify('&:hover')` → `{ form: 'selector' }`
- `classify('a>b')` → `{ form: 'selector' }`
- `classify(':is(p)')` → `{ form: 'selector' }`
- `classify('button card')` → `{ form: 'selector' }` (tag token present → whole key is selector)
- `classify('2col')` → `{ form: 'selector' }` (fails `^-?[_a-zA-Z]`)
- `classify('-x')` → `{ form: 'class', tokens: ['-x'] }` (valid CSS ident: starts with `-` + letter)
- `classify('_x')` → `{ form: 'class', tokens: ['_x'] }` (valid)
- KNOWN_ELEMENT_TAGS test: all common tags classifiable as selector; a fabricated tag `nvcustom` → class-form

### Task 2 — Phase 2: static scoping + injection (real-browser gate)

**Files:**
- Create: `src/renderer/style-inject.ts`
- Create: `test/renderer/style-inject.test.ts`
- Modify: `src/renderer/nv-parser.ts` — add `buildStyleArtifact` (static CSS output only; dynamic stubs for Phase 3)
- Modify: `src/renderer/interpreter.ts` — inject static CSS on mount; `case 'style-var'` stub (throws)
- Modify: `src/compiler/emitted-mount.ts` — same stub + inject call
- Modify: `test/browser/nv-entry.ts` — export `injectComponentStyle` for gate assertions
- Create: `test/browser/style-scoping.spec.ts` — G2.1–G2.6 browser tests

**`style-inject.ts` interface:**
```ts
// One style element per (doc, identityHash). WeakMap so doc GC removes entry.
type StyleRegistry = Map<string, HTMLStyleElement>
const docStyleRegistries = new WeakMap<Document, StyleRegistry>()

export function injectComponentStyle(
  doc: Document,
  identityHash: string,
  cssText: string,
): void
// Idempotent: if identityHash already in registry for this doc, no-op.
```

**`buildStyleArtifact` in `nv-parser.ts`:**
```ts
// Not exported — called from extractStyleInfo call sites (L~1768, L~2660)
function buildStyleArtifact(
  info: NvStyleInfo,
  scopeHash: string,
): {
  staticCss: string   // hoisted stylesheet text
  varBindingDescs: VarBindingDesc[]   // empty in Phase 2; populated in Phase 3
}

type VarBindingDesc = {
  varName: string          // '--nv-<declHash>'
  exprSrc: string          // erased reactive expression source (thunk body)
  pathIndex: number        // which DOM node
  propertyName: string     // CSS property name (e.g. 'color')
}
```

**Scope hash:** `simpleHash(ir.id)` — the component IR id is the identity hash. Confirmed: `ir.id` is the stable component identity field used in `TemplateIR`. CC must read the `id` field usage in `interpreter.ts` at HEAD to confirm before building.

**OPEN-1 RULED:** use `:where([data-nv-s-<hash>]) <sel>` for selector-form — specificity-neutral, no fallback. Class-form keys use class-rewrite only (no attribute qualifier).

**Browser test pattern** (follows `real-browser.spec.ts` pattern):
```ts
// test/browser/style-scoping.spec.ts
import { test, expect } from '@playwright/test'
// uses window.__nv (from bundle) via page.evaluate
// mounts component IR with $style artifact, asserts DOM state
```

The `window.__nv` bundle must expose `mount`, `emitMount`, `signal`, `flushSync`. Injection happens inside `mount`/`emitMount`. No extra export needed for the mount path; `injectComponentStyle` exported for gate assertion of injection count.

**OPEN points resolved in Phase 2:** OPEN-1 (RULED: `:where()` from start), OPEN-4 (per-doc WeakMap), OPEN-5 (`<style>` baseline), OPEN-6 (never-remove).

### Task 3 — Phase 3: `StyleVarBinding` + dynamic lowering (**IR bump v0.4.2**)

**Files:**
- Modify: `src/renderer/ir.ts` — additive `StyleVarBinding`; bump version comment
- Modify: `src/renderer/interpreter.ts` — real `wireStyleVar`; remove stub
- Modify: `src/renderer/nv-parser.ts` — complete `buildStyleArtifact.varBindingDescs`
- Modify: `src/renderer/nv-emitter.ts` — `case 'style-var'` in `emitBindingLiteral`
- Modify: `src/compiler/emitted-mount.ts` — `case 'style-var'` in wire switch; remove stub
- Modify: `test/renderer/ir-equivalence.ts` — `case 'style-var'` in `bindingEqual`
- Create: `test/renderer/style-lowering.test.ts` — unit tests for static/dynamic split + `StyleVarBinding` shape
- Extend: `test/browser/style-scoping.spec.ts` — G3.2–G3.7

**`StyleVarBinding` shape (verbatim from spec §5):**
```ts
export type StyleVarBinding = BaseBinding & {
  kind: 'style-var'
  varName: string  // e.g. '--nv-1a2b3c'
  expr: ReactiveExpr<string | number | null | undefined>
}
```

**`wireStyleVar` (verbatim from spec §5):**
```ts
function wireStyleVar(binding: StyleVarBinding, el: Node): void {
  const style = (el as HTMLElement).style
  effect(() => {
    const v = binding.expr()
    if (v === null || v === undefined) style.removeProperty(binding.varName)
    else style.setProperty(binding.varName, String(v))
  })
}
```

**Emitter pattern** (mirrors classlist, `nv-emitter.ts` L183–201):
```ts
case 'style-var': {
  // binding is StyleVarBinding; thunk carries exprSrc
  return `{ kind: 'style-var', ${pathEntry}, varName: ${JSON.stringify(binding.varName)}, expr: () => (${thunk.exprSrc}) }`
}
```

**`bindingEqual` case** (mirrors `case 'prop'`, `ir-equivalence.ts`):
```ts
case 'style-var':
  if (a.kind !== 'style-var' || b.kind !== 'style-var') return diff(...)
  if (a.varName !== b.varName) return diff(i, 'style-var varName', a.varName, b.varName)
  return null
```

**Static/dynamic split** — at `buildStyleArtifact`: for each `PropertyAssignment` in `objExpr.properties`:
1. Erase the initializer via `eraseSignalReadsInNode(p.initializer, symbols.all)`
2. If the erased result equals the original source text → **static** (no reactive reads found)
3. Otherwise → **dynamic** → `VarBindingDesc { varName: '--nv-' + simpleHash(scopeHash + '|' + propertyName), exprSrc: erasedResult, ... }`
4. Ambiguous (erasure throws or returns unexpected) → treat as dynamic (L.5)

**`declHash` (OPEN-2 resolved as (a)):** `simpleHash(scopeHash + '|' + propertyName)` — property-name included to prevent collision of two dynamic decls on the same selector.

**Value coercion (OPEN-3 resolved as (a)):** `StyleVarBinding.expr` typed `ReactiveExpr<string | number | null | undefined>`. TypeScript enforces at emit time. Runtime: `String(v)` for non-null/undefined; `removeProperty` for null/undefined. Boolean not in the type — compile-time error in emitted thunks.

**Template-IR flag:** on landing, CC reports: `git diff src/renderer/ir.ts` (confirm additive) + version comment confirms v0.4.2. `docs/design/nv-template-ir.md` cross-ref update is architect's to schedule (not in CC scope).

### Task 4 — Phase 4: `$style × ClassListBinding` (OPEN-7)

**Files:**
- Modify: `src/renderer/nv-parser.ts` — class-rewrite map propagation to classlist token extraction
- Modify: `src/renderer/nv-emitter.ts` — rewritten class token flows to classlist toggle key in `emitBindingLiteral`
- Extend: `test/browser/style-scoping.spec.ts` — G4.1–G4.3
- Extend: `test/renderer/style-classify.test.ts` — unit: class-rewrite × classlist

**Mechanism:**
1. `buildStyleArtifact` produces a `classRewrites: Map<string, string>` — maps original class-form key to `key_<hash>`.
2. Classlist extraction sites (structural IR path in `buildNvHoleBinding`, emit path in parse-for-emit) check `classRewrites.get(key)` before emitting the token. If present, use the rewritten name.
3. Both IR back-ends affected (interpreter wires the rewritten token; emitter emits it).

**Seam to read before building:** classlist token extraction at `nv-parser.ts` structural path and emit path — confirm the field names are `token` (static) and `key` (toggle) at current HEAD before writing the propagation.

---

## Build order rationale

1. **Phase 1 first** — pure classifier, no IR, zero risk. Everything downstream depends on it.
2. **Phase 2 next** — static path + injection. Real-browser first gate. OPEN-1 resolution evidence comes here.
3. **Phase 3** — IR bump + dynamic path. Blocked on Phase 2 (needs injection structure + browser gate baseline). This is the contract-adjacent touch.
4. **Phase 4 last** — OPEN-7 integration. Blocked on Phase 1 (rewrite map) + Phase 3 (ClassListBinding shape confirmed static).

Each phase is independently committable and reviewable. The full increment lands as four sequential task+review cycles.

---

## Gate P summary checklist

- [ ] P.1 — Files + shapes per phase: all four phases documented above with exact file paths, function signatures, and line references
- [ ] P.2 — OPEN point proposals: all 7 OPEN points addressed above with options, recommendation, and resolution trigger
- [ ] P.3 — Gate tables: all four phases have G0 + G1 tables with evidence commands and failure conditions
- [ ] P.4 — Differential corpus: 11 corpus cases named with inputs and expected outputs
- [ ] P.5 — Locked constraint confirmations: L.1–L.6 all confirmed with mechanism and evidence command
- [ ] No `src/` diff present in this plan submission — plan-only, Gate P halt
