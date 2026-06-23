# Spec — `$style × slots`: scope-carry across the slot boundary

**Status:** DRAFT for architect approval. Workstream 3 (renderer/templating).
**Depends on:** Increment S (S1+S2) landed 2026-06-23 — the class-rewrite-vs-attribute-hash
discriminant is what makes this answerable.
**Touches:** Template-IR (no version bump expected — no new IR member; see §6), both front-ends,
both back-ends. reactive-core **untouched**.
**Escalation:** in-stream EXCEPT one ruled point (§5, cross-boundary selector observation) which
is escalation-level and is surfaced, not decided, here.

---

## 1. Problem

Parent-authored slot content renders inside the child, adjacent to child-scoped elements.
When that content contains a class-form `$style` token, whose scope hash does the token carry —
the parent's (who authored it) or the child's (in whose subtree it renders)?

This was parked behind S1+S2 *implementation* because the answer depends on how scope is
encoded. With S1+S2 landed, the encoding is known: **class-form = compile-time token
substitution** (`card` → `card_<hash>`), **selector-form = runtime descendant match**
(`:where([data-nv-s-<hash>])`). The two are asymmetric across a boundary, so they are ruled
separately.

## 2. Seam facts (verified on `main`, content read — not inferred)

| # | Fact | Location |
|---|------|----------|
| F1 | Slot content IR built during the parent walk; captured **by reference** into a `SlotContent` closure: `(_props) => namedIR`. | nv-parser.ts L656, L677 |
| F2 | `buildStyleArtifact` + `patchClasslistTokens` run **after** the walk, on `renderResult.ir`. | nv-parser.ts L1988–2003 (parse), L2899–2914 (emit) |
| F3 | `patchClasslistTokens` handles `classlist`/`conditional`/`list`. **No `component` case** — it never descends into `ComponentBinding.slots[].content`. | nv-parser.ts L1870–1894 |
| F4 | Emit path emits slot content as `ThunkSource[]` **source strings**, not an IR object. | nv-parser.ts L2568–2602 |
| F5 | `classRewrites` is built purely from `styleInfo.objExpr` keys; **no render-IR / walk / reactive dependency**. | nv-parser.ts L1758–1804 |
| F6 | `scopeHash = simpleHash(renderResult.ir.id)` — the one coupling: the seed exists only after the walk yields `renderResult`. | nv-parser.ts L1988 / L2899 |

**Consequence of F1–F4:** today, class-form `$style` tokens in slot content are rewritten by
**neither** parent nor child. They render raw. This is a silent gap, not a designed behavior.
It is the OPEN-7 family (the patch walk re-skips a kind handled elsewhere) — now for `component`
instead of `list`. The fix must **collapse to one total walk / one build-time rewrite**, not add
a parallel second path (slot subsystem bitten 4×).

## 3. Semantic ruling (proposed): scope-by-lexical-author (parent-wins)

**Rule.** Class-form `$style` tokens authored in parent-supplied slot content carry the
**parent's** scope hash. A child reaches into slot content's styling **only** via (a) its own
outlet wrapper element, or (b) selector-form keys (subject to §5) — **never** by class-form
rewrite of tokens the child did not author.

**Why this and not child-wins:**
- **Lexical authorship (D-slot-1).** Slot content is authored and owned in the parent's lexical
  scope. Class scope should follow authorship, as every other binding in that content does.
- **CSS-author intuition.** The parent wrote `.card`; the parent's stylesheet defines
  `.card_<parenthash>`. Child-wins would silently rebind the parent's class to a hash the parent
  has no rule for — the token would resolve to nothing.
- **`::slotted`-analog is selector-form.** A child that *wants* to reach slot content styles it
  via selector-form (the runtime descendant mechanism), which is the natural place for
  "style what's projected into me." Class-form is authorship; selector-form is projection reach.

