# Working instructions for @neutro/view (nv)

High-performance, framework-portable, fine-grained reactive view engine. This file is
the source of truth for how agents and contributors work in this repo. (`CLAUDE.md`
points here.)

## What this project is

Three documents are authoritative and override any code comment or other doc:

- `docs/reactive-core-contract.md` — source of truth for reactive-core **semantics**.
- `docs/decision-log.md` — source of truth for **what is decided and why**.
- `docs/implementation-state.md` — orientation digest of **what exists in the code now**
  (file inventory, real-vs-stub status, the load-bearing seams). It is *not* authoritative
  over the code — **GitHub is authoritative for code** — but it is the first thing to read
  to avoid re-deriving the codebase's current shape from scratch.

If code or discussion conflicts with the contract, flag the conflict explicitly; do
not silently follow either.

## Before doing substantive work

1. Read the decision log's **Current State** header (what is locked / open / superseded).
2. Read `docs/implementation-state.md` (what is real / stub / deferred, and the seams).
3. Consult the dated Log only for the rationale behind a decision.

Do not trust a prior-session summary or hand-off note over these files or over the source
itself; summaries are lossy. Re-establish code facts from `implementation-state.md` + the
actual source, not from recollection.

## Read the seams before you spec

Before writing a spec or design that **composes existing modules** (e.g. "emit code that
calls `mount`", "consume the parser's output"), read the actual source of every seam you
are composing — signatures, return types, what is real vs. stub, what it discards. Do not
spec against inferred internals. A spec built on a guess about a seam is a spec that will be
revised once the guess is checked; reading first collapses the revision loop. This is
distinct from (and in addition to) verifying external library claims.

## Halt at an undecided design gate — do not invent the decision

If executing a task requires a decision that has **not been made** (it is not in the locked
list, not resolved in the log, and is flagged "open" or "not yet specified" anywhere), stop
at that boundary and surface it. Do **not** silently pick a default and build past it. A
task may proceed *up to* the gate — building the parts that don't depend on the undecided
piece — but must structure the work so the missing decision can be filled in later without a
rewrite, and must name the gate it stopped at. Fabricating an unmade decision is the costlier
error; it looks like progress and has to be unwound.

## "Spike" means executed verification, not analysis

A *spike* runs throwaway code and reports what executed. A document that reasons about
options — tiers, tradeoffs, proposed forms — is a *design doc*, not a spike; do not call it
one. Do not mark anything "verified" on the strength of a stub or a structural argument: if
a claim is about real-graph / real-runtime behavior, it must run against the real module
(`core.ts`, not a hand-rolled stand-in) before it is logged as verified. "Structurally
sound" is a hypothesis; only execution closes it. This is the "verify by running, not
reading" rule applied to the word *spike* specifically — a near-miss this rule exists to
prevent was a liveness claim proven against a mock get/set object and nearly logged as
VERIFIED before the real-`core.ts` run was demanded.

## Three artifact kinds, three fates

- **Design doc** (reusable analysis, deferred-work ledger, worked forms) → lives in
  `docs/design/`; referenced by the decision-log entry. Kept because a future session
  re-reads it to make a decision or to pick up deferred work.
- **Decision-log entry** → records the *event/finding* only (what was decided/verified and
  why), not the reusable analysis. Append-only.
- **Session instruction** (a brief handed to another session) → scaffolding. Once its
  output is folded into a design doc or the log, **discard it** — do not file it in
  `docs/design/`. Filing spent instructions clutters the durable-reference directory.

When unsure which an artifact is, ask: *would a future session re-read this to make a
decision?* → design doc. *Is it the record that a decision happened?* → log. *Was it a
one-shot hand-off whose output is now captured elsewhere?* → discard.

## Decision-log workflow

When work reaches a decision (locks something, opens a question, supersedes a prior
call, or resolves a research finding): append a new **dated** entry to the Log **and**
update the Current State header. Append-only — never rewrite history; record reversals
as new entries citing the superseded entry's date. If a decision changes the contract,
note the contract version bump in the entry. When the Log grows unwieldy, move stale
entries to `docs/decision-log-archive.md` with a one-line pointer left behind.

**`docs/decision-log.md` on `main` is the canonical copy.** CC may apply architect paste-ready
log entries directly to the repo (commit + push). PK (`/mnt/project/decision-log.md`) syncs
from `main` rather than being patched by hand; always pull from `main` before applying any
further PK edits to avoid silent drift.

When a change lands code that alters the inventory or a seam, update
`docs/implementation-state.md` in the same pass (it is orientation, not history — edit it in
place; do not append-and-date it like the log).

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

## Authoring surface (`.nv`) vs. runtime core

The authoring surface (`.nv` files: `$component`, `$script`, `$render`, `$style`) gets
bare-read + mutation-write **via compiler erasure**; the runtime core stays explicit
call-to-read / `.set()`-write. The boundary is "is there a compile step over this code." The
`.nv` constructs are compiled away — the compiler emits a factory that produces a Template IR
(IR §2.1). What that factory's **public contract** is (export shape, props, slots, component
identity, how a parent invokes a child) is the **component-API gate — open, not yet
specified** (IR §9.3). Do not bake a public component API while that gate is open.

