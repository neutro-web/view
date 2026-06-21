# Props Destructuring — Design & Decisions (+ verification-spike brief)

**What this is.** The *design analysis and decisions* for reactive props destructuring. It is **not** a verification spike — it asserts erasure forms from reasoning, not from running code. The actual verification spike (run TS, confirm the forms parse / read live / compose with shadowing) is a **separate compiler+renderer sandbox session**, briefed in §7.

**Status:** Design CLOSED (decisions locked, §4). Erasure forms **ASSERTED, pending verification** (§6). Feeds component-API spec §3 once verified.
**Workstream:** (2) Compiler erasure × (3) Renderer.
**Decided context (do not relitigate):** props are reactive accessors (forced by run-once); element syntax `<Counter/>`; both front-ends + both back-ends lockstep; object-of-accessor-thunks factory (D4).

---

## 1. The hazard

Components run once. A prop the child reads must be a **live accessor**, not a snapshot — otherwise the child never observes a parent update (it never re-runs). JS destructuring **evaluates** the source's getters at destructure-time and binds the *results*, so `const { count } = props` reads `props.count` once and binds a dead value. The fix: compile-time rewrite of destructured read-sites into accessor calls, exactly as nv already erases bare signal reads.

---

## 2. Key asset: `collectBindingNames` already does the traversal

`nv-parser.ts`'s `collectBindingNames` already recurses object/array/nested binding patterns (used today for shadow detection). The props rewrite repoints the *same traversal* to emit a `local → accessor` map instead of a shadow set. Aliasing is free — `BindingElement.propertyName` is on the AST, unread today. The **only** branch it lacks is the rest element (`dotDotDotToken`) — exactly where the easy problem ends. The tiers are defined by where this traversal reaches.

---

## 3. The hinge: static enumerability of the prop set

Forks on one compile-time question: **is the complete set of prop names statically known?**

- **Element syntax → enumerable by construction.** `<Counter count={n} label="x"/>` — the parent listed the props; the DFS walk sees every name.
- **Spread/dynamic → not enumerable.** `<Counter {...obj}/>` — runtime-only.

Same enumerable/non-enumerable line nv draws for `sync` targets and the effect-write cap. Element syntax puts the common case on the enumerable side → reactive `...rest` (Tier 2) is tractable without a proxy.

---

## 4. Locked decisions

| # | Decision |
|---|----------|
| **D-surface** | Author destructures (S2 ergonomic); compiler rewrites read-sites → `props.key()` (S1 mechanics). `props.x` direct access also valid (→ `props.x()`). |
| **D-write** | Write to a prop name → **diagnostic**, reusing the `readonly`/derived write-path. Props are a third readonly reactive source. |
| **D-IR** | `ComponentBinding` **carries the static prop-name set** (`propNames`). Required for Tier-2 rest set-difference + diagnostics. Feeds component-API spec §4.3. |
| **D1 (nested)** | Nested destructure (`{ user: { name } }`) → **deferred, folded with Tier-3** (§5). Diagnosed in v0.0.1. *(Revised from earlier "flat-only"; nested now travels with rest-Tier-3 per your call.)* |
| **D2 (rest)** | **Reactive** read-`...rest` over the enumerable set → **Tier 2, v0.0.1**. `rest.foo` is live (`props.foo()`), never a snapshot. Forwarding / spread invocation → Tier 3. |
| **D3 (shared analyzer)** | One shared destructuring analyzer across `$script` erasure, handler erasure, props erasure. Closing props-destructure **also closes the logged handler destructuring-write gap**. Build once. |
| **D4 (factory sig)** | Parent→child: object of accessor thunks — `Counter({ count: () => count() })`. **Working assumption the spec is built around; not a committed Component API decision.** Resolves when the component-api-spec gate closes (IR §9.3). A passing spike does not ratify this as the invocation contract. |

---

## 5. The tiers (final)

