# nv Spec — Increment S1+S2: `$style` scoping emission + dynamic value lowering

**Status:** APPROVED 2026-06-22. Not yet a CC handoff.
**Workstream:** (3) Renderer/templating + (2) compiler.
**Supersedes:** the S1/S2 split in the 2026-06-22 phasing entry (S1 and S2 are merged into one
increment; see decision-log addition accompanying this spec).
**Depends on:** S0/F1 (LANDED, merge `6baa64e`) — consumes `NvStyleInfo.objExpr`,
`NvStyleInfo.factory`, `NvStyleInfo.hasComputedKeys`, and the factory-initializer erasure seam.
**Contract impact:** none (reactive-core untouched — style is out of core scope).
**Template-IR impact:** **v0.4.1 → v0.4.2** — additive `StyleVarBinding` union member.
**Gating:** real-browser required (cascade + custom-property behavior; jsdom not authoritative).
`.nv`-FE-only (tagged-template has no `$style`).

---

## 0. Verified seam facts (read at `6baa64e` before drafting — do not re-derive)

- `extractStyleInfo` returns `{ form:'object'|'factory', keys, hasComputedKeys, source, objExpr,
  factory? }`. `objExpr` is the real `ts.ObjectLiteralExpression`; S1+S2 iterates
  `objExpr.properties` for per-entry strings. `keys: string[]` is the flat static-key list and
  is **insufficient for routing** (lossy on the key-vs-selector distinction) — routing reads
  `objExpr` property names directly.
- The factory-initializer erasure (`eraseSignalReadsInNode(p.initializer, symbols.all)`) is
  wired but its **result is unused in S0**. S1+S2 consumes that result for the static/dynamic
  split.
- `interpreter.ts` has NO injection machinery: no `doc.head` access, no `<style>`, no
  `adoptedStyleSheets`, no per-identity registry. Injection is **built new** in this increment.
- `mount(ir, parent, doc)` threads `doc` explicitly and is DOM-agnostic. Injection MUST go
  through the passed `doc`, never a global `document` (locked "renderer stays agnostic"
  decision; required for SSR/multi-document).
- Binding wiring is one-effect-per-binding owned by the root scope (`case 'prop'` → `wireProp`).
  `StyleVarBinding` mirrors this exactly; cleanup/disposal is automatic via the owner tree.
- `simpleHash(s): string` exists (`nv-parser.ts` L2708); reused for scope hashes.

---

## 1. Scope and authoring model

`$style` is a `.nv`-only component construct: `$style({ <key>: <value>, ... })` or
`$style(() => ({ <key>: <value>, ... }))` (factory form). Keys are CSS selectors or class
tokens; values are CSS declaration blocks (object or string per the established value model —
see §3). Scoping is Light-DOM (no Shadow DOM): nv rewrites/marks selectors so a component's
styles apply only to that component's rendered nodes.

**nv does not invent CSS semantics.** The scoping layer routes and rewrites; it never
validates, "fixes," or reinterprets the author's CSS. A key that is valid CSS is scoped as
written; a key that is invalid CSS is the author's error, surfaced as-is by the browser. This
is a design principle, not an implementation convenience (see §2 discriminant).

---

## 2. Key routing — the class-vs-selector discriminant (RULED)

Each `$style` key is routed per-entry (Ruling 2, prior log) to one of two scoping mechanisms.
The discriminant is **two-way**, computed from the key string at compile time, no CSS parse:

### Rule

A key is **class-form** if and only if **every** whitespace-separated token in the key matches
the bare-CSS-class-identifier pattern:

```
^-?[_a-zA-Z][_a-zA-Z0-9-]*$
```

…**and** no single token is a known HTML/SVG element-tag name (see §2.1).

**Otherwise the key is selector-form.**

### Consequences (intended, not edge cases)

- `'card'` → class-form → class-rewrite.
- `'card active'` → class-form (two bare class tokens) → **each token** class-rewritten
  independently. Space-separated class lists are native CSS and fully supported.
- `'button'` → selector-form (single bare token that IS a tag name) → element selector,
  attribute-hash. NOT class-rewritten.
