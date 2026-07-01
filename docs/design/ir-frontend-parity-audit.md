# IR Front-End Parity Audit — `single IR, two front-ends` invariant

## Resolution status (2026-06-30, tagged-fe-parity plan)

The four gaps identified below have been worked through Tasks 1–3b of the tagged-fe-parity
plan. Current status per kind:

- **`conditional`** — **CLOSED**, by a design ruling, not a code gap. `.nv` has no
  `<iff>`/`<if>`/`<show>` element and never will — the native ternary already is the
  conditional form, and an element would be redundant sugar. The tagged-template front-end
  got an `iff(condition, consequent, alternate?)` sentinel builder (Task 1, commit `cfc1843`,
  `src/renderer/html-tag.ts`) — note the shipped name is `iff`, not the `when`/`show` names
  floated in the "CRUX RESOLVED" section below. Both forms produce identical
  `ConditionalBinding` IR. This asymmetry (ternary + no element vs. builder-only) is
  documented as *principled*, not a lingering gap — see `docs/template-ir.md` §3.6 and
  `docs/guides/rendering.md` ("Conditionals" / "Tagged-template: `iff()` function") and
  `docs/guides/authoring-nv.md` ("Conditional Rendering"). (Task 3b)
- **`recycled-list`** — **CLOSED** in code. `recycle()` sentinel builder shipped (Task 2,
  commit `c3681c8`), mirroring `each()`. Symmetric across both front-ends (`<recycle>`
  element + `recycle()` builder) — contrast with `conditional`'s asymmetry above.
- **`style-var`** — **CLOSED**, by a design ruling (Kofi, 2026-06-30): `$style` is
  legitimately `.nv`-only, a compile-time file feature analogous to an SFC
  `<style scoped>` block, not an IR-parity obligation. **No tagged builder is planned.**
  Documented in `docs/template-ir.md` §3.7.3 and `docs/guides/rendering.md`
  ("Scoped styles with `$style`"). The forthcoming Task 4 forcing-function wires `style-var`
  as an explicit, commented deferral in the tagged exhaustiveness switch rather than a
  silent no-op case. (Task 3)
- **`child`** — still open; unresolved whether it is a real gap or subsumed by the tagged
  `text` hole. Out of scope for Tasks 3/3b; left for a future increment.
- **`sync`** (conditional-target form) — still an open, documented small debt (footnote ¹
  below); unaffected by Tasks 3/3b.

The original audit (verified at `0654b63`) is preserved below unedited for the historical
record and the seam-read reasoning that led to the `iff()`/`recycle()` builder pattern.

---

# IR Front-End Parity Audit — `single IR, two front-ends` invariant

**Verified at `0654b63` by reading source (not inferred).** The invariant: one Template IR, authorable from BOTH front-ends (`.nv` compile + `html\`\`` tagged-template runtime) and handled by all back-end consumers. A kind in the IR that isn't buildable from a front-end is a **parity break = tech debt**.

## The correction that prompted this
I described nv's conditional as "`<Show>`-equivalent" (Solid vocabulary) and spot-checked only two kinds. That was two errors: (1) importing incumbent naming as if it described nv — it doesn't; nv's constructs are defined by nv's source, incumbents are inspiration to *try things*, never a map of what nv has; (2) spot-checking instead of auditing the full matrix. This audit is the full matrix.

---

## The matrix (all 15 IR binding kinds × each consumer)

| IR kind | `.nv` parser (compile FE) | `html\`\`` tagged (runtime FE) | interpreter | emitter | ir-equivalence |
|---|:---:|:---:|:---:|:---:|:---:|
| `text` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `attr` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `prop` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `event` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `sync` | ✅ | ⚠️ partial¹ | ✅ | ✅ | ✅ |
| `classlist` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `toggle` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `static` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `list` (`<each>`) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `component` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `slot-outlet` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **`conditional`** | ✅ | **❌ MISSING** | ✅ | ✅ | ✅ |
| **`recycled-list` (`<recycle>`)** | ✅ | **❌ MISSING**² | ✅ | ✅ | ✅ |
| **`style-var`** | ✅ | **❌ MISSING** | ✅ | ✅ | ✅ |
| **`child`** | ✅³ | **❌ MISSING** | ✅ | ✅ | ✅ |

