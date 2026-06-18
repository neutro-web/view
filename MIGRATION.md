# nv repo scaffold — migration map

This scaffold is a **single published package** (`@neutro/view`) with subpath exports
(`@neutro/view/core`, `/compiler`, `/renderer`), mirroring `@neutro/form`. There is
**no** `packages/` directory and **no** `pnpm-workspace.yaml` — those are only needed
if you publish multiple packages, which you don't (subpath exports give the aliasing
you wanted from one package, one version, one build, one release).

## File placement (PK camelCase → repo kebab-case)

Rename to kebab-case on the way in, as you prefer.

### Runtime → `src/core/`
| PK file | repo path |
| --- | --- |
| `core.ts` | `src/core/core.ts` |
| `conformance.ts` | `test/core/conformance.test.ts` |

### Compiler → `src/compiler/`
| PK file | repo path |
| --- | --- |
| `types.ts` | `src/compiler/types.ts` |
| `signalTypeUtils.ts` | `src/compiler/signal-type-utils.ts` |
| `syncTargetClassifier.ts` | `src/compiler/sync-target-classifier.ts` |
| `writeGraphCycleChecker.ts` | `src/compiler/write-graph-cycle-checker.ts` |
| `equalityPolicyInference.ts` | `src/compiler/equality-policy-inference.ts` |
| `branchVariantAnalyzer.ts` | `src/compiler/branch-variant-analyzer.ts` |
| `syncTargetClassifier_test.ts` | `test/compiler/sync-target-classifier.test.ts` |
| `writeGraphCycleChecker_test.ts` | `test/compiler/write-graph-cycle-checker.test.ts` |
| `equalityPolicyInference_test.ts` | `test/compiler/equality-policy-inference.test.ts` |
| `branchVariantAnalyzer_test.ts` | `test/compiler/branch-variant-analyzer.test.ts` |
| `branchVariantRuntime_test.ts` | `test/compiler/branch-variant-runtime.test.ts` |
| `variantRuntimeHarness.ts` | `test/compiler/variant-runtime-harness.ts` (test-only helper) |
| `testHelpers.ts` | `test/compiler/test-helpers.ts` (test-only helper) |

### Renderer → `src/renderer/`
| PK file | repo path |
| --- | --- |
| `ir.ts` | `src/renderer/ir.ts` |
| `htmlTag.ts` | `src/renderer/html-tag.ts` |
| `interpreter.ts` | `src/renderer/interpreter.ts` |
| `comparator.ts` | `src/renderer/comparator.ts` |
| `interpreter_test.ts` | `test/renderer/interpreter.test.ts` |

### Integration → `integration/`
| PK file | repo path |
| --- | --- |
| `poc_integration.ts` | `integration/poc-integration.test.ts` |

### Docs → `docs/`
| PK file | repo path |
| --- | --- |
| `nv-reactive-core-contract.md` | `docs/reactive-core-contract.md` |
| `nv-decision-log.md` | `docs/decision-log.md` |
| `nv-template-ir.md` | `docs/template-ir.md` |
| `step4-soundness-design.md` | `docs/design/step4-soundness-design.md` |
| (new, empty) | `docs/decision-log-archive.md` |

## Import rewrites required

The barrels (`src/*/index.ts`) already reference kebab-case sibling files, so they're
correct as written. The moved source files need their **relative imports updated** to
(a) kebab-case names and (b) cross-concern package imports where they cross a boundary.

### Within a concern — kebab-case relative, extensionless
`moduleResolution: "bundler"` means **no `.ts` extensions** in imports. This is the
import-style unification the decision log flagged: pick extensionless everywhere.

- `signal-type-utils.ts`: `from './types'` (was `./types`) — already fine, just confirm no `.ts`.
- `sync-target-classifier.ts`: `from './signal-type-utils'`, `from './types'`.
- `write-graph-cycle-checker.ts`: `from './signal-type-utils'`, `from './types'`.
- `equality-policy-inference.ts`: `from './signal-type-utils'`, `from './types'`.
- `branch-variant-analyzer.ts`: `from './signal-type-utils'`, `from './types'`.
- `html-tag.ts`: `from './ir'`.

### Across a concern boundary — relative internal import (DECIDED)
Internal source uses **relative** imports across concerns; the `@neutro/view/*`
aliases are the external/published surface only. `interpreter.ts` currently imports
core via `./core.ts` (or the obsolete patched copy). It becomes a relative reach into
the sibling concern:

```ts
// interpreter.ts — BEFORE
import { effect, createRoot, onCleanup } from './core.ts'
// AFTER (relative to the core concern; no alias)
import { effect, createRoot, onCleanup } from '../core/core'
```

Tests:
- `integration/poc-integration.test.ts`: import core/renderer/compiler via relative
  paths into `src/` (e.g. `../src/core/core`, `../src/renderer/interpreter`,
  `../src/compiler/sync-target-classifier`). The Gate 4 "seams only" property is now
  an *intent* asserted by importing only public-surface symbols — not enforced by the
  module system. Keep importing only what the barrels expose, so the seam discipline
  holds.
- `test/renderer/interpreter.test.ts`: core via `../../src/core/core`; renderer
  internals via `../../src/renderer/...`.
- `test/compiler/test-helpers.ts`: builds a fake core for fixtures; its `@nv/core`
  fixture reference stays as the compiler tests already resolve it (it's a synthetic
  module string the classifier matches on, not a real import path).

> **Import style is settled:** relative + extensionless inside `src/` and `test/`;
> `@neutro/view/*` aliases only for external consumers via `package.json` `exports`
> and the `src/*/index.ts` barrels. No `paths` mapping needed. This closes the
> deferred import-style cleanup the decision log flagged.

## What's NOT included (deliberately)

- No `pnpm-workspace.yaml` / `packages/` — single package, subpath exports.
- No adapters yet (form has React/Svelte/etc. adapters; nv's renderer is the view
  layer itself, so adapters come later if at all — e.g. a `@neutro/view/meta` for a
  meta-framework would be a *separate package*, per your orthogonality rule).
- `core_ts6_patched.ts` is obsolete (the `Node`→`ReactiveNode` rename fixed it) — do
  not migrate it.
