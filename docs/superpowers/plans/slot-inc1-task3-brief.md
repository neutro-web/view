# Slot Increment 1 — Task 3 Brief: On-land Documentation

**Working directory:** `/Users/kofi/_/view`  
**Branch:** main  
**BASE commit:** `e6164de`

---

## What you are doing

Update documentation to reflect the landing of Slot Increment 1. Three surfaces:

### 1. `docs/template-ir.md`

The current header reads **v0.3.2**. Bump to **v0.3.3**.

- Update the title: `# nv Template IR — Design v0.3.3`
- Update the Status line (first bullet block) to `v0.3.3 (2026-06-22). Slot increment 1 landed.`
- Add a changelog entry:
  ```
  - v0.3.3 (2026-06-22): additive `fallback?: TemplateIR` on `SlotOutletBinding`; walk-collapse (GATE-2) — slot content now processed by the same recursive walk as top-level content; component-as-slot-child falls out. reactive-core v0.4.2 unchanged. D-slot-1 retained.
  ```

Also, in §3 (the binding kinds table/list), update the `SlotOutletBinding` description to note the new `fallback?` field.

Also update the inline TypeScript type definition of `SlotOutletBinding` in `docs/template-ir.md` if one exists — add `fallback?: TemplateIR` to match `ir.ts`. Search for `slot-outlet` in the file to find these spots.

### 2. `docs/decision-log.md`

Append a LANDED log entry at the end of the file:

```
### 2026-06-22 — Slot increment 1 LANDED: walk-collapse + component-as-slot-child + fallback

**Gate.** All gates passed: `tsc --noEmit` clean, `vitest run` 3237/3237, `biome check` clean.
Fail-shows-teeth pair confirmed (interpreter fallback-renders test). Anti-vacuous sweep clean.

**What landed:**
- **GATE-2 collapse** — `buildSlotSubIR` and `buildNvSlotSubIR` retired; slot content now
  processed by the same shared `walkNodeList`/`walkNvNodeList` as top-level content. The
  degraded-copy class (B1/B3 root cause) removed at the walk level.
- **Component-as-slot-child** — `ComponentBinding` in slot sub-IRs now falls out of the
  unified walk. The B1/B3 LANDED entry's nested-component deferral is closed.
- **Fallback** — `SlotOutletBinding.fallback?: TemplateIR` (additive). Tagged-template:
  `slots('x', { fallback: html\`...\` })`; `.nv`: `{slots.x ?? html\`...\`}`. Both back-ends
  render fallback when absent; suppress when filled. Both front-ends agree on the IR.
- **Template-IR v0.3.2 → v0.3.3** (additive optional `fallback`).
- **reactive-core v0.4.2 unchanged**. D-slot-1 retained (D-slot-2 is increment 2).

**Corpus delta.** 3223 → 3237 (+14: component-as-slot-child × 9 + fallback × 5).

**Cites.** *Scoped slots design APPROVED [2026-06-22]* (increment 1 commissioned);
*Slot-builder defects B1/B2/B3 LANDED [2026-06-21]* (removed degraded-copy at constructor
level; this collapse removes it at the walk level).
```

Also update the **Current State** header in `docs/decision-log.md`:

- Update the header date line: `_Last updated: 2026-06-22. Contract **v0.4.2** · Template-IR **v0.3.3**._`
- Update the Slot consumption bullet to note increment 1 landed and increment 2 queued.
  Replace the existing Slot consumption bullet entirely with:
  ```
  - **Slot consumption — increment 1 LANDED (2026-06-22):** GATE-2 walk-collapse (retired
    `buildSlotSubIR`/`buildNvSlotSubIR`); component-as-slot-child (nested-component deferral
    closed); fallback (`SlotOutletBinding.fallback?`). Template-IR → v0.3.3. D-slot-1
    retained. Increment 2 (scoped slots + D-slot-2) queued.
  ```
- Update the Forward queue slot line to change "commissioned" → "LANDED":
  Replace `Increment 1 (commissioned)` with `Increment 1 (LANDED 2026-06-22)` in that bullet.

### 3. `docs/implementation-state.md`

Update the "Last verified" line:
```
Last verified against source: **2026-06-22.** Contract **v0.4.2**, Template IR **v0.3.3**.
```

Update the `html-tag.ts` row in the file inventory:
- Note that `buildSlotSubIR` is RETIRED (replaced by `walkNodeList`); slot content goes through the unified walk.
- Note `slots('name', { fallback? })` for the fallback sentinel.

Update the `nv-parser.ts` row:
- Note that `buildNvSlotSubIR` is RETIRED (replaced by `walkNvNodeList`).
- Note `{slots.x ?? html\`...\`}` fallback detection.

Update the `ir.ts` row:
- Note v0.3.3; `SlotOutletBinding` gains `fallback?: TemplateIR`.

Update the "Not built at all" section — remove the "slot consumption (emitted/interpreter factories accept `slots` but do not consume them)" line, since slots are now consumed. Replace with a note that increment 2 (scoped slots, D-slot-2) is still queued.

---

## Gates

- `tsc --noEmit` clean (docs changes only — this should be trivially clean)
- `biome check` clean
- No test changes

---

## Commit

One commit covering all three doc files. `git push` after commit.

---

## Report contract

Write report to: `docs/superpowers/plans/slot-inc1-task3-report.md`

Return only:
- Status: DONE / DONE_WITH_CONCERNS / BLOCKED
- Commit: `<sha7>`
- Concerns (if any)