**Tier 1 — named + aliased — v0.0.1 must-have.**
`const { count, label: l } = props` → declaration erased; `count` reads → `props.count()`; `l` reads → `props.label()`. Reuses the traversal (+ alias-key extraction) + existing read-site rewrite + shadowing helpers.

**Tier 2 — reactive `...rest` over enumerable set — v0.0.1, reactive.**
`const { count, ...rest } = props`, prop set statically known. `rest.foo` → `props.foo()`; whole `rest` → generated accessor literal over remaining keys (full − destructured). No proxy, no Map on hot path — set difference at compile time. **Hard dep: D-IR (`propNames`).** Reading rest = Tier 2; *forwarding* rest = Tier 3.

> **Hot-path note (verified 2026-06-20).** Rest-*as-value* in a reactive hole allocates a fresh accessor literal **per effect re-run** — observed in the liveness spike (two distinct objects across two runs). Under nv's allocation-visible cost profile (the same construction-cost surface the `createSignals` tripwire tracks), this is a real cost at scale. Mitigation: `rest.foo` *member access* rewrites directly to `props.foo()` with no allocation path; the literal form is only for body-level whole-`rest` uses, which are not typically inside frequently-firing effects. Spec/authoring guidance: prefer `rest.foo` member access in hot render holes; keep whole-`rest`-as-value out of frequently-firing effects. Liveness of both forms confirmed against the real graph; this is a cost note, not a correctness one.

**Tier 3 — non-enumerable / forwarding + nested — deferred, diagnosed.**
Triggers: spread invocation `<Counter {...obj}/>`, rest-forwarding, **nested destructure (D1)**. Non-enumerable rest needs a proxy (per-access indirection + runtime structure — off-discipline). Nested needs `props.user().name` intermediate-accessor semantics (unproven). Deferred together; v0.0.1 diagnoses each trigger. **Reopen:** real-app evidence + perf harness vs the enumerable path.

---

## 6. Erasure forms — ASSERTED, pending verification spike

> ✓ **VERIFIED against real `core.ts` (2026-06-20).** Erasure mechanics: 39/39 (AST harness). Liveness against the real reactive graph: 35/35. Each form backed by execution, not reasoning. `observerCount === 1` confirmed the accessor thunk is transparent to `trackRead` — the child effect is a *direct* observer of the parent signal, no intermediate node. Same-value write no-op confirmed intact through the thunk. See dated log entry. Safe to feed into component-api-spec §3.

**A. Plain + alias (Tier 1) — ASSERTED**
```
source:  const { count, label: l } = props
         html`<span>${l}: ${count}</span>`
erased:  declaration removed
         hole l     → props.label()
         hole count → props.count()
```

**B. Reactive rest (Tier 2) — ASSERTED**  (propNames = ['count','label','title'])
```
source:  const { count, ...rest } = props
         html`<span>${count} ${rest.label} ${rest.title}</span>`
erased:  hole count      → props.count()
         hole rest.label → props.label()
         hole rest.title → props.title()
         rest-as-value   → { label: () => props.label(), title: () => props.title() }
```

**C. Write to prop — ASSERTED (diagnostic)**
```
source:  const { count } = props; count = 5
erased:  count reads → props.count(); assignment `count = 5` → ERROR (not .set())
msg:     "Assignment to prop 'count': props are read-only inputs from the parent.
          To hold local state, use signal()."
```

**D. Nested (D1) — ASSERTED (diagnostic)**
```
source:  const { user: { name } } = props
erased:  ERROR at the nested pattern
msg:     "Nested prop destructuring is not supported in v1; destructure one
          level (const { user } = props; user().name)."
```

**E. Spread invocation / forwarding (Tier 3) — ASSERTED (diagnostic)**
```
msg:     "Spread props ({...x}) are not supported in v1."
```

---

## 7. Verification spike — brief for the separate session

**Goal:** convert §6 ASSERTED → VERIFIED (or correct). Throwaway prototype; nothing lands in the repo. Output: §6 confirmed/corrected + surprises, folded back here, then into component-api-spec §3.

**The three highest-risk assertions to verify with running code:**