¹ `sync`: tagged path handles single-accessor `:value="${val}"` but DEFERS conditional-target form `:value="${() => cond ? a : b}"` (html-tag.ts L392-395, documented small debt).
² `recycled-list`: known — deferred as the T-8 gap during the `<recycle>` commission (tagged `recycle()` builder non-trivial).
³ `child`: `.nv` builds it; v0 is primitive-only (DOM Node / TemplateIR values deferred, ir.ts L146). May be authored via text-hole in tagged path — needs confirmation whether it's a real gap or subsumed by `text`.

## The break, stated plainly
**Four IR kinds are `.nv`-authorable but NOT buildable from the tagged-template runtime front-end:** `conditional`, `recycled-list`, `style-var`, `child`. The interpreter, emitter, and ir-equivalence all handle every kind (back-end parity is intact). **The break is specifically the tagged-template FRONT-END (`html-tag.ts` / `buildHtmlHoleBinding` + `walkNodeList`).**

This violates the "single IR, two front-ends, parity" invariant. Every one of these is a case where an author using `html\`\`` cannot express something a `.nv` author can — silent tech debt, and it's been accumulating (conditional predates recycle; recycle added to it; switch/match would add a fifth if built `.nv`-only).

---

## Why this matters beyond the four kinds (the systemic point)

The pattern is: **control-flow and advanced constructs land `.nv`-first, and the tagged-template runtime path silently lags.** Left unchecked, every new control-flow construct (`<switch>`/`<match>` next) widens the gap. This is exactly the tech-debt bleed BCon flagged. The fix is not just "add these four" — it's:

1. **Close the current four** (conditional, recycled-list, style-var, child) in the tagged path.
2. **Establish a parity gate** so a new IR kind CANNOT land without both front-ends (or an explicit, logged deferral with a tracking item — not a silent gap). The `emitted-mount.ts` exhaustiveness stub already forces the emitter to acknowledge new kinds; an equivalent forcing function is needed for `buildHtmlHoleBinding` / the tagged walk, so a missing case fails typecheck instead of silently no-op'ing.

---

## Scope for the fix (each needs a seam-read before speccing — do NOT assume difficulty)

- **`conditional` in tagged path:** the deferral comment (L394) says "read direction non-trivial to derive in the tagged path." The `.nv` path derives it from a ternary of `html\`\`` at parse time via TS AST (`ts.isConditionalExpression`). The tagged runtime path has no TS AST — it sees evaluated values. **The real question: can a runtime `html\`\`` even distinguish `${cond ? html`a` : html`b`}` as a conditional, or does it just see the already-chosen branch?** This is the crux — it may be that the tagged path *fundamentally cannot* author a reactive conditional the same way (the ternary is evaluated once at call time unless wrapped in a thunk). **Read this seam carefully — it may be a genuine expressivity difference, not just missing code.** If so, the tagged conditional needs a different authoring form (a thunk: `${() => cond() ? html`a` : html`b`}`) and that's a design decision, not a bug-fix.
- **`recycled-list` in tagged path:** the T-8 gap. Needs a `recycle()` builder in the tagged surface. Seam: how `list` is built structurally in `walkNodeList` (html-tag.ts L736) — recycle mirrors it.
- **`style-var` in tagged path:** smaller. How `.nv` builds it (nv-parser.ts L2174) vs the tagged walk.
- **`child` in tagged path:** confirm first whether it's a real gap or subsumed by the tagged `text` hole. May be a non-issue.

---

## Recommended sequencing (BCon's call)

**Option 1 — fix parity FIRST, then `<switch>`/`<match>`.** Close the four gaps + install the parity gate, so `<switch>`/`<match>` lands into a both-front-ends-enforced world and doesn't add a fifth gap. Pays the debt before adding to it.

