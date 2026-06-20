# nv Build Pipeline `.nv → .js` (Mode A) — Spec (final)

**Stream:** renderer + compiler seam. **Status:** architect design, ready for CC.
**Contract:** reactive-core v0.4.2 (unchanged), Template IR v0.2 (unchanged).
**Supersedes** all prior build-pipeline drafts. Verified against `nv-parser.ts`,
`html-tag.ts`, `interpreter.ts`, `ir.ts`, `emitted-mount.ts`, `package.json`.

This document specs the **transform layer** only — turning `.nv` source into a runnable
`.js` module. It deliberately does **not** decide the **component-API gate** (export shape,
props, slots, component identity, parent-invokes-child); that gate is open (IR §9.3) and the
v1 module shape below is an explicitly provisional test scaffold, not a public contract.

---

## 1. Why Mode A, and what "Mode A" means here

IR §2.1 defines the `.nv`/compiler path as: *"the compiler emits a factory function that,
when called, produces a `TemplateIR`."* Mode A is exactly that — emit a factory; build a
**real-thunk** `TemplateIR`; hand it to the shipped interpreter `mount`. No per-binding source
codegen (that is the deferred compiler back-end, `emitted-mount.ts`, whose specializations
currently measure net-neutral/negative — not worth shipping into the build path now).

**Emit mechanism is forced, not chosen.** Two ways existed to build the IR inside the factory;
both alternatives are eliminated by the source:
- *Emit a runtime `html\`\`` call* — **dead.** `html-tag.ts` handles `text` + `attr` only; it
  cannot express prop/event/conditional.
- *Lift the parser's IR literal* — **dead.** `nv-parser.ts` binding thunks are stubs
  (`(() => undefined)`); shipping them renders nothing.

→ **The emit builds an IR object literal: real `shape`/`bindingPaths`/kinds/names taken from
the parser, real thunks generated from erased hole source.**

---

## 2. Scope

**v1 coverage = the kinds the `.nv` parser produces: `text, attr, prop, event, conditional`.**
Child and List are **out** — not parser-reachable (no `.nv` syntax; interpreter-only via
manual IR). SyncBinding out (throws everywhere).

**In:** single- or multi-component `.nv` files; multiple `$script` blocks per component;
mutation-write + bare-read erasure extended to render holes (§4); diagnostics → build errors
(§7); an esbuild plugin (§8); the round-trip differential gate (§9).

**Deferred (named, not dropped):**
- **Component API / public module shape** — the open gate. v1 ships a provisional scaffold (§5).
- **Render-hole *mutation-write* erasure** — recommended for v1 (§4); if descoped, becomes a
  documented "use explicit `.set()` in handlers" limitation.
- `$style` scoping/injection — parser extracts `{form, keys, source}`; v1 emits no CSS.
- ComponentBinding, Mode B source codegen, `shape` hoisting, setup-without-root primitive,
  source maps — all tripwire/gate-deferred.

---

## 3. Pipeline sequence

```
read .nv source
  → parseNvFileForEmit(src, fileName, doc)   # §6 — preprocesses + parses internally (call once);
                                              # returns real shape/paths/kinds + erased thunk
                                              # source + erased $script body + module scope + diagnostics
  → emitModule(result[])                      # §5 — the factory emit
  → .js text
```
`doc` is a build-time jsdom `Document` (jsdom is already a devDep). Path computation therefore
happens at build time — the parse-once benefit the `.nv` path is designed for. Never call
`preprocessMutationWrites` separately; `parseNvFile` already does.

---

## 4. Erasure — the gap the source exposed (first-class)

`preprocessMutationWrites` erases **`$script` blocks only**. Render-template holes — including
event handlers like `@click="${() => count = count + 1}"` — are **never erased today**. No
real render thunk has ever run, so this stayed invisible; the build pipeline is the first
consumer to need it.

For an emitted handler to match the locked authoring model (mutation-write via erasure), the
addition must erase render-hole expressions:
- **Bare-read erasure** (`count` → `count()`) — `eraseSignalReadsInNode` already does this; run
  it on every render hole. Cheap, unambiguous. **Required.**
