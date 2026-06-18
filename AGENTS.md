# Working instructions for @neutro/view (nv)

High-performance, framework-portable, fine-grained reactive view engine. This file is
the source of truth for how agents and contributors work in this repo. (`CLAUDE.md`
points here.)

## What this project is

Two documents are authoritative and override any code comment or other doc:

- `docs/reactive-core-contract.md` — source of truth for reactive-core **semantics**.
- `docs/decision-log.md` — source of truth for **what is decided and why**.

If code or discussion conflicts with the contract, flag the conflict explicitly; do
not silently follow either.

## Before doing substantive work

Read the decision log's **Current State** header first (what is locked / open /
superseded right now). Consult the dated Log only for the rationale behind a decision.

## Decision-log workflow

When work reaches a decision (locks something, opens a question, supersedes a prior
call, or resolves a research finding): append a new **dated** entry to the Log **and**
update the Current State header. Append-only — never rewrite history; record reversals
as new entries citing the superseded entry's date. If a decision changes the contract,
note the contract version bump in the entry. When the Log grows unwieldy, move stale
entries to `docs/decision-log-archive.md` with a one-line pointer left behind.

## Locked architectural decisions (do not drift without explicit reversal)

- Fine-grained signals + three-state (Clean/Check/Dirty) graph-coloring push-pull;
  components run once; no VDOM, no re-render.
- Four reactive primitives: `signal`, `derived` (pure, never writes), `effect` (side
  effects; signal-writes only as a capped last resort for non-enumerable dynamic
  targets), `sync` (the single reactive→signal-write construct). Plus `pubsub`
  (non-graph fan-out **event** utility — events not state; no memory, no operators)
  and `errorBoundary`.
- `derived` purity is ironclad. `sync`/`pubsub` stay strict — no coverage-widening
  flags that dissolve their static guarantees.
- The reactive core is DOM-free. The renderer consumes it. Web Components are a
  compile **target**, not the model.
- The compiler may only **skip provable work**; misclassification costs performance,
  never correctness (a soundness fallback always applies).

## Repo shape

Single published package `@neutro/view` with **subpath exports** — not multiple
packages. One version, one build, one release (mirrors `@neutro/form`).

- `src/core/` → published as `@neutro/view/core` (the DOM-free runtime).
- `src/compiler/` → `@neutro/view/compiler` (static analysis; the §10 hooks).
- `src/renderer/` → `@neutro/view/renderer` (Template IR → live DOM).
- `test/` mirrors `src/` (`test/core`, `test/compiler`, `test/renderer`).
- `integration/` holds cross-concern tests (the PoC gate); owns no component.
- `docs/` holds the contract, decision log, template-IR contract, and design notes.

### Import style (decided — apply consistently)

- **Inside `src/` (and tests), use relative imports**, extensionless
  (`moduleResolution: "bundler"`). Cross-concern internal imports are relative too:
  e.g. the renderer imports the runtime as `import { effect } from '../core/core'`,
  **not** via the `@neutro/view/core` alias.
- **The `@neutro/view/*` aliases are the external/published surface only** — for
  consumers, declared in `package.json` `exports` and the `src/*/index.ts` barrels.
  Do not use them for internal source.
- A genuinely orthogonal future concern (e.g. a meta-framework) becomes its **own
  package**, not a subpath.

## Workstreams (keep distinct; note which one a change serves)

1. **Runtime** (`src/core`) — build/tune against an alien-signals-class benchmark.
2. **Compiler** (`src/compiler`) — per-node specialization; targets the contract's
   logical model (§2.1) + hooks (§10), never runtime physical internals.
3. **Renderer** (`src/renderer`) — consumes the core via the §11 surface + §6 owner
   contract; the Template IR (`docs/template-ir.md`) is its contract.
4. **Integration** (`integration/`) — proves the three compose; owns no component;
   routes any bug back to its owning stream rather than fixing in place.
5. **Architecture** — cross-references the contract + log for general/architectural
   questions.

## Escalation calibration

A question is contract-level (escalate; don't decide in-stream) if it touches a locked
§1 invariant, the §6 owner/disposal contract, or determines what a computation
observes mid-propagation — even if it feels like an implementation or scheduler
detail. For the compiler specifically: if a specialization's failure mode is a *wrong
result* rather than slower execution, that's a contract violation — escalate. Pure
layout, helper organization, parser/data-structure tuning, and import organization are
in-stream. When unsure, surface it; under-escalating a semantics question is the
costlier error.

## Two standing gates (separate, both required)

`tsc --strict` (with the DOM lib in scope) and the test suite are **separate gates**.
The test runner strips types, so a green suite does **not** imply a clean compile (a
strict-only defect once hid behind green tests). Both run on `pre-push` (lefthook) and
in CI:

```bash
pnpm typecheck   # tsc --strict, DOM lib in scope
pnpm test        # vitest
pnpm lint        # biome
pnpm build       # emit dist/
```

## Tooling / where work happens

Correctness, logic, and analysis are deterministic and were prototyped in the
claude.ai sandbox. **Performance numbers and real-DOM / Web-Component behavior require
real hardware and a real browser** — that work happens here (Claude Code) and in CI.
Build correct-first, then fast. The trigger to treat something as a real-hardware
question is "the answer depends on a measured number or real-browser behavior," not
"feels hairy." A sandbox perf number is noise; never ship a specialization as "faster"
on the strength of one.

## Working style

Direct and concise. Steelman a proposal, then state where it holds and where it leaks.
Distinguish decided / open-decision / genuine-research. Don't relitigate settled
decisions unless new information changes them. Verify framework/library claims rather
than asserting from memory — the reactive-engine space moves fast.