1. **Nested-erase target shape.** Is `props.user().name` correct/coherent, or does nested need something else? Drives whether D1's diagnostic is right — or whether nested is *easier* than assumed and could move into v0.0.1. Construct, confirm liveness, confirm the deferral call.
2. **Generated rest-literal liveness.** Does `{ label: () => props.label() }` read live when enumerated/spread? Confirm `rest.foo` and whole-`rest` both stay reactive; confirm the set-difference (full − destructured) feeds it.
3. **Rewrite × shadowing composition.** When a destructured prop name is later shadowed (`const { count } = props; … { const count = 5; count }`), does the rewrite *stop* at the shadow (reusing `gatherFunctionShadows`/`gatherBlockShadows`)? Assert: no false rewrite of the shadowed local, no missed rewrite of the prop outside the shadow.

**Method (sandbox — deterministic correctness, no CC/browser, no perf numbers):**
- Minimal TS-AST harness: parse each §6 source; run the proposed rewrite (extend `collectBindingNames` for alias + rest; build `local→accessor` map; apply read-site substitution reusing the existing shadow walk); emit erased text.
- Assert: (a) erased text **parses** (`ts.createSourceFile` clean); (b) **reads live** — wire `props` as real accessors over signals, run erased reads, write the signal, confirm the read reflects it; (c) **shadowing composes** (case 3).

**Required files from GitHub for the spike session:**

*Source (the machinery being prototyped against):*
- `src/renderer/nv-parser.ts` — **primary.** `collectBindingNames`, `gatherFunctionShadows`, `gatherBlockShadows`, `eraseSignalReadsInNode`, `eraseScriptBlock`, `eraseHandlerExpr` (shared-analyzer call sites + the handler-write gap being closed).
- `src/renderer/ir.ts` — match real `PropEntry`/`propNames` field names the rest set-difference consumes (prototype may stub a minimal `ComponentBinding`).
- `src/core/core.ts` — to wire real `signal`/accessor liveness in assertion (b).

*Docs (standing context):*
- **This doc** — the brief; §6 is the checklist, §7 the method.
- `docs/decision-log.md` (Current State) + `AGENTS.md` — locked rules.
- `docs/template-ir.md` — `ComponentBinding` arrives at v0.3; stub it to match.

*Not needed* (mount/emit/back-ends aren't exercised by erasure verification): `interpreter.ts`, `emitted-mount.ts`, `nv-emitter.ts`, `html-tag.ts`, `comparator.ts`. They re-enter for the implementation session.

**Done = §6 VERIFIED or CORRECTED**, returned as fact with any nested/rest surprises noted. Then this doc closes fully and folds into component-api-spec §3.

**Logging scope for this session.** The spike produces a *verification finding* entry in the decision log — "§6 erasure mechanics verified/corrected; nested/rest behaved as X." The full D1–D4 decision set logs when the component-api-spec is reviewed and approved, not from this session. If the spike *changes* a decision (e.g., nested turns out trivial and moves to v0.0.1, superseding D1's deferral), log that change with the spike's date. If the asserted forms are confirmed unchanged, log the finding only; do not bulk-log D1–D4 as locked.

**D4 is not this session's to consume beyond "props is an object of accessors."** The erasure mechanics (§6 A–E) concern how a child *reads* props; they are independent of how the parent *passes* them (D4). Wire `props` as a plain object of accessor thunks in the harness — true under any parent-passing mechanism — and do not treat spike success as ratifying D4.

---

## 8. What this resolves for the component-API spec (once verified)

1. **`props` surface:** destructure stays live via read-site → `props.key()`; `props.x` direct valid.
2. **Writes:** diagnostic via readonly path. Props = third readonly reactive source.
3. **IR (hard):** `ComponentBinding.propNames` required.
4. **v0.0.1 line:** Tier 1 must-have; Tier 2 reactive rest in (contingent on `propNames`); Tier 3 (spread/forward/nested) diagnosed-deferred.
5. **Shared analyzer:** one pattern walker, closes the handler destructuring-write gap in the same work.
