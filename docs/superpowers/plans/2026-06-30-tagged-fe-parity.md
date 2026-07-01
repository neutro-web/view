# Commission — Tagged-Template Front-End Parity (`2026-06-30-tagged-fe-parity.md`)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps. **Closes the IR-front-end parity break: kinds authorable from `.nv` but NOT from the `html\`\`` tagged-template runtime front-end. Additive to `html-tag.ts` + a new exhaustiveness forcing-function. No `.nv` path change, no IR change, no core touch.**

**Verified at `0654b63`.** Source: the IR-front-end parity audit (`ir-frontend-parity-audit.md` → move to `docs/design/`).

## The invariant being restored
One Template IR, authorable from BOTH front-ends (`.nv` compile + `html\`\`` tagged runtime), same IR out. The two front-ends have **different surface syntax by design** (`.nv` uses ternary/`$`-sugar the compiler analyzes via TS AST; tagged uses runtime **sentinel builders** because `html()` receives already-evaluated values — it cannot see a ternary). Parity is at the **IR level**, not the syntax level. The break: three IR kinds have no tagged-path builder.

## Scope (resolved by seam-read — NOT the audit's raw 4)
The audit flagged 4 missing kinds. Seam-reads resolved them to **2 build + 1 ruling + 1 non-issue**:

| kind | status after seam-read | action |
|---|---|---|
| `conditional` | real gap — general control flow, needs a tagged sentinel builder | **BUILD: `iff()` builder** |
| `recycled-list` | real gap — the T-8 deferral; needs a tagged builder mirroring `each()` | **BUILD: `recycle()` builder** |
| `style-var` | **RULED `.nv`-only** (Kofi, 2026-06-30): `$style` is a compile-time `.nv`-file feature (like SFC `<style scoped>`); absence from a runtime tagged literal is a front-end-shape difference, NOT an IR-parity break. | **OFF THE LIST — not a gap. Document the boundary.** |
| `child` | NOT a gap — v0 `ChildBinding` "requires manual IR (both FEs)" (nv-parser L48); text-position holes → `TextBinding` in BOTH paths equally. Designed-deferral, symmetric. | **NONE — off the list** |