- `'button card'`, `'.foo'`, `'[data-x]'`, `'&:hover'`, `'a > b'`, `':is(...)'` → selector-form
  (sigil, combinator, or a tag token present) → attribute-hash, scoped as written.
- A mixed key like `'button card'` is selector-form and scoped **as the CSS it is** (descendant
  combinator: `card` descendant of `button`). nv does not reject it, does not special-case it,
  does not guess the author meant something else. The author owns CSS correctness.

### 2.1 HTML/SVG tag-name set

A single named constant (recommend `KNOWN_ELEMENT_TAGS: ReadonlySet<string>`) in one location,
covering HTML + SVG element names, documented as: *"Tracks the HTML/SVG element name lists;
add/remove entries as the specs change. Used only to classify a single bare-identifier `$style`
key as element-selector vs class. MathML deferred."*

- The set adjudicates **only the single-token bare-identifier case**. For multi-token keys, the
  presence of any non-class-identifier token (sigil/combinator) already forces selector-form, so
  a tag token in a multi-token key needs no separate check — it lands selector-form anyway.
- This is the one place the discriminant could drift as the HTML spec evolves; the single-set
  design makes rectification a one-line edit. **CC must NOT hand-inline tag checks at call
  sites.**

### 2.2 What each form emits

- **Class-form** key `card` → rewrite to `card_<scopeHash>`. Every matching class token in the
  component's rendered markup AND in the `$style` block is rewritten to the hashed form. The
  hash is per-component-identity (§4). `simpleHash` reused.
- **Selector-form** key → leave the selector text intact, but **scope it by attribute-hash**:
  the component's root element(s) carry `data-nv-s-<scopeHash>`, and the emitted selector is
  qualified so it only matches within the scoped subtree. The exact qualification form (prefix
  `[data-nv-s-<h>] <selector>` vs compound) is an **open spec point — see §7 OPEN-1**; it has
  real-browser cascade-specificity consequences and must be decided with browser evidence.

---

## 3. Value model and the static/dynamic split (RULED)

Each `$style` declaration value is classified at compile time:

- **Static** if its erased initializer reads **no** reactive symbol (the erasure result from the
  S0 seam is identical to the input modulo `name`→`name()` rewrites → no reactive read present).
- **Dynamic** if the erased initializer reads any reactive symbol (`symbols.all`).

The factory is **analyzed at compile time, never re-run** (locked, phasing entry). Object-form
`$style` has no reactivity → all-static.

### 3.1 Static declarations → hoisted stylesheet

Static declarations are emitted into a single CSS text block per component identity, injected
once (§4). No per-instance work, no binding. This is the bulk of typical `$style` content.

### 3.2 Dynamic declarations → CSS custom property + `StyleVarBinding`

A dynamic declaration `color: theme()` lowers to:

1. In the hoisted stylesheet: the property references a custom property —
   `color: var(--nv-<declHash>)`.
2. On the scoped element: a `StyleVarBinding` (§5) whose effect runs
   `el.style.setProperty('--nv-<declHash>', String(theme()))`, and `removeProperty` when the
   value is `null`/`undefined`.

This avoids re-injecting or re-parsing stylesheets on update (a document-level cascade recalc —
pathological for run-once-mounts-many). The cascade structure is fixed at injection; only the
custom-property *value* changes reactively. The factory closure is not re-run; the compiler
extracts the dynamic subexpression and emits the binding thunk directly (mirrors how classlist
`toggle` entries emit `expr: () => (boolSrc)`).

- **Custom-property naming:** `--nv-<declHash>` where `declHash` is stable per
  (component-identity, declaration-site). Collisions across components are prevented by folding
  component identity into the hash. **OPEN-2 (§7):** whether `declHash` includes the property
  name (`color`) to allow two dynamic decls on one selector — confirm during build.
- **Value coercion:** `setProperty` takes a string. Number → string. `null`/`undefined` →
  `removeProperty`. Boolean and other types → **OPEN-3 (§7)**: coerce or reject at compile time.

---

## 4. Injection: hoist-once-per-component-identity + dedup (BUILD NEW)

No injection machinery exists today (§0). This increment builds it.

