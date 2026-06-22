# Slot Increment 1 — Task 2 Brief: Fallback + Corpus Extension

**Working directory:** `/Users/kofi/_/view`  
**Branch:** main  
**BASE commit:** `204da1b`  
**Current suite:** 3232 tests, all green. tsc + biome clean.

---

## Context

This is a continuation of Slot Increment 1. Task 1 (GATE-2 collapse + component-as-slot-child)
has landed. You are implementing Step C only: the `fallback` field on `SlotOutletBinding`.

The collapse is done — slot content walks through the same logic as top-level content. Do NOT
re-implement the collapse or touch the new `walkNodeList`/`walkNvNodeList` functions beyond
what fallback detection requires.

**Out of scope (DO NOT implement):** `SlotEntry.content` factory, `SlotOutletBinding.props`,
`let={...}` authoring, D-slot-2 invocation-scoped ownership. Those are increment 2.

---

## Step C — Fallback (additive IR field + front-end detection + back-end rendering)

### C.1 — IR change (`src/renderer/ir.ts`)

Add an optional `fallback` field to `SlotOutletBinding`:

```ts
export type SlotOutletBinding = BaseBinding & {
  kind: 'slot-outlet'
  name: string
  fallback?: TemplateIR   // child-authored default when the slot is absent
}
```

This is the ONLY IR shape change. `SlotEntry` is unchanged. `SlotOutletBinding.props` is NOT
added (that is increment 2).

### C.2 — Tagged-template front-end (`src/renderer/html-tag.ts`)

`slots('name')` sentinel gains an optional second argument carrying options:

```ts
export interface SlotSentinel {
  readonly __nvSlotOutlet: string
  readonly __nvFallback?: TemplateIR
}

export function slots(name: string, opts?: { fallback?: TemplateIR }): SlotSentinel {
  return { __nvSlotOutlet: name, __nvFallback: opts?.fallback }
}
```

`buildHtmlHoleBinding` reads `__nvFallback` and sets `fallback` on the produced `SlotOutletBinding`:

```ts
if (isSlotSentinel(origExpr)) {
  const b: SlotOutletBinding = {
    kind: 'slot-outlet',
    pathIndex,
    name: origExpr.__nvSlotOutlet,
    ...(origExpr.__nvFallback !== undefined && { fallback: origExpr.__nvFallback }),
  }
  return b
}
```

`isSlotSentinel` check: `__nvFallback` is optional, so the existing structural check on
`__nvSlotOutlet` is sufficient — no change needed to `isSlotSentinel`.

The hole validation guard (`typeof expr !== 'function' && !isSlotSentinel(expr)`) continues
unchanged.

### C.3 — `.nv` front-end (`src/renderer/nv-parser.ts`)

In `buildNvHoleBinding` (the shared per-hole constructor), the slot-outlet branch already
detects `slots.name` PropertyAccessExpression. Extend it to detect the `??` pattern:

```
{slots.header ?? html`<h1>Untitled</h1>`}
```

This is a `BinaryExpression` with `operator === SyntaxKind.QuestionQuestionToken`, where:
- `left` is the `slots.name` PropertyAccessExpression (the outlet)
- `right` is a tagged template expression with tag `html` (the fallback template)

When detected, call `processHtmlTemplate(right, doc, signals)` recursively to produce the
fallback `TemplateIR`, then set it on the `SlotOutletBinding`.

```ts
// In buildNvHoleBinding, text-hole branch:
if (ts.isBinaryExpression(holeExpr) &&
    holeExpr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
  const left = holeExpr.left
  const right = holeExpr.right
  if (ts.isPropertyAccessExpression(left) &&
      ts.isIdentifier(left.expression) && left.expression.text === 'slots' &&
      ts.isIdentifier(left.name) &&
      isHtmlTTE(right)) {
    const fallbackIR = processHtmlTemplate(right, doc, signals)
    return {
      kind: 'slot-outlet',
      pathIndex,
      name: (left.name as ts.Identifier).text,
      fallback: fallbackIR.ir,
    }
  }
}
```

Note: `processHtmlTemplate` currently returns `{ ir: TemplateIR; holeIndices: number[] }` —
use `.ir`. The fallback template is processed with the same `doc` and `signals`.

Also handle this pattern in `computeThunkSource` for the `parseNvFileForEmit` path: a `??`
outlet with fallback should produce a `{ kind: 'slot-outlet'; name }` ThunkSource for the
outlet hole (the fallback is a sub-IR literal in the emitted code, not a thunk).

### C.4 — Interpreter back-end (`src/renderer/interpreter.ts`)

In `wireSlotOutlet`, when `slotsObj[binding.name]` is `undefined` (slot absent):