- **Mutation-write erasure inside handlers** (`count = x` → `count.set(x)`) — the assignment
  logic lives inside `eraseScriptBlock` (currently `$script`-shaped). Generalize it to run on a
  handler arrow body. **Recommended for v1**; the authoring-surface direction is locked, so
  shipping handlers that still require explicit `.set()` is a DX regression against the thesis.

**Decision: include handler mutation-write erasure in v1.** Bare-read everywhere plus
`count = x` → `count.set(x)` inside event handlers, reusing the generalized `$script`
assignment logic. Approved 2026-06-20. Avoids a DX hole on the first runnable surface and
is consistent with the locked authoring model.

---

## 5. Emit target (provisional v1 scaffold — NOT a public API)

```js
import { signal, derived, effect, sync, createRoot, onCleanup } from '@neutro/view/core'
import { mount } from '@neutro/view/renderer'
// + module-level imports preserved verbatim from the .nv source

export function Counter() {                       // name = parser `name`. Shape is PROVISIONAL.
  return {
    mount(parent, doc) {
      return createRoot((dispose) => {
        // (1) erased $script body(s), inlined in order — runs ONCE, owned by THIS root
        const count = signal(0)

        // (2) real-thunk IR: shape/paths/kinds/names from parser; thunks from erased hole source
        const __ir = {
          id: 'nv:abc12345',
          shape: { html: '<span><!--nv-0--></span><button>+</button>', bindingPaths: [[0, 0], [1]] },
          bindings: [
            { kind: 'text',  pathIndex: 0, expr: () => (count()) },
            { kind: 'event', pathIndex: 1, eventName: 'click', handlerKind: 'reactive',
              handler: () => (() => count.set(count() + 1)) },
          ],
        }

        // (3) interpreter mount makes its OWN inner root; bridge it (createRoot does not auto-attach)
        const disposeMount = mount(__ir, parent, doc)
        onCleanup(disposeMount)
        return dispose
      })
    },
  }
}
```

**Why this exact structure (all verified against `interpreter.ts`):**
- `mount(ir, parent, doc)` returns a disposer and **creates its own root**; there is no
  exported setup-without-root. So `$script` cannot run in the bare factory body (its
  `effect`/`derived`/`sync` would be unowned and leak). It runs **inside an outer
  `createRoot`**, and the inner mount root is bridged via `onCleanup(disposeMount)` — the same
  manual-bridge pattern the interpreter uses for conditional/list nested roots.
- Event sentinel: none in `shape.html` (`data-nv-*` stripped); path targets the element.
- Conditional binding emits `condition: () => (cond())` plus nested real-thunk IR literals for
  `consequent`/`alternate` (recursively), shape/paths from the parser's nested IRs.
- Import set: include only primitives referenced by the `$script` body, plus
  `createRoot`/`onCleanup`/`mount` always. (Avoids biome unused-import failures.)

**Provisional-shape flag:** `export function Name()` returning `{ mount }` is chosen to
exercise the transform and mount a root, nothing more. It will change when the component-API
gate lands. v1 fixtures/tests use it internally; it is not published, and the emitter is
structured so the outer signature can change without touching (1)/(2)/(3).

---

## 6. Required parser addition (`parseNvFileForEmit`, renderer-stream, in-stream)

Add an emit-oriented surface (extend `NvComponentResult` with an optional `emit` field, or a
sibling entry). Existing structural consumers (FE-equivalence tests) must be unaffected.

Per component, expose:
1. **Erased `$script` body source** — the `$script` arrow body statements from the
   **processed** source (already erased by `preprocessMutationWrites`), all blocks in order.
