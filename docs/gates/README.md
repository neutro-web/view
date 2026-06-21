# CC Acceptance Gates — Template & Process

**What this is.** The standing template for verifying that a Claude Code (CC) feature
landing is actually *done*. Every non-trivial CC implementation gets a filled-in gate
file in this directory **before** CC starts, derived from the approved design. The
architect reads it back against placed files on `main`'s HEAD before calling the gate
passed.

**What this is NOT.** Not a substitute for the design doc (that lives in `docs/design/`)
or the decision log. The gate is the *acceptance contract*: it says what evidence
proves completion. The design says what to build; the gate says how we know it got built.

---

## Governing principle (non-negotiable, every gate)

**Verify by reading placed files on main's HEAD — never by trusting summaries or green
test counts.** Three corollaries, from hard-won failures:

- **Tests green ≠ typechecks ≠ lint-clean ≠ passed gate.** The runner strips types; a
  green suite can hide a strict-compile defect. All four commands are separate gates.
- **Negative / structural / null results are valid findings**, not failures. "This is
  structurally impossible, here's why" is a complete answer. Hiding a null result is the
  failure.
- **Vacuous assertions are rejected.** `expect(true).toBe(true)`, existence-only checks,
  liveness tests missing `flushSync`-and-observe — these are worse than no test because
  they manufacture false confidence. Sweep for them explicitly.

---

## The discipline that makes a gate work (read before filling one in)

A gate is only useful if **every item can fail.** A generic item ("verify the back-end
is correct") cannot fail on inspection — it always reads as "yes." Such items are
bureaucracy: they produce a form to sign, not a check that catches anything.

**When filling in a gate, every item must name (a) the specific artifact or command that
produces the evidence, and (b) the exact condition that would make it fail.** Examples of
the difference:

- ❌ "Confirm props are erased correctly." — cannot fail on inspection.
- ✅ "Show `propSrc` for `<Counter .count="${n}"/>` is `n()` not `n`; assert exact-equals,
  not `.toContain`." — fails loudly if wrong.

- ❌ "Verify no leaks." — vague.
- ✅ "Dispose parent → `__test.observerCount(propSignal) === 0`; show the assertion body."

If you cannot write the failable form of an item, you do not yet understand the design
well enough to gate it — that is itself a signal to surface, not paper over.

---

## Structure (the reusable spine — fill the per-feature slots)

Every gate file follows this skeleton. **G0 and G1 are nearly identical across features;
the rest are filled per feature from the design.**

### GATE 0 — Disqualifiers (check first; if either fails, STOP — not done)
- [ ] **On main's HEAD, not a worktree.** `git status` clean + `git log --oneline -N` shows
  the phase commits on `main`. A worktree with uncommitted files is a silent no-op.
- [ ] **Full gate green on HEAD, all four.** Paste the actual output of
  `pnpm typecheck && pnpm test && pnpm lint && pnpm build`. Not a paraphrase. Green tests
  with a typecheck/lint/build failure is **not** done.

### GATE 1 — Contract & ordering invariants (the things that cost correctness)
*Per-feature: list each invariant this feature must not break, each with the `git diff`
path or command that proves it untouched/honored.*
- [ ] **No unescalated `core.ts` / contract touch.** `git diff <pre>..main -- src/core/`
  is empty (or, if non-empty, was escalated and approved — cite the entry). Standing rule:
  any §1/§6 contract touch is surfaced regardless of correctness.
- [ ] **Contract version unchanged** (or bumped with a cited log entry if the feature
  legitimately changes it).
- [ ] **Ordering gates honored** — if the feature has a prerequisite ordering (e.g. "doc
  revised before the type edit"), show commit order from `git log`.
- [ ] **Hot-struct untouched** unless the feature genuinely needs it (`ReactiveNode` field
  order is cache-load-bearing; flag any disturbance).

### GATE 2..N — Artifacts (placed & read)
*Per-feature: one gate per artifact area (IR / front-end / back-end / emitter / …).
For each, list the file, the exact shape it must have, and "show the region."* The
component-api gate (`component-api.md`) is the worked example of how richly to fill these.

### GATE (tests) — Tests assert the RIGHT things (count is the weakest signal)
*Per-feature: list each test case and the substantive assertion that makes it
non-vacuous.* Always includes these standing sweeps:
- [ ] **Liveness:** write a signal → `flushSync()` → assert the DOM **changed to the new
  value**. A test asserting "binding exists" or omitting `flushSync` proves nothing.
- [ ] **No-leak:** churn/toggle → after dispose, assert `observerCount → 0` and/or
  `childElementCount → 0`. Mount-only is not a leak test.
- [ ] **Differential / shared-oracle (where two back-ends/front-ends exist):** all paths
  asserted against **one shared oracle**, before and after a state change; no path skipped.
  A fixed hardcoded expected value is a valid (and *stricter*) oracle — two paths can be
  mutually equal yet both wrong, but both cannot equal a fixed expected and both be wrong.
  `structurallyEqual` between paths is one way to do this, required only where the output
  is rich/structural (list reorder, keyed reconciliation, multi-root) and a fixed value is
  impractical. Specify *which* form per feature; if using parallel fixed-value tests,
  confirm the paths share the identical fixture and expected values.
- [ ] **Diagnostics:** assert the **specific** message fires, identically across paths —
  not just "threw."
- [ ] **Vacuous-assertion sweep:** grep new test files for `expect(true)`, `toBe(true)`,
  empty bodies, liveness tests missing `flushSync`. Expected: none. Show the grep.
- [ ] **Deferred-not-half-built:** out-of-scope items emit **diagnostics**, not partial
  implementations. A half-built path is worse than none. Confirm the diagnostic fires and
  no partial path exists.
- [ ] **Each new test failed before the fix.** A test that passes against the old code is
  testing the wrong thing — note the red→green.

### GATE (close-out) — Docs & log hygiene
- [ ] Design doc / contract version-consistent after any structural change (consistency pass).
- [ ] `implementation-state.md` updated — real-vs-stub status corrected; closed gaps marked;
  forward-queue items removed.
- [ ] Decision-log entry appended (append-only; cites the approval entry) **and** Current
  State header updated to match.
- [ ] No dead placeholder / stub left behind.

### Evidence bundle (the efficient single ask)
*Request these three; most gates verify from them:*
1. `git log --oneline <pre>..main` + `git status` + full four-command gate output. → G0, G1, close-out.
2. `git diff <pre>..main -- src/ docs/<design>.md` (the whole feature diff). → artifact gates.
3. The TC corpus file(s) in full. → tests gate.

### Pass condition
Passed only when: G0 + G1 clean, every artifact/test/close-out item **evidenced (not
asserted)**, and no vacuous / skipped / half-built / unescalated finding outstanding.
Any unescalated contract touch, any skipped path, any faked integration, or any liveness
test without flush-and-observe → **not passed**, regardless of green count.

---

## Lifecycle

1. **Before CC starts:** architect fills a new `docs/gates/<feature>.md` from the approved
   design — every item in failable form. This *is* the acceptance contract handed to CC.
2. **CC implements**, then pastes the evidence bundle.
3. **Architect reads back** against the filled gate, on `main`'s HEAD. Records pass/fail
   per item with the evidence.
4. **On pass:** the close-out gate's log/state edits land; the gate file stays in
   `docs/gates/` as the evidenced record of that landing.

Worked examples in this directory: `component-api.md` (rich GATE 2–6 fill), and the
current `a2-emitter-factory-shape.md`.
