# Spec — `$style` Scoping & Class-Selection

**Status:** APPROVED 2026-06-22 (owner). Two independently shippable increments. No
reactive-core contract change. Template-IR change, if any, decided at build time (§6).

**Stream:** (3) renderer/templating + (2) compiler specialization
**Decision record:** Log entry `$style scoping + class-selection [2026-06-22]`.
**Framing constraint:** Template-IR §scope already fences style scoping out of the
reactive-core contract. Everything here is renderer/compiler-layer.

---

## 0. Scope & non-goals

**In scope:** (A) `$style` scoping — emit component-scoped CSS from a parsed `$style`
block, supporting both key-form and selector-form entries, with reactive *values* via
custom properties. (B) class-selection — compile `class={...}` expression forms to the
right DOM-update strategy. (C) the `cx` helper.

**Out of scope:** Shadow-DOM opt-in (platform scoping; separate). `$style × slots`
(parked behind A's implementation). DOM encapsulation. SSR/hydration of styles.

**Two axes, never conflated:**
- **Scoping** (this spec, §1–3): how `$style` rules bind to *this* component's nodes only.
- **Selection** (this spec, §4): how `class={...}` reactively chooses *among* classes.
`$style` produces scoped class names; class-selection toggles them. They compose; they
do not overlap.

**Front-end applicability (load-bearing — the two axes differ here):**
- **`$style` scoping (§1–3) is `.nv`-FRONT-END-ONLY.** `$style` is a `.nv` `$component`
  construct parsed by `nv-parser.ts`; the tagged-template front-end (`html-tag.ts`) has
  no `$style` concept. Tagged-template authors scope via plain `class` + external/imported
  CSS. The `style.<key>` template-reference rewrite (§2.2 step 3) is therefore `.nv`-only.
- **Class-selection (§4) targets BOTH front-ends** (it is the `class` attribute), but the
  two FEs accept different *forms* — see §4.0 for the per-FE matrix. This asymmetry is
  real and must not be flattened: object/array `class` literals and bare `cx(...)` behave
  differently in tagged-template due to its thunk-validation rule.

---

## 1. `$style` input surface (already parsed)

`nv-parser.ts extractStyleInfo` yields `NvStyleInfo { form: 'object' | 'factory',
keys: string[], source: string }`. This spec consumes that; it does not change parsing
to *start* (selector extraction in §2.2 may extend it).

- **`object` form:** static key→declaration map literal. `keys` populated. Friendliest
  to class-rewrite.
- **`factory` form:** a function returning the map. May read signals → dynamic values
  (§3). `source` retained verbatim.

Both forms may contain **key-form** entries (bare identifier, template-referenced) and
**selector-form** entries (CSS selector, no template handle). The form (object/factory)
and the entry-kind (key/selector) are orthogonal; classification in §2.1 is per-entry.

---

## 2. Scoping — hybrid per-entry routing (Ruling 1)

### 2.1 Classification (compile time, single pass, no runtime branch)

For each entry in the `$style` map, classify by the entry's *left-hand side*:

- **Key-form** ⇔ the LHS is a bare identifier (or simple string key) that the template
  references via `class={style.<key>}` (or array/object class form, §4). No CSS
  combinator/pseudo/selector syntax. → **class-rewrite** (§2.2).
- **Selector-form** ⇔ the LHS contains any of: descendant/child/sibling combinator,
  `:`/`::` pseudo, leading `.`/`#`, or a bare element-type name. No template handle.
  → **attribute-hash** (§2.3).

Ambiguity rule: if an LHS is a bare identifier that is ALSO never referenced by the
template, treat as key-form but emit a `warning` diagnostic (dead style key) — do not
silently attribute-hash it. Classification must be decidable from source alone.

### 2.2 Class-rewrite (key-form)

1. Compute `hash = simpleHash(componentIdentity)` (reuse the existing template-ID hash;
   one hash per component, not per entry).
2. For key `k`, emitted class name = `${k}_${hash}`.
3. Rewrite every template reference `style.k` (and object/array-form occurrences of the
   key, §4) to the literal `"${k}_${hash}"`.
4. Emit the declaration block under selector `.${k}_${hash}`.

No specificity inflation, no attribute selectors. This is the preferred path.

### 2.3 Attribute-hash (selector-form)

1. Same per-component `hash`.
2. Stamp `data-nv-s-${hash}=""` on every element in the component's `shape.html`
   (compile-time string transform on the shape, like the existing `data-nv-*` sentinel
   handling — but PERSISTED in shape.html, not stripped).
3. Rewrite each selector-form entry `S { decls }` → `S[data-nv-s-${hash}] { decls }`.
   For compound/descendant selectors, the attribute qualifier attaches to the SUBJECT
   (rightmost) compound per scoped-CSS convention (matches Vue/Svelte `scoped`).
4. `:global(...)` escape hatch (deferred — note as a v-next authoring affordance; for
   v1, selector-form is always scoped).

> **Strip-regex guard (verified):** the existing shape.html sentinel strip only matches
> `data-nv-(attr|prop|event|component)-<N>`. The `data-nv-s-<hash>` attribute has no
> trailing `-<N>` digit and uses an `s` segment, so it does NOT match and survives into
> shape.html — which is exactly what we need. This survival is currently INCIDENTAL.
> Increment S must (i) assert it with a test (stamped attribute present in emitted
> shape.html), and (ii) carry a guard comment that the strip regex must never be
> broadened to catch `data-nv-s-`.

Known leak (documented, accepted, same as Vue/Svelte): descendant combinators crossing
into slotted/child content. `$style × slots` (parked) addresses the slot-boundary case.

### 2.4 Output of scoping

Per component: a static CSS string (all static declarations from both key- and
selector-form entries, post-rewrite) + the set of stamped attributes baked into
shape.html + the key→className rewrite map applied to the template.

---

## 3. Reactive values — custom-property lowering (Ruling 3)

Applies to `factory`-form `$style` whose declaration values read signals. The factory is
**analyzed at compile time, NOT re-run at runtime.**

### 3.1 Static/dynamic split

> **Prerequisite (verified gap — do not skip):** `extractStyleInfo` currently captures
> the factory as `source: string` + `keys` — it does NOT retain the factory's
> `ts.Expression` node, and the `$style` source is NOT bare-read-erased
> (`preprocessMutationWrites` only rewrites `$script` *assignments*; it never touches
> `$style`, so a factory body reads `theme`, not `theme()`). The reactive-read detector
> `exprReadsSignal` and the eraser `eraseSignalReadsInNode` operate on `ts` nodes, which
> are not on `NvStyleInfo`. Therefore Increment S MUST first choose one of:
> - **(a)** extend `extractStyleInfo` to RETAIN the factory `ts.Expression` (or a parsed
>   per-declaration node map) so the split + erasure run on real nodes at parse time; or
> - **(b)** re-parse `source` to a `ts` node inside Increment S before walking.
> (a) is preferred — it keeps `$style` analysis in the parser alongside `$script`, reuses
> the SAME erasure walker, and avoids a second parse. This is a parse-layer extension,
> NOT a contract/IR concern. Pick (a) unless the seam argues otherwise.

Once the factory node is available, walk each declaration `prop: valueExpr` with the
same reactive-read detection as `$script` erasure (`exprReadsSignal`), and erase reads in
dynamic values with `eraseSignalReadsInNode` (so `theme` → `theme()`):
- `valueExpr` reads no signal → **static**: emit `prop: <value>` into the scoped CSS (§2).
- `valueExpr` reads ≥1 signal → **dynamic**: emit `prop: var(--nv-<key>-<prop>)` into the
  scoped CSS, and emit a reactive custom-property binding (§3.2) whose erased expression
  writes the var.

`<key>-<prop>` must be a stable, collision-free custom-property name (e.g.
`--nv-${k}_${hash}-${dashCase(prop)}`).

### 3.2 The dynamic binding

For each dynamic declaration, emit a reactive binding on the element(s) carrying the
scoped class:
- Effect: `el.style.setProperty('--nv-<key>-<prop>', String(valueExpr()))`.
- `valueExpr` erased exactly like any reactive hole (bare reads → `()` calls).
- One effect per dynamic custom property. Owned by the component root (standard `§6`
  ownership; disposed on unmount; severs cleanly).

Runtime cost: one `setProperty` per change. No factory re-run, no CSS re-parse, no
stylesheet mutation, no cascade recalc beyond the custom-property invalidation.

### 3.3 Which element gets the binding

The dynamic var must be set on an element such that the `var(--…)` reference resolves.
Simplest sound rule: set the custom property on the component's **root element(s)**
(custom properties inherit, so descendants resolve `var()`). If a component is
multi-root, set on each root (or a wrapper — but no wrapper is introduced silently;
multi-root handling follows the existing single-root guard discipline until multi-root
list/slot items lands). For v1, document the single-root assumption for dynamic `$style`.

### 3.4 Boundary (hard line)

Custom properties cover dynamic **values** only. Out of scope for §3, handled by
class-selection (§4) instead:
- a whole rule appearing/disappearing → toggle a class.
- a dynamic property *name* → toggle a class (or, rare, a `style` AttrBinding).
Do NOT mutate or re-inject stylesheets to handle these.

---

## 4. Class-selection — `class={...}` (separate increment)

All forms stay `class={...}`. No new attribute. The compiler routes on the **shape of
the expression** inside the braces (single compile-time classification).

### 4.0 Per-front-end form matrix (verified against `html-tag.ts` thunk validation)

The tagged-template FE validates that every hole is a function or a recognized sentinel
(slot/each), and THROWS on a bare non-function. So a bare object literal cannot be a
tagged-template `class` value. The per-key toggle path is therefore reached by each FE's
**idiomatic** surface — identical lowering, different spelling, exactly as `each`
(`<each>` vs `each(...)`) and slots (`slots.x` vs `slot(...)`) already split:

| Intent | `.nv` | tagged-template | Lowering |
|---|---|---|---|
| one opaque string (reassign) | `class={cx(...)}` | `class=${() => cx(...)}` | ONE full-string `AttrBinding` |
| fine-grained per-key toggle | `class={{ active: isActive() }}` (bare object/array literal) | `class=${classes({ active: isActive() })}` (sentinel) | per-key `classList.toggle` effects (§4.2) |
| static | `class="..."` in shape.html | `class="..."` in shape.html | untouched |

**Idiom rule (matches existing FEs):** the bare object/array literal is the `.nv` surface;
`classes(...)` is the tagged-template surface forced by thunk-validation. `.nv` does NOT
accept `classes(...)` call-form (object literal only), mirroring how `.nv` uses `<each>`
not `each(...)`. Both surfaces produce the SAME per-key toggle lowering and MUST be
FE-equivalence-gated against each other (shared oracle, as TC-EA-G2 did for `each`).

`classes(...)` is a **sentinel carrying the toggle structure** — NOT a string builder. It
must never be lowered to a string (that would collapse it into `cx` and lose per-key
granularity). It is the tagged-template analogue of the `.nv` object literal.

`classes(...)` and the object/array literal accept the SAME argument shape (§4.6):
`string | Record<string, unknown> | Array<string | Record<...>>`, mixed. Bare strings →
static/appended; object entries → per-key toggle.

### 4.1 Form → lowering

| `class={...}` content | Detected as | Lowering |
|---|---|---|
| function call (`cx(...)`), string literal, template literal, identifier returning string | "string expression" | ONE full-string `AttrBinding` on `class` (reassigns whole attribute) |
| object literal `{ k: boolExpr, … }` (`.nv`) / `classes({...})` sentinel (tagged-template) | "toggle map" | per-key effect: `el.classList.toggle(k, !!boolExpr())` — ONE EFFECT PER KEY |
| array literal `[strExpr, { k: boolExpr }, …]` (`.nv`) / `classes('btn', {...})` (tagged-template) | "mixed list" | bare-string elements → static/append; object elements → per-key toggle (as above) |
| (absent / static `class="..."` in shape.html) | static | untouched, stays in shape.html literal |

### 4.2 Per-key toggle semantics (object form)

- For object key `k` with boolean expr `b`: emit `effect(() => el.classList.toggle(k, !!b()))`.
- Erase `b` like any reactive hole.
- ONE effect per key: toggling `k` reads only `k`'s expr, never sibling keys. Strictly
  finer-grained than Solid's single looping effect.
- No diffing/prior-state bookkeeping needed — `classList.toggle(k, bool)` is idempotent
  and self-correcting.
- Keys may be multi-class strings (`'btn btn-primary'`); split on whitespace and toggle
  each token with the same boolean (matches Solid's documented behavior).

### 4.3 Per-key node-width fallback (gated)

Per-key emission costs N graph nodes for an N-key object. Emit a **compile-time
width-threshold**: above threshold T, fall back to ONE looping effect
(`effect(() => { for (const [k,b] of entries) el.classList.toggle(k, !!b()) })`) — Solid's
model. Default lean: per-key for small objects (the common 2–4 key case). T is gated on
real-app `ReactiveNode`-width evidence (ties to kind-split watch-item); do NOT hardcode a
final T without data — ship with a conservative T (e.g. per-key only for ≤ ~6 keys) and a
TODO to tune against evidence.

### 4.4 Dynamic key name

`{ [keyExpr()]: bool }` — the key itself is reactive. Per-key emission is impossible
(unknown key set at compile time). Compiler detects a computed/non-literal key →
fall back to the looping-effect form (§4.3) or full reassign. Detect and route; do not
fail.

### 4.5 Mixing strategies — DX rule

One element's `class` uses ONE strategy. `class={cx(...)}` → full reassign;
`class={{...}}` → per-key toggle. Mixing reassign + toggle on the same element re-creates
Solid's `class`+`classList` clobber bug. Document; optionally emit a `warning` if both a
string-expr `class` and a toggle-map are detected on one element (they can't both be the
single `class={...}` value, so this only arises via spread/merge — flag there). Static
literal classes in shape.html coexist with either strategy.

### 4.6 Helpers — `cx` (string builder) and `classes` (sentinel)

**`cx` — pure string builder, runtime utility, NOT a compiler construct:**
```
cx(...args): string
  // args: string | Record<string, unknown> | (string|Record<...>)[] | falsy
  // returns space-joined truthy class tokens
```
- Reads nothing reactive; subscribes to nothing. Reactivity is supplied by the enclosing
  thunk. In `.nv`, `class={cx(...)}` works (the compiler wraps it in the `class`
  AttrBinding thunk). In **tagged-template**, the bare `class=${cx(...)}` form THROWS
  (string, not function) — authors MUST write `class=${() => cx(...)}`. See §4.0.
- Never appears in IR or contract — by the time the `class` AttrBinding effect runs, `cx`
  has already returned a string. Result flows into a full-string `AttrBinding` (reassign).
- Exported from the published surface (renderer or a `@neutro/view/utils` subpath — pick
  at build time). Provisional name; owner may rename.
- ~10 lines; unit tests (truthy filtering, nested arrays, object precedence, falsy skip).
  No differential/back-end gate (touches no reactivity).

**`classes` — tagged-template sentinel, NOT a string builder:**
```
classes(...args): ClassesSentinel
  // args: same shape as cx — string | Record<string, unknown> | Array<...> | falsy
  // returns an opaque sentinel carrying the toggle structure (bare strings + boolExpr map)
```
- The tagged-template analogue of the `.nv` bare object/array literal. Recognized by the
  `html-tag.ts` walk + thunk-validator (added to the function-OR-sentinel allowlist
  alongside `each`/`slot`), exactly like `EachSentinel`/`SlotFillSentinel`.
- Lowers to per-key `classList.toggle` effects (§4.2), NOT a string. MUST retain its map
  structure through to lowering — never collapse to a string (that is `cx`'s job and
  would lose per-key granularity).
- The boolean exprs inside `classes({ active: () => isActive() })` are thunks (the medium
  requires it); the `.nv` object literal's values are erased bare-reads. Both arrive as
  per-key reactive accessors at lowering. FE-equivalence-gated against the `.nv` literal.
- Exported from the same surface as `each`/`slot`/`cx`. Provisional name (tracks `cx`).

---

## 5. Increment plan (neither commissioned yet)

**Increment S (`$style` scoping + injection):**
1. Per-entry classifier (§2.1) + diagnostics.
2. Class-rewrite path (§2.2) + selector-attribute-hash path (§2.3).
3. Static/dynamic factory split (§3.1) + custom-property bindings (§3.2–3.3).
4. Injection: hoist static scoped CSS once per component identity + dedup (Ruling 4).
   Mechanism chosen here (inline `<style>` hoist+dedup vs constructable stylesheets).
5. Gates: scoped CSS does not leak out (sibling component with same key unaffected) /
   in (parent rule does not style child); dynamic value updates via setProperty without
   re-parse; dedup across N mounts emits one stylesheet. Real-browser validation REQUIRED
   — jsdom's cascade is not authoritative (CC, not sandbox).

**Increment C (class-selection + `cx` + `classes`):**
1. Expression-shape classifier (§4.1) — `.nv` side (object/array literal in `class` hole).
2. Full-string AttrBinding path (exists — string expr is already an AttrBinding; the new
   work is *recognizing* the object/array forms and NOT treating them as a stringified
   `[object Object]`).
3. Per-key toggle emission (§4.2) + width-threshold fallback (§4.3) + dynamic-key
   fallback (§4.4), both back-ends (interpreter + emitted-mount).
4. `classes(...)` sentinel: new export + `html-tag.ts` validator/walk recognition
   (scaffold identical to `each`/`slot` sentinels) → same per-key toggle lowering.
5. `cx` helper (§4.6) + unit tests.
6. Gates: object form (`.nv`) and `classes(...)` (tagged-template) FE-equivalence-gated
   against each other (shared oracle, as TC-EA-G2 for `each`); `classList.toggle` per key
   (assert one class toggles without touching siblings, node not rebuilt); full-string
   form → single attribute reassign; differential parity interpreter vs emitted;
   fail-shows-teeth (per-key effect that
   reads the wrong key fails).

**Sequencing:** S and C are independent — either order, or parallel (different seams: S
touches `$style` extraction + CSS emission; C touches `class` binding classification).
`$style × slots` is specced only AFTER S lands.

---

## 6. Template-IR impact — decided at build time, NOT asserted now

- **Class-selection:** object/array `class` forms (and the `classes(...)` sentinel) need
  the compiler/interpreter to carry a per-key toggle map, not a string. Two options,
  choose at build:
  (a) keep `AttrBinding` and discriminate on value type at wire time (no IR change), or
  (b) add a thin `ClassListBinding` discriminant (cleaner, an IR bump to v0.4.x).
  **Lean shifted to (b):** now that tagged-template carries the toggle map across the FE
  boundary as a `classes(...)` sentinel (a structured value, not a string), a dedicated
  binding shape is the honest representation — both FEs converge on the same
  `ClassListBinding` exactly as both converge on `ListBinding` for `each`. (a) remains
  viable if the per-key path stays trivial. **Decide when building Increment C, seam in
  front of you.**
- **`$style` dynamic values:** the custom-property binding is an effect doing
  `el.style.setProperty`. This is expressible as a `PropBinding`-like effect with no new
  kind, OR a thin `StyleVarBinding`. No `StyleBinding` exists in `ir.ts` today (verified).
  **Decide when building Increment S.**
- Either bump is Template-IR only (renderer contract), never reactive-core. Confirmed by
  Constraint 1.

---

## 7. Open sub-points carried (not blocking the spec)

- Factory static/dynamic split assumes signal reads are statically detectable in the
  factory body (true for the `$script` erasure machinery; confirm `$style` factory bodies
  go through the same walker — and resolve the AST-availability prerequisite in §3.1
  first: `extractStyleInfo` must retain the node, option (a)).
- Width-threshold T for §4.3 is a placeholder pending evidence.
- `:global(...)` escape hatch (§2.3) deferred to v-next.
- Multi-root dynamic-`$style` element targeting (§3.3) follows the single-root guard
  until multi-root list/slot items lands.
- **`$style` is `.nv`-FE-only** (§0). Decide whether tagged-template ever gets a parallel
  scoping affordance, or stays "plain class + external CSS." Likely never — `$style` is a
  `.nv` ergonomic; tagged-template is the lower-level surface.
- **Object/array `class` form across FEs (§4.0) — RESOLVED 2026-06-22:** `.nv` uses the
  bare object/array literal; tagged-template uses the `classes(...)` sentinel; same per-key
  toggle lowering, FE-equivalence-gated. Matches `each`/`slot` idiom. `cx` is the
  string-builder in both FEs. No longer open.
- **Key + same-name selector DX caveat (§2.2/§2.3):** a key `card` (→ `card_<hash>`,
  class-rewrite) and a selector `.card` (→ `.card[data-nv-s-<hash>]`, attribute-hash) in
  the SAME component both reference logical "card" via different mechanisms. Not a
  correctness bug (distinct emitted selectors), but a potential author surprise. Document
  in authoring docs; optionally emit an `info`/`warning` diagnostic when a key and a
  same-named class selector coexist.