2. **Per-binding erased thunk source**, index-aligned with `ir.bindings`:
   - `text`/`attr`/`prop` → `exprSrc` (erased hole expr, e.g. `"count()"`).
   - `event` → `handlerSrc` (erased handler, e.g. `"() => count.set(count() + 1)"` — requires §4).
   - `conditional` → `{ conditionSrc, consequent: ThunkSource[], alternate: ThunkSource[] | null }`
     (recursive; branch shape/paths come from the parser's existing nested IRs).
3. **Preserved module scope** — top-level `import`s and non-`$component` statements, verbatim.

`shape.html`, `bindingPaths`, kinds, and names are **already real** in `ir` — do not re-expose
them; the emitter reads them from `result.ir`. The only new data is the erased sources above.
Erasure must reuse the existing functions (do **not** duplicate erasure logic in the emitter;
`eraseSignalReadsInNode` is internal — the addition is the single seam that surfaces its output).

---

## 7. Diagnostics → build

The v1 path is parser → interpreter `mount`; it carries **no `BindingErasureVerdict`** (that
is the `emitted-mount` compiler path). So sync-target DECLINE does not arise — there is no
warning-vs-error sub-decision in v1.

Policy: `NvDiagnostic { kind: 'error' }` (e.g. assignment-to-`derived`, already emitted by the
parser; plus any new error from §4 handler erasure) → **fail the build** with file:line +
message. That is the whole policy.

---

## 8. Build tool

esbuild plugin (esbuild is a devDep). `onLoad({ filter: /\.nv$/ })` → run §3 with a module-level
jsdom `Document` → `emitModule` → return `{ contents, loader: 'js' }`. All logic lives in
`emitModule` (unit-testable without a bundler); the plugin is a thin wrapper. A Vite plugin can
wrap the same `emitModule` later.

---

## 9. Acceptance gate (soundness anchor)

Per fixture: the emitted module — written to a temp `.js`, dynamically `import()`ed, and run
(`Name().mount(parent, doc)` + `flushSync()`) — produces DOM `structurallyEqual`
(`comparator.ts`) to interpreter `mount` of a **hand-authored real-thunk IR** for the same
template. Assert at: initial, after a signal write, after an event dispatch. Plus a
dispose-no-leak assertion (disposer → re-apply writes → DOM unchanged), mirroring the IR §8.3
differential protocol.

Corpus: each of text/attr/prop/event/conditional; a multi-component file; a multiple-`$script`
component; a handler with mutation-write (exercises §4); a diagnostics-fail case
(assignment-to-`derived` → build throws). No child/list (out of parser reach).

The emitted module is now a **third comparand** alongside interpreter and `emitted-mount` — any
divergence is caught here.

---

## 10. Ownership & sequencing

CC builds, in order:
1. **§6 parser addition incl. §4 render-hole erasure** (gating dependency; lands first).
2. **`emitModule`** (§5).
3. **esbuild plugin** (§8).
4. **Fixtures + round-trip differential gate** (§9).

CC reports back, for architect read-verification (not summary-trust): a **sample emitted
`.js`** (pasted), the **gate output**, and confirmation that the **barrels**
(`src/core/index.ts`, `src/renderer/index.ts`) export everything the emit imports
(`signal/derived/effect/sync/createRoot/onCleanup` from core; `mount` from renderer) — if a
barrel is missing an export, that is the one packaging fix to make.

Both standing gates apply (`pnpm typecheck` and `pnpm test`, separately).

CC **halts and surfaces** if it hits: anything requiring the component-API decision; a need to
modify `core.ts`; or a §4 erasure ambiguity (e.g. handler bodies that aren't simple arrows).

---

## 11. Decision-log staging (staged/approved 2026-06-20)

Decision-log entry staged and approved 2026-06-20. Records: Mode A locked with the emit
mechanism = **IR object literal** (runtime-`html\`\`` and lift-parser-IR both eliminated by
source — record so neither is re-attempted); v1 coverage = 5 parser-reachable kinds (child/list
out, blocked on `.nv` syntax); `$script` ownership = nested roots bridged by `onCleanup`; the
**render-hole erasure gap** discovered and its v1 resolution (handler mutation-write erasure
approved, §4); component-API explicitly **not** decided (provisional scaffold shape, gate remains
open); equality/step-4 specialization off the v1 path. Current State: resolves the `.nv→.js`
half of the compile-time/runtime split. No contract change. `implementation-state.md` updated
when the code lands.
