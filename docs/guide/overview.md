# Overview

`@neutro/view` (nv) is a fine-grained reactive view engine for the web. At v0.1.0 it is tagged, compilable, and benchmarked against comparable frameworks.

## The design model

Components in nv run exactly once. During that single execution, signals record which DOM nodes read which values. When a signal changes, nv updates only those exact nodes — there is no virtual DOM, no re-render pass, and no diffing. For lists, a keyed reconciler moves real DOM nodes directly to handle reorders.

This makes the update path proportional to what changed, not to the size of the component tree.

See the [Decision Log](https://github.com/neutro-web/view/blob/main/docs/decision-log.md) for the rationale behind these choices.

## The four primitives

| Primitive | Purpose |
|-----------|---------|
| `signal` | A readable/writable reactive value |
| `derived` | A computed value that updates when its dependencies change |
| `effect` | A side-effectful computation that re-runs when its dependencies change |
| `sync` | A synchronous effect variant for write-time side effects |

Also exported from core: `pubsub`, `errorBoundary`, `batch`, `untrack`, `createRoot`, `onCleanup`, `flushSync`.

## Authoring model

Components are written in `.nv` files — a template format compiled by the esbuild plugin `nvPlugin`. The plugin emits IR-based code consumed by the renderer at runtime.

See [Getting Started](./getting-started.md) for install and plugin setup.

## Package exports

**`@neutro/view/core`**

The reactive runtime. Has zero DOM dependency and can run in any JavaScript environment. Contains the four primitives and all scheduling utilities.

**`@neutro/view/compiler`**

Template IR types, sync-target classification, write-graph cycle checker, and §10 specialization hooks. Used by build tooling, not at runtime in the browser.

**`@neutro/view/renderer`**

Consumes the reactive core and renders Template IR to live DOM. Exports `mount`, html-tag helpers, and the IR types needed by component authors.

**`@neutro/view/renderer/runtime`**

A slim entry point for emitted bundles. Exports only `mount` — no parser, no TypeScript compiler. This is what the esbuild plugin links against in production builds.

## What is not in v0.1.0

Async primitives, a store, context, and SSR are planned for v0.5.0 and are not available in this release.

## Next steps

- [Getting Started](./getting-started.md) — install and first component
- [API Reference](./api-reference.md) — full signatures for all exports
- [Decision Log](https://github.com/neutro-web/view/blob/main/docs/decision-log.md) — rationale for architectural choices