Naming ruling (LOCKED by Kofi): conditional builder = **`iff()`** (not `if` — reserved word forces `import { if as ... }` on every consumer; `iff` is the logician's "if and only if", imports clean, reads as `if`). NOT `when`/`show` (incumbent bleed).

---

## Global constraints
- **G0 HALT:** no `.nv`-path change (`nv-parser.ts` conditional/recycle building stays), no IR change (`ir.ts`), no `src/core/*`. This is ADDITIVE to `html-tag.ts` only, plus one new exhaustiveness check.
- **G1 same IR out:** `iff()` must produce a `ConditionalBinding` structurally identical to what `.nv`'s ternary produces; `recycle()` must produce a `RecycledListBinding` identical to `.nv`'s `<recycle>`. Verify via `ir-equivalence` (the `bindingEqual` cases already exist for both kinds).
- **G2 sentinel pattern:** mirror the EXISTING `each()` sentinel (html-tag.ts L198-224: `EachSentinel` interface + `isEachSentinel` shape guard + `each()` builder). Do NOT invent a new detection mechanism — `iff`/`recycle` are the same shape as `each`.
- **G3 forcing function:** the whole point — after this, a new IR kind must FAIL TYPECHECK if it has no tagged builder (or a logged deferral). See Task 4.
- **Done = committed on main, verified at SHA.**

---

## Task 1 — `iff()` conditional builder (html-tag.ts)

- [ ] Mirror `each()` (L198-224). Add:
  ```ts
  export interface ConditionalSentinel {
    __nvConditional: true
    condition: () => boolean
    consequent: () => TaggedTemplateResult   // html`` factory
    alternate: (() => TaggedTemplateResult) | null
  }
  function isConditionalSentinel(v: unknown): v is ConditionalSentinel { /* shape guard like isEachSentinel */ }
  export function iff(
    condition: () => boolean,
    consequent: () => TaggedTemplateResult,
    alternate?: (() => TaggedTemplateResult) | null,
  ): ConditionalSentinel { /* returns the sentinel */ }
  ```
- [ ] Authoring form: `${iff(() => cond(), () => html\`<p>yes</p>\`, () => html\`<p>no</p>\`)}`. Thunks preserve reactivity (the raw ternary can't — it's evaluated before `html()` sees it; THIS is why the builder exists).
- [ ] In the tagged walk (`walkNodeList` / the hole dispatch), detect `isConditionalSentinel` and build a `ConditionalBinding` — the SAME IR `.nv` produces. Resolve `consequent`/`alternate` factories to their branch IR (call the factory, `processHtmlTemplate` the result — mirror how `each`'s `factory` is handled).
- [ ] **G1 gate:** an `iff()` and the equivalent `.nv` ternary must produce `bindingEqual`-identical `ConditionalBinding`s. Add a test asserting it.

## Task 2 — `recycle()` list builder (html-tag.ts)

- [ ] Mirror `each()` exactly (it's the same structural shape — a list). Add `RecycledSentinel` + `isRecycledSentinel` + `recycle()`:
  ```ts
  export function recycle(
    items: () => readonly unknown[],
    factory: (item: () => unknown, index: () => number) => TaggedTemplateResult,
  ): RecycledSentinel { /* NO key — position identity */ }
  ```
- [ ] Detect in the walk, build `RecycledListBinding` (kind `'recycled-list'`) — same IR as `.nv` `<recycle>`. indexSig always allocated (mirror the interpreter's always-allocate; the tagged path already does this for lists per the L741 note).
- [ ] **G1 gate:** `recycle()` vs `.nv` `<recycle>` produce `bindingEqual`-identical IR. Test it.
- [ ] Closes the T-8 gap.

## Task 3 — style-var: RULED `.nv`-only (no build)
Kofi ruled (2026-06-30): `$style`/style-var is legitimately `.nv`-only — a compile-time file feature, not an IR-parity obligation. **No tagged builder.** Action: document the boundary in the parity audit + authoring docs (`$style` and its reactive CSS vars are a `.nv`-file affordance; tagged authors use inline `style=` / userland CSS-in-JS). In the Task-4 forcing function, `style-var` is wired as an explicit, commented deferral (`case 'style-var': /* .nv-only: $style compile-time feature, no tagged form by design */ break`) — so it's a typechecked, documented decision, not a silent gap.

## Task 3b — Document the `iff` asymmetry (conditional has NO `.nv` element, by design)
**Verified: `.nv` has no `<iff>`/`<if>`/`<show>` element — the conditional is authored ONLY as a ternary** (`${cond ? html\`a\` : html\`b\`}`, `ts.isConditionalExpression`). `iff()` is **tagged-template-only**, and this is correct by design, not a gap:
- `.nv` uses the language-native ternary (the compiler analyzes it via TS AST). Adding an `<iff>` element would be redundant sugar competing with the ternary.
- Tagged can't use the ternary (evaluated before `html()` sees it) → `iff()` builder.
- **Principle:** use the language's own form where it exists (ternary → conditional); use an nv construct where it doesn't (element/builder → lists). This is why `<each>`/`<recycle>` are `.nv` elements (no native loop-expression) but conditional is not.
- [ ] Document explicitly in authoring docs: "conditional = ternary in `.nv`, `iff()` in tagged, both → `ConditionalBinding`. No `<iff>` element by design." Prevents a future reader mistaking the asymmetry for a gap.
- Note the contrast: `recycle` is symmetric (`<recycle>` element in `.nv` + `recycle()` builder in tagged); `conditional` is asymmetric (ternary in `.nv` + `iff()` in tagged, no element). Both are principled per the rule above.

## Task 4 — The forcing function (the durable fix — prevents the NEXT gap)

The reason parity broke silently: nothing forced the tagged path to acknowledge new IR kinds. The emitter has this (the `emitted-mount.ts` exhaustiveness `default: never` stub). The tagged path needs the equivalent.

- [ ] Add an exhaustiveness check in the tagged-path binding dispatch: a `switch`/handler over IR `kind` where the `default` branch is `const _exhaustive: never = kind` (or equivalent), so a NEW IR kind added to `ir.ts`'s `Binding` union **fails typecheck** in `html-tag.ts` until it has either a builder or an explicit, commented deferral (`case 'child': /* deferred — manual IR only, see ir.ts L48 */ break`).
- [ ] Wire the currently-deferred kinds through it explicitly (child → documented deferral; style-var → per §4 ruling). So the tagged path's coverage is now a typechecked contract, not an accident.
- [ ] **This is the real deliverable.** Tasks 1-2 close today's gap; Task 4 ensures `<switch>`/`<match>` and every future kind CANNOT land `.nv`-only silently.

## Task 5 — Tests + docs
- [ ] Real-browser (or interpreter-mount) tests: `iff()` renders + toggles reactively; `recycle()` renders + recycles. Mirror existing `each()` tagged tests.
- [ ] G1 equivalence tests (Tasks 1, 2).
- [ ] `template-ir.md` / authoring docs: document the tagged control-flow builders (`each`, `iff`, `recycle`) as the tagged-path surface, noting the `.nv`-uses-sugar / tagged-uses-builders asymmetry produces the same IR.

---

## §4 — RESOLVED (Kofi, 2026-06-30): style-var / `$style` is `.nv`-only

**Ruled (a):** `$style`/style-var is legitimately a `.nv`-file feature. The `$style` block is a compile-time `.nv` construct (like SFC `<style scoped>`); its absence from a runtime tagged literal is a front-end-shape difference, not an IR-parity break. style-var is the IR *output* of that `.nv` affordance — the tagged path not having `$style` is not the same as failing to express a shared construct. Tagged authors use inline `style=` / userland CSS-in-JS for dynamic styles. **style-var is off the parity list; wired as a documented deferral in the Task-4 forcing function.**

---

## Sequencing (supersedes the `<switch>`/`<match>` handoff)

This parity fix goes BEFORE `<switch>`/`<match>`. Rationale: building switch/match `.nv`-first while conditional+recycle already lag the tagged path would add a FOURTH gap into an ungated world. Close parity + install the forcing function (Task 4), THEN switch/match lands into a both-front-ends-enforced world by construction — and switch/match will itself need both a `.nv` form AND a tagged `iff`-family builder (`match()`/`switch()` sentinel), which Task 4 will *force* rather than leave optional.

Revised order: **(1) this parity commission → (2) `<switch>`/`<match>` into the gated world.**

## Decision-log delta (CC applies on land)
- Entry: tagged-FE parity restored — `iff()` (conditional) + `recycle()` builders added to `html-tag.ts`, same IR as `.nv`; exhaustiveness forcing-function added (new IR kind fails typecheck without a tagged builder/deferral); `child` confirmed symmetric-deferral (not a gap); style-var per §4 ruling. Closes T-8. Cites the parity audit.
- Current State: tagged front-end at IR parity with `.nv` for control flow; forcing-function prevents silent regression; `<switch>`/`<match>` next, into the gated world.
