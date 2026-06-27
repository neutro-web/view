# API Reference

`@neutro/view` ships four import paths. Each targets a distinct role in the build and runtime pipeline.

| Import path | Contents | When to use |
|---|---|---|
| `@neutro/view/core` | Reactive primitives: signals, derived, effects, scheduling | Application code, anywhere |
| `@neutro/view/renderer` | DOM renderer, html tag, IR types, nv parser | Build plugins, tests, tagged-template apps |
| `@neutro/view/renderer/runtime` | `mount` only — no parser, no TS compiler | Emitted .nv bundles (handled automatically by nvPlugin) |
| `@neutro/view/renderer/plugin` | esbuild `nvPlugin` | Build configuration |

Every signature in this reference was read directly from source. See [Plugin & Runtime](/api/plugin#source-files-verified) for the list of verified files.

---

## In this section

- [Core](/api/core) — `signal`, `derived`, `effect`, `sync`, `pubsub`, `errorBoundary`, `batch`, `untrack`, `createRoot`, `onCleanup`, `flushSync`, and all associated types
- [Renderer](/api/renderer) — `mount`, `createHtmlTag`, `slots`, `slot`, `each`, `cx`, `classes`, IR types, sentinel types, compiler-facing exports
- [Plugin & Runtime](/api/plugin) — `nvPlugin`, `@neutro/view/renderer/runtime`, source file index
