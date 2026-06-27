# Probe Findings — `.nv` Authoring: Event-Handler → Signal-Write End-to-End

**Probe:** `handoff-nv-author-probe-SONNET.md` (2026-06-25).
**Verified at HEAD:** `007eaa2` (pulled before probe; no src/ changes).
**Probe spec:** `test/browser/nv-author-probe.spec.ts`. Both steps green on chromium + webkit.

---

## Authoring syntax

Event handlers in `.nv` use `@eventName="${...}"` inside the html tagged template. Signal
mutation inside an event handler uses the **assignment form** (`count = count + 1`), which the
parser's `preprocessMutationWrites` step erases to `count.set(count() + 1)` at build time.
Bare reads (`${count}`) are erased to `count()`. Authors never write `.set()` or `()` directly.

**Working `.nv` counter** (`test/browser/fixtures/counter.nv`):

```
const Counter = $component(() => {
  $script(() => {
    const count = signal(0)
  })
  $render(() => html`<span id="count">${count}</span><button id="btn" @click="${() => count = count + 1}">+</button>`)
})
```

No `.nv` file extension is needed for the `$component`/`$script`/`$render` macros — the parser
treats the source as a `.nv` string regardless of filename. The macros are erased; the file has no
standalone syntax, only the macro DSL.

---

## Step 1 — Parse + emit: WORKS

`parseNvFileForEmit` + `emitModule` produce an ES module containing a real `EventBinding` IR
literal wired to the erased handler. Confirmed from the built bundle (line 212099):

```js
{ kind: "event", pathIndex: 1, eventName: "click", handlerKind: "reactive",
  handler: () => (() => count.set(count() + 1)) }
```

The handler thunk is `() => (() => count.set(count() + 1))` — a zero-arg outer thunk (for reactive
tracking) wrapping the actual handler (also zero-arg for the `handlerKind: 'reactive'`
wrapper-effect pattern). The erased read `count()` and write `count.set(...)` are both present.
`handlerKind: 'reactive'` is correct (v0 always emits reactive; `'stable'` skip-the-effect is a
deferred A1 perf item).

---

## Step 2 — jsdom mount + react: PROVEN (not re-run)

EX-01 in `test/renderer/nv-emitter-exec.test.ts` runs this exact counter string (same macros,
same `@click`, same mutation-write erasure) through `parseNvFileForEmit` → `emitModule` →
esbuild node-bundle → dynamic import → jsdom mount → click → assert. It passes as part of the
659/0 green suite. Not duplicated in the probe — EX-01 is the authoritative jsdom proof.

---

## Step 3 — Real browser via esbuild + nvPlugin: WORKS (chromium + webkit)

**Build path used:**

```
counter-entry.ts
  └── export { Counter } from './counter.nv'   ← nvPlugin() handles .nv
  └── export { flushSync } from '@neutro/view/core'
```

esbuild config: `nvPlugin()` + `ts-resolve` + `neutro-alias` (@neutro/view/* → src/), format
`iife`, globalName `__nvCounter`, platform `browser`. Bundle written to
`test/browser/dist/nv-counter-bundle.js`.

In-browser call sequence:
```js
window.__nvCounter.Counter.mount(document.body, document)
window.__nvCounter.flushSync()
// click #btn
window.__nvCounter.flushSync()
```

**Result:** initial text `"0"`, after click 1 `"1"`, after click 2 `"2"` — both chromium and
webkit, clean, no retry.

---

## Finding: bundle includes TypeScript compiler at runtime

**The bundle is large** (~4MB unminified) because `@neutro/view/renderer` (`src/renderer/index.ts`)
co-exports `parseNvFile` / `parseNvFileForEmit` from `nv-parser.ts`, which imports the TypeScript
compiler. The emitted counter module imports `@neutro/view/renderer` for `mount`, pulling in the
entire parser + TypeScript compiler into the browser bundle.

The bundle **runs correctly** — the parser is never called at runtime (it was called at build time
by `nvPlugin`), so the bundled TypeScript code is dead weight (Node.js builtins are shimmed as
`(disabled)` stubs by esbuild). But ~4MB for a hello-world counter is not a production build path.

**Root cause:** `src/renderer/index.ts` has no split between:
- **Runtime exports** (`mount`, html-tag helpers, IR types) — needed in the browser bundle
- **Build-time exports** (`parseNvFile`, `parseNvFileForEmit`, `preprocessMutationWrites`) —
  needed only at build time (in `nvPlugin` / Node tooling), never at runtime in the browser

**Fix shape (for architect ruling):** a separate `@neutro/view/renderer/runtime` entry (or a
`src/renderer/runtime.ts` that exports only `mount` + html-tag) that the emitted module imports
instead of the full `@neutro/view/renderer`. The emitter (`nv-emitter.ts`) controls the import
statement; changing it to `from '@neutro/view/renderer/runtime'` is a one-line change, but requires
an architect decision on the package entry structure.

---

## Verdicts for the roadmap

**CP-1b — "documented pattern exists, just needs an example"**: YES. Event-handler authoring
works end-to-end. The `@click="${() => count = count + 1}"` pattern (assignment form, not `.set()`)
is the correct authoring syntax. The parse → emit → bundle → browser path is proven. No missing
wiring in the handler path.

**CP-3 — does `mount(Component)` need a thin wrapper?**: The emitted module already has a
`Counter.mount(parent, doc, props, slots)` static method that a browser app calls directly.
For a real app entry point, the author writes:
```js
import { Counter } from './app.nv'
Counter.mount(document.body, document)
```
No additional thin wrapper is needed — the static `.mount` on the emitted component is the
author-facing app entry. CP-3 is **documentation only**: write down `Counter.mount(parent, doc)`
as the documented convention. No new API needed.

**New finding (not in original CP scope) — bundle split needed for production:**
The emitted module's `import { mount } from '@neutro/view/renderer'` pulls in the entire parser
+ TypeScript compiler at runtime. This is a CP-1a blocker for a production-viable bundle, not just
a cosmetic issue. Needs an architect ruling on the `@neutro/view/renderer/runtime` split before
the v0.1.0 build path can be called production-ready.

---

## Summary table

| Probe step | Result | Notes |
|---|---|---|
| Authoring syntax | **Documented** | `@click="${() => count = count + 1}"` — assignment form |
| Parse + emit (Step 1) | **WORKS** | EventBinding IR + erased handler present in bundle |
| jsdom mount + react (Step 2) | **PROVEN** | EX-01 in nv-emitter-exec.test.ts (659/0) |
| Real browser (Step 3) | **WORKS** | Chromium + WebKit clean, click → DOM update |
| Bundle size / split | **GAP** | TypeScript in browser bundle; needs renderer/runtime split |
| CP-1b verdict | **Documented pattern** | No missing wiring |
| CP-3 verdict | **No new API** | `Counter.mount(parent, doc)` is the convention |
| New blocker | **Bundle split** | `@neutro/view/renderer/runtime` needed for production |
