// @neutro/view/renderer/runtime — TS-compiler-free runtime surface for emitted app bundles.
// Emitted .nv modules import `mount` from here, not from the fat @neutro/view/renderer barrel
// (which co-exports the parser and transitively pulls the TypeScript compiler).
// Build-time consumers (nvPlugin, tooling) continue to use @neutro/view/renderer.
export { mount } from './interpreter.js'
