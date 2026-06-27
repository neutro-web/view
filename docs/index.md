---
layout: home

hero:
  name: '@neutro/view'
  tagline: Fine-grained reactive view engine for the web.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /guide/api-reference

features:
  - title: Signal-native reactivity
    details: Powered by alien-signals — only the exact DOM nodes that depend on a changed signal update. Zero wasted renders.

  - title: Two authoring surfaces
    details: Write components in compiled .nv files with ergonomic assignment-erasure, or use the html tagged template directly — no build step, no plugin required.

  - title: No virtual DOM
    details: A keyed reconciler moves real DOM nodes directly. No diffing, no patching, no runtime overhead per update.

  - title: Fine-grained updates
    details: Each reactive binding is a single effect that updates exactly one DOM attribute or text node. Updates are surgically targeted, never component-wide.

  - title: Keyed reconciler
    details: List reorders move existing DOM nodes with insertBefore rather than destroying and rebuilding them — preserving focus, scroll position, and input values across updates.

  - title: Framework-portable
    details: No framework lock-in. The engine ships as a single npm package usable from any build toolchain or served as a plain ES module with no bundler.
---
