---
layout: home

hero:
  name: "@neutro/view"
  text: Fine-grained reactive view engine
  tagline: No virtual DOM. Signal-native. Framework-portable.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/neutro-web/view

features:
  - title: Signal-native reactivity
    details: Powered by alien-signals — only the exact DOM nodes that depend on a changed signal update.
  - title: Two authoring surfaces
    details: Write components in compiled .nv files (ergonomic, assignment-erasure) or use the html tagged template directly — no build step, no plugin required.
  - title: No virtual DOM
    details: A keyed reconciler moves real DOM nodes directly. No diffing, no patching, no runtime overhead per update.
  - title: Framework-portable
    details: No framework lock-in. The engine is a single npm package usable from any build toolchain or served as a plain ES module.
---