```ts
const slotIR = slotsObj[binding.name]
if (slotIR === undefined) {
  if (binding.fallback !== undefined) {
    // Render fallback at outlet scope (child-authored, no parent capture).
    // D-slot-1 retained for the filled case; fallback is child-authored, outlet scope.
    runWithOwner(capturedParentOwner, () => {
      createRoot((d) => {
        mountFragment(binding.fallback!, parent, doc, anchorNode)
        return d
      })
    })
  }
  return
}
// ... existing filled-slot logic unchanged ...
```

Actually, look at how the existing `wireSlotOutlet` handles the absent case — it currently
just returns. Add the fallback rendering before that return. Use the same ownership pattern
(D-slot-1: `runWithOwner(capturedParentOwner, ...)`) — the fallback is child-authored,
rendered at the outlet site; D-slot-1 is retained for increment 1.

Read `src/renderer/interpreter.ts` `wireSlotOutlet` carefully before coding this — match the
existing ownership/mounting pattern.

### C.5 — Compiler back-end (`src/compiler/emitted-mount.ts`)

In the `slot-outlet` case, add fallback rendering when the slot is absent:

```ts
case 'slot-outlet': {
  const slotContent = childSlotContext?.slotsObj[binding.name]
  if (slotContent === undefined) {
    if (binding.fallback !== undefined) {
      // Render fallback — same ownership pattern as filled case
      const fallbackSetup = emitSetup(binding.fallback, doc, childSlotContext)
      runWithOwner(capturedParentOwner, () => {
        createRoot((d) => {
          fallbackSetup(parent, doc)
          return d
        })
      })
    }
    break
  }
  // ... existing filled logic unchanged ...
}
```

Read `src/compiler/emitted-mount.ts` carefully for the exact ownership pattern used — match it.

### C.6 — Emitter (`src/renderer/nv-emitter.ts`)

In `emitBindingLiteral`, the `slot-outlet` case emits an object literal. When `fallback` is
present, emit the fallback IR as a nested literal:

```ts
case 'slot-outlet': {
  const parts = [
    `kind: 'slot-outlet'`,
    `pathIndex: ${b.pathIndex}`,
    `name: ${JSON.stringify(b.name)}`,
  ]
  if (b.fallback !== undefined) {
    parts.push(`fallback: ${emitIrLiteral(b.fallback, thunks, slotThunks)}`)
  }
  return `{ ${parts.join(', ')} }`
}
```

Read `src/renderer/nv-emitter.ts` `emitBindingLiteral` for the exact pattern to follow.

---

## Corpus extension

Add to `test/renderer/slot-consumption.test.ts` (new describe block `§8.3 — fallback`):

**`fallback-renders-when-unfilled`** — A child component has a `slot-outlet` with a fallback.
The parent mounts the component WITHOUT filling the named slot. The fallback content appears
in the DOM.  
Both front-ends (html-tag `${slots('x', { fallback: html`...` })}` and nv-parser
`{slots.x ?? html`...`}`) produce identical `SlotOutletBinding` with `fallback` set
(`irStructurallyEqual`).  
Both back-ends render the fallback content.

**`fallback-suppressed-when-filled`** — Same child component. The parent fills the named slot.
The fallback content does NOT appear in the DOM; the filled content does.  
Both back-ends confirm filled content present and fallback NOT present.

Gate items:
- **Fail-shows-teeth:** Revert the `if (binding.fallback)` render branch in `wireSlotOutlet`
  (comment it out) → `fallback-renders-when-unfilled` FAILS; restore → PASS. Report both;
  do not commit the reverted state.
- **Anti-vacuous sweep:** zero `expect(true/false).toBe` or `expect(!` in new tests.

---

## Gates

- `tsc --noEmit` clean
- `npx vitest run` — all 3232+new tests green; report count
- `biome check` clean
- Fail-shows-teeth pair reported
- Anti-vacuous sweep reported
- `git show --stat` confirms changes are confined to `src/renderer/ir.ts`, `src/renderer/html-tag.ts`, `src/renderer/nv-parser.ts`, `src/renderer/interpreter.ts`, `src/compiler/emitted-mount.ts`, `src/renderer/nv-emitter.ts`, and the test file. NO `src/core/`.

---

## Commit discipline

Commit in at least two units:
1. Production code changes (ir.ts + front-ends + back-ends + emitter)
2. Corpus tests

Use `git push` after your final commit.

---

## Report contract

Write full report to: `docs/superpowers/plans/slot-inc1-task2-report.md`

Return only:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED  
- Commits: `<base7>..<head7>`
- Test count: `<N> tests pass`
- Fail-shows-teeth: PASSED
- Concerns (if any)