**Steelman of child-wins, and where it leaks:** child-wins matches "it visually lives in the
child," and would make a single hash govern the whole rendered subtree (simpler mental model for
the *child* author). It leaks because it requires rewriting tokens the parent authored against
the parent's stylesheet — the rewritten token has no matching rule unless the child happens to
define one, which it cannot (it never saw the parent's class names). Child-wins turns every
parent class-form token in slot content into a dead class. Rejected.

## 4. Mechanism — the seam collapses the choice to one

Two mechanisms were considered. The seam **eliminates A**:

- **Mechanism A — total-walk into slot factories** (add a `component` case to
  `patchClasslistTokens`, mirroring the `list` case: call `content(stub)`, recurse, patch in
  place). **Non-viable as the real mechanism.** (i) It depends on the factory returning the same
  captured IR object by reference (true for `.nv` parse today, F1) — but the scoped-slot factory
  shape `(props) => TemplateIR` explicitly permits fresh IR per call; patching a stub-call's
  throwaway IR then sticks nothing. (ii) The **emit path has no IR object** (F4) — slot content
  is source strings. A cannot run on the authoritative mount path at all. Adopting A would create
  exactly the parse/emit divergence differential conformance forbids.

- **Mechanism B — rewrite at build time, before capture/emit.** Apply the class-rewrite map to
  slot-content tokens *as the slot content is built* (parse: inside `buildNvSlotContentIR` before
  the closure captures `namedIR`; emit: when slot thunks/static tokens are emitted, L2581+).
  Works identically on both paths. **Sole viable mechanism.**

**The one build-order fact B requires (F5 + F6).** The rewrite map is static and hoistable
(F5), but `scopeHash` originally seeded from `renderResult.ir.id`, available only post-walk (F6).

**RESOLVED 2026-06-23 — B3 (supersedes B1/B2 framing).** CC halted at this exact circularity:
`ir.id = simpleHash(reserializedShape)` is post-walk (nv-parser L1101); slot content is built
during the walk. Architect ruling: derive `scopeHash` from **pre-walk `shapeHtml`** (nv-parser
L883), not `ir.id`. Change the two scopeHash sites (L1988, L2899) to `simpleHash(shapeHtml)`;
leave `ir.id` untouched.

- `shapeHtml` is available before `walkNvNodeList` → slot content built during the walk carries
  the scope hash directly. No post-walk slot rebuild, no `walkNvNodeList` return restructure.
- G3 seed-equality is now trivially true: both back-end sites use the identical pure input
  `shapeHtml`.
- `ir.id` (post-walk, mounted-shape identity) and `scopeHash` (pre-walk, style identity) cleanly
  decoupled; injection dedups on `scopeHash`, mount/cache on `ir.id` — correct that these differ.
- **B1a rejected** (redefining `ir.id` input = unbounded core-IR-identity blast radius).
  **B2 retained as fallback only** (sound but unnecessary restructure).
- **Behavioral change:** scopeHash values change for styled components containing child
  components (`shapeHtml` ≠ `reserializedShape`). S1+S2 hash-pinned fixtures regenerate. See G3'.

## 5. RULED — slot content is opaque to child selector-form scope (NO, reading (b))

**Ruling (architect, 2026-06-23): NO.** A child's selector-form scope does **not** deliberately
reach parent-authored slot content. No `::slotted` analog in this increment.

**Precise guarantee — reading (b), nv-does-not-invent-CSS-consistent:** nv guarantees it
**never deliberately tags parent-projected nodes with the child's `data-nv-s-<childhash>`
attribute** and never rewrites tokens the child did not author. nv does **not** guarantee
non-match. A child's plain descendant selector (e.g. `:where([data-nv-s-<childhash>]) .icon`) may
*incidentally* match a projected `.icon` node at runtime if that node is a DOM descendant of the
child's outlet — that is the CSS cascade doing what it does, and the author owns it. nv routes and
rewrites; it does not police the cascade. Actively defeating cross-boundary match (reading (a))
was rejected: it would require nv to invent CSS semantics, violating the locked principle.

**Consequences:**
- **No attribute carry onto slot nodes.** Confirms §6: no Template-IR shape change, no version
  bump from this axis.
- **Symmetry with §3.** Each side deliberately scopes only what it authored — parent class-form
  carries parent hash; child never deliberately tags parent content. Clean ownership boundary.
- **`::slotted`-analog deferred.** If a concrete layout-shell use case later demands child reach,
  it returns as its own increment (narrow-YES: top-level-projected tagging) — out of scope here.

**Gate impact:** G6 below tests the *guarantee*, not non-match — it asserts nv places no
`data-nv-s-<childhash>` on projected nodes, and that incidental match (where DOM nesting causes
it) is not treated as a defect.

## 6. IR / contract impact

- **No new IR member.** Parent-wins via B is a build-time rewrite of existing `classlist`/static
  tokens within slot content. `SlotContent` / `SlotEntry` / `SlotOutletBinding` shapes unchanged.
- **Template-IR version:** no bump expected (no shape change). Confirm at land; if the §5 ruling
  forces an attribute carry on slot nodes, re-evaluate.
- **reactive-core:** untouched. No §1 invariant; the rewrite is a compile-time static
  substitution with no tracked read and no write-during-propagation.

## 7. Gates (each failable on inspection; both back-ends; real-browser where noted)

| ID | Check | Evidence command | Fails if |
|----|-------|------------------|----------|
| G1 | Parent class-form token in slot content carries **parent** hash | mount, inspect class on projected node | class is raw `card` or `card_<childhash>` |
| G2 | **Fresh-IR-factory** slot content (factory builds new IR per call) still rewritten — the case Mechanism A passes structurally while emitting wrong DOM | factory that returns `{...spread}` per call; mount; inspect | rewritten only when factory returns captured-by-ref IR |
| G3 | scopeHash = `simpleHash(shapeHtml)` at both sites (B3); identical input both back-ends | grep both sites; assert equal hash for same component | sites use `ir.id` or differing input |
| G3' | Two styled components, identical `$style` + identical `shapeHtml`, different child-component composition → share scopeHash (correct: same authored style = same scope); injection dedup merges only style identity | mount both; inspect scope hash + injected sheet count | hashes differ, OR dedup wrongly merges non-style identity |
| G4 | Differential: parse-path IR ↔ emit-path output agree on slot-content class tokens (shared oracle, not structural-only) | ir-equivalence + emit-exec on same corpus | parse and emit disagree on any token |
| G5 | Nested: class-form token in `<each>`-inside-slot-content rewritten (OPEN-7 × slots) | depth-2 mount | nested token raw | **[DEFERRED 2026-06-23]** `<each>`-in-slot not yet wired: `buildNvSlotContentIR` discards `lists` from `walkNvNodeList` (L772). `patchClasslistTokens` list-case will handle it automatically once `<each>`-in-slot lands in its own increment. |
| G6 | §5 guarantee: nv places NO `data-nv-s-<childhash>` on parent-projected nodes; incidental cascade match is not a defect (real-browser ×3) | Playwright Blink/Gecko/WebKit; inspect projected node attrs | a `data-nv-s-<childhash>` appears on a projected node, OR a test asserts non-match (wrong contract) |
| G7 | No second walk introduced — single rewrite site per path | grep for any new component-descent in a separate walk | a parallel path re-derives rewrite logic |

G6 and the cascade-across-boundary checks are **real-browser required** (jsdom not authoritative).

## 8. Plan-first hard gate (Gate P)

Large enough for Gate P. CC produces `docs/design/plan-style-slots-scope-carry.md`: seams cited
at HEAD, B1-seed proposal (with the G3 equality proof or a halt), per-phase gate tables, the §5
ruling consumed (not re-opened), locked-constraint confirmations (no `src/core/`; injection
through `doc`; nv-does-not-invent-CSS; misclassification falls safe; both back-ends differential).
**HALT for architect approval before any `src/` touch.**

## 9. Status of prior open items

- §5 cross-boundary selector observation — **RULED 2026-06-23: NO, reading (b)** (see §5).
- Mechanism — **RESOLVED 2026-06-23: B3** (scopeHash = `simpleHash(shapeHtml)`, `ir.id`
  untouched). Supersedes B1/B2. G3 trivially satisfied; see §4 + G3'. B2 retained fallback only.
- §5=NO forces no attribute carry → **no Template-IR version bump expected** (confirm at land).
- B1-vs-B2 seed mechanism — in-stream; CC proposes B1 in the plan, proves G3 or halts to B2.