### Requirements

- **Keyed by component identity.** The dedup key is the component's stable identity hash (the
  `nv:<hash>` id already computed for the template shape; confirm the exact field at build).
  Mounting N instances of a component injects its stylesheet **once**.
- **Through the passed `doc`.** Injection uses `doc` from `mount(ir, parent, doc)` — never a
  global `document`. A module-level registry keyed by `(doc, identity)` or a per-`doc` registry
  (recommend the latter: a `WeakMap<Document, Set<identityHash>>` + the `<style>` element it
  owns) so multi-document / SSR / test isolation all work. **OPEN-4 (§7):** registry shape and
  lifetime (process-global vs per-doc) — decide with the real-browser + jsdom-isolation
  behavior in front of you.
- **Injection point.** A `<style>` element in `doc.head` (or `adoptedStyleSheets` if targeting
  constructable stylesheets — **OPEN-5 (§7)**, real-browser-gated; `<style>` is the safe
  baseline, `adoptedStyleSheets` is the optimization). One `<style>` per component identity, or
  one shared `<style>` with appended rules — decide at build (dedup correctness is the
  invariant; the container is the tuning).
- **Teardown.** Whether injected styles are removed when the last instance unmounts is
  **OPEN-6 (§7)**. Default recommendation: **do not remove** (run-once-mounts-many means
  re-injection churn outweighs the leak; a bounded set of component stylesheets is not a
  growing leak). Confirm.

### Non-goals

- No Shadow DOM. No scoped-stylesheet-per-instance. No runtime CSS parsing.

---

## 5. Template-IR change: `StyleVarBinding` (v0.4.1 → v0.4.2)

Additive union member (decision: new kind, NOT `PropBinding` reuse — `PropBinding`'s sink is
`el[name]=v` with no `setProperty` path, no removal semantics, and a different name namespace;
reuse would require a shape change to `PropBinding` anyway and muddy its single responsibility).

```ts
// ── StyleVarBinding (v0.4.2) ──────────────────────────────────────────────────
/**
 * Sets a CSS custom property reactively via el.style.setProperty.
 * null/undefined value → removeProperty. Back-end: one effect per binding.
 * Used only by $style dynamic-value lowering (.nv FE). Not produced by any
 * tagged-template path.
 */
export type StyleVarBinding = BaseBinding & {
  kind: 'style-var'
  varName: string  // e.g. '--nv-1a2b3c'
  expr: ReactiveExpr<string | number | null | undefined>
}
```

Add to the `Binding` union. Interpreter: `case 'style-var': wireStyleVar(binding, targetNode)`
mirroring `wireProp`:

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

Emitter (`emitted-mount.ts` + `nv-emitter.ts`): emit the `style-var` case analogous to
existing prop/classlist emission. `ir-equivalence.ts`: add `bindingEqual` `style-var` case.