**Option 2 — `<switch>`/`<match>` first, parity sweep after.** Faster to the named feature, but adds a fifth `.nv`-only construct to the backlog and lands into an un-gated world.

**My recommendation: Option 1.** BCon's instruction is explicit — "fix all the issues, don't cause tech debt." Building `<switch>`/`<match>` `.nv`-first while four kinds already lag would be knowingly adding to the debt. Close parity + install the forcing function first; then every control-flow construct including switch/match is both-front-ends by construction. The conditional-in-tagged-path seam-read (is it expressible at all?) is the first thing to resolve, because if the tagged path fundamentally can't do reactive conditionals the same way, that reshapes the whole parity story and needs a design ruling before anything else.

---

## CRUX RESOLVED (seam read at `0654b63`)

The two front-ends work fundamentally differently, and this explains the entire gap — it is NOT "missing code," it is a **known authoring-form pattern the missing kinds haven't been given yet**:

- **`.nv` path (compile-time)** has the **TypeScript AST**. It sees `${cond ? html\`a\` : html\`b\`}` as a `ts.ConditionalExpression` before evaluation — reads both branches + condition as *syntax*, builds `ConditionalBinding` with reactive re-evaluation. The ternary is analyzed, never run at author-time.
- **Tagged path (runtime)** — `html\`\`` is a function receiving **already-evaluated** values. JS runs `cond ? html\`a\` : html\`b\`` *before* calling `html()`, so the runtime sees one branch's result, not the ternary. **It cannot detect "this was a conditional" — the language already collapsed it.**

**This is why `<each>` works in the tagged path but conditional doesn't:** the tagged path uses a **sentinel pattern** for control flow. `each()` (html-tag.ts L220) returns an `EachSentinel` — an object with `.items`/`.key`/`.factory` as **functions** (deferred, so reactivity survives), which `html()` detects by shape (`isEachSentinel`, L205). The author writes `${each(items, key, factory)}`, not a raw loop.

**So the fix pattern is uniform and known:** the missing control-flow kinds need **sentinel builders** in the tagged path, mirroring `each()`:
- `conditional` → a `when()` / `show()` builder returning a `ConditionalSentinel` (thunk condition + factory branches): `${when(() => cond(), () => html\`a\`, () => html\`b\`)}`. The thunks preserve reactivity the raw ternary loses.
- `recycled-list` → a `recycle()` builder returning a `RecycledSentinel`, mirroring `each()`.
- `style-var`, `child` → smaller; confirm authoring form.

**Existing tagged control-flow builders (the templates to mirror):** `each`, `slot`, `slots`, `classes`, `cx`, `create` (html-tag.ts). The missing ones (`when`/`show`, `recycle`) are the same shape.

**Important design consequence:** the tagged path's conditional authoring form will NOT be a ternary (can't be — evaluated too early). It will be a `when()`/`show()` sentinel. That's a deliberate **asymmetry in authoring syntax** between the two front-ends (`.nv` uses ternary sugar the compiler analyzes; tagged uses an explicit builder) — BUT they produce the **same IR** (`ConditionalBinding`). That's the invariant that matters: **same IR, different surface sugar, full parity at the IR level.** The two front-ends were never meant to have identical *syntax* — they're meant to produce the identical *IR*. The gap is that the tagged path is missing the builders that produce these IR kinds, not that it needs to parse ternaries.

## Immediate next step
Spec the tagged-path sentinel builders (`when`/`show` for conditional, `recycle` for recycled-list, forms for style-var/child) mirroring `each()`. Plus the parity forcing-function (a `buildHtmlHoleBinding`/tagged-walk exhaustiveness check so a new IR kind fails typecheck without a tagged builder or a logged deferral). This closes the four gaps and prevents the fifth (`switch`/`match`). THEN build `<switch>`/`<match>` into the gated, both-front-ends world.
</content>