## Repo shape

Single published package `@neutro/view` with **subpath exports** — not multiple
packages. One version, one build, one release (mirrors `@neutro/form`).

- `src/core/` → published as `@neutro/view/core` (the DOM-free runtime).
- `src/compiler/` → `@neutro/view/compiler` (static analysis; the §10 hooks).
- `src/renderer/` → `@neutro/view/renderer` (Template IR → live DOM).
- `test/` mirrors `src/` (`test/core`, `test/compiler`, `test/renderer`).
- `integration/` holds cross-concern tests (the PoC gate); owns no component.
- `docs/` holds the contract, decision log, implementation-state map, template-IR
  contract, and design notes.

### Import style (decided — apply consistently)

- **Inside `src/` (and tests), use relative imports**, extensionless
  (`moduleResolution: "bundler"`). Cross-concern internal imports are relative too:
  e.g. the renderer imports the runtime as `import { effect } from '../core/core'`,
  **not** via the `@neutro/view/core` alias.
- **The `@neutro/view/*` aliases are the external/published surface only** — for
  consumers, declared in `package.json` `exports` and the `src/*/index.ts` barrels.
  Do not use them for internal source.
- **Generated build output (e.g. `.nv`→`.js`) is a consumer of the published package**, so
  it imports via the `@neutro/view/*` aliases, not relative paths.
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
result* rather than slower execution, that's a contract violation — escalate. A question is
also gate-level (surface it, per "Halt at an undecided design gate") if answering it requires
making a design decision that is flagged open or unspecified. Pure layout, helper
organization, parser/data-structure tuning, and import organization are in-stream. When
unsure, surface it; under-escalating is the costlier error.

## Acceptance gates

Every non-trivial feature landing is verified against a filled-in gate file in
`docs/gates/`, derived from the approved design *before* implementation starts. The
gate is the acceptance contract: it states what evidence proves "done." Completion is
read back against placed files on main's HEAD, not summaries or green counts. Template
and process: `docs/gates/README.md`.

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

## Done means committed and on main

A task is not "done" when files are written — only when its changes are **committed and pushed
to main** (or an explicit PR), verified by `git log` / `git show` on **main's HEAD**, not on a
worktree. An agent that writes files without committing produces zero branch divergence, so a
merge is a silent no-op and main never receives the change. Verify divergence before merging;
treat "Already up to date" as a red flag to investigate, not success. The same distrust applies
to a worktree's copy of `docs/implementation-state.md` — it may have been written against an
earlier state; reconcile it against main, not the worktree.

## Tooling / where work happens

Correctness, logic, and analysis are deterministic and were prototyped in the
claude.ai sandbox. **Performance numbers and real-DOM / Web-Component behavior require
real hardware and a real browser** — that work happens here (Claude Code) and in CI.
Build correct-first, then fast. The trigger to treat something as a real-hardware
question is "the answer depends on a measured number or real-browser behavior," not
"feels hairy." A sandbox perf number is noise; never ship a specialization as "faster"
on the strength of one.

**Measurement-semantics discipline.** A change to *what a measurement isolates* is a
measurement-semantics change — surface it explicitly, even when it improves the
instrument. Examples: redefining "floor" (e.g. switching from "binding-effects no-op'd"
to "effects write to a pre-allocated sink"), changing what is included in the timed
region, or switching the denominator. These changes alter what the number means, not
just its value. An improvement that goes unreported looks like compliance with the
original spec when it isn't — and the architect cannot audit a deviation they don't
know exists. Flag the deviation; let the architect accept it. (Precedent: 2026-06-24
wide-graph harness, where the floor was silently re-defined to the more useful
`sink[i] = finalDerived()` form. Accepted as an improvement; the silence was the miss.)

## Working style

Direct and concise. Steelman a proposal, then state where it holds and where it leaks.
Distinguish decided / open-decision / genuine-research. Don't relitigate settled
decisions unless new information changes them. Verify framework/library claims rather
than asserting from memory — the reactive-engine space moves fast. Own mistakes and fix
them without self-abasement.