**This is the contract-adjacent touch in the increment.** It is Template-IR, not reactive-core
— no §1 invariant, no change to what a computation observes mid-propagation (it's a write sink
on the effect's downstream edge). In-stream for reactive-core; a Template-IR version bump for
the IR doc. Flag on landing.

---

## 6. Compiler / emitter path

- The `.nv` parser produces, from `NvStyleInfo`, a lowered style artifact per component:
  (a) the static CSS text block (selectors rewritten/qualified per §2, static decls inlined,
  dynamic decls replaced by `var(--nv-…)`), and (b) a list of `StyleVarBinding`s for the
  dynamic decls, attached to the correct scoped element path.
- Class-rewrite must rewrite class tokens **consistently** across the `$style` block AND the
  component's rendered markup (the `class` attributes / `ClassListBinding` tokens). A class
  named in `$style` but never used in markup is emitted in CSS but matches nothing (author's
  choice; not an error). A class in markup not named in `$style` is untouched. **OPEN-7 (§7):**
  interaction with `ClassListBinding` (Increment C) — when a `$style` class-form key matches a
  classlist `toggle` key, the rewritten name must flow into the toggle token. Verify against the
  landed `ClassListBinding` shape; this is the `$style × classlist` seam.
- Both back-ends (interpreter + emitted) must produce identical scoped output for the same
  `$style` input — shared-oracle differential test (§ test gate), not just structural equality.

---

## 7. OPEN spec points (resolve during build, seam in front — do NOT invent)

These are deliberately deferred to implementation because each depends on a real-browser
behavior or a seam not yet read. CC must HALT and surface, not guess, on each.

- **OPEN-1** Selector-form qualification: prefix (`[data-nv-s-<h>] <sel>`) vs compound vs
  `:where()`-wrapped for specificity neutrality. Real-browser cascade-specificity evidence
  required.
- **OPEN-2** `declHash` includes property name? (two dynamic decls on one selector).
- **OPEN-3** Dynamic value type coercion: boolean/object handling at the `setProperty` boundary.
- **OPEN-4** Injection registry shape + lifetime (per-`doc` `WeakMap` vs process-global).
- **OPEN-5** `<style>` (baseline) vs `adoptedStyleSheets` (optimization) — real-browser-gated.
- **OPEN-6** Teardown: remove injected styles on last-instance unmount, or never.
- **OPEN-7** `$style` class-form key × `ClassListBinding` toggle-key rewrite consistency.

---

## 8. Test gates (failable; shared-oracle where output is rich)

- **Discriminant unit tests:** `card`→class; `card active`→two class tokens; `button`→element
  selector; `button card`→selector (as-written); `.x`,`[x]`,`&:hover`,`a>b`,`:is()`→selector.
  Each failable on the routed mechanism, not just "didn't throw."
- **Static scoping (real-browser):** class-rewrite applies styles to the component's nodes and
  NOT to an identically-classed node outside the component. Attribute-hash selector scoping
  likewise. jsdom NOT authoritative — Playwright/Chromium gate.
- **Dynamic value (real-browser):** a `StyleVarBinding`-backed decl updates the rendered style
  when its signal changes; `null`→`removeProperty` verified; the stylesheet is NOT re-injected
  on update (assert injection count stable across value changes).
- **Dedup (real-browser):** N instances → one injected stylesheet (assert `<style>`/rule count).
- **Differential (shared-oracle):** interpreter and emitted back-ends produce identical scoped
  CSS + identical `StyleVarBinding` sets for a corpus of `$style` inputs.
- **`$style × classlist` (OPEN-7):** a class-form key matching a classlist toggle key →
  rewritten token flows to the toggle; styled correctly in-browser.

---

## 9. Increment boundary / G0

- Touches: `nv-parser.ts` (lowering), `ir.ts` (`StyleVarBinding`), `interpreter.ts`
  (`wireStyleVar` + injection), `nv-emitter.ts` / `emitted-mount.ts` (emit), `ir-equivalence.ts`,
  new injection module, tests. This is NOT IR-free (unlike S0) — the Template-IR bump is in
  scope and expected.
- **reactive-core (`src/core/`) MUST NOT be touched.** Style is out of core scope. Any core
  touch is a G0 disqualifier and an escalation.
- Injection MUST go through `doc`, never global `document` (G0/G1 invariant).
- Both back-ends differential-tested (shared oracle), not structural-only.
- Real-browser gate is REQUIRED for the scoping-correctness and dynamic-update gates — these are
  CC real-hardware tasks, not sandbox.

---

## 10. Phasing within the increment (recommended build order)

1. **Discriminant + tag-set** (pure, unit-testable, sandbox). Lands the routing classifier.
2. **Static scoping + injection** (class-rewrite, attribute-hash, hoist/dedup). Real-browser
   gate. Resolves OPEN-1, -4, -5, -6.
3. **`StyleVarBinding` + dynamic lowering** (IR bump, `wireStyleVar`, emitter). Resolves OPEN-2,
   -3. Real-browser gate.
4. **`$style × classlist` consistency** (OPEN-7). Real-browser gate.

Each sub-phase is independently landable and gated. The IR bump (v0.4.2) lands with sub-phase 3.
A CC handoff should cover sub-phase 1 first (sandbox, lowest risk, unblocks the rest), with 2–4
as a sequenced follow-on or separate handoffs depending on real-browser turnaround.
