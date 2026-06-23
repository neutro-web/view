/**
 * Bundle entry point — exports everything the browser gate needs as window.__nv.
 * This is the ONLY file that imports from src/; the test files use window.__nv.
 */

export {
  signal,
  derived,
  effect,
  flushSync,
  createRoot,
  errorBoundary,
} from '../../src/core/core.js'
export { mount } from '../../src/renderer/interpreter.js'
export { createHtmlTag } from '../../src/renderer/html-tag.js'
export { structurallyEqual } from '../../src/renderer/comparator.js'
export { emitMount } from '../../src/compiler/emitted-mount.js'
export { injectComponentStyle } from '../../src/renderer/style-inject.js'
