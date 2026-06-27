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
  - title: Compiled .nv templates
    details: The .nv format compiles to zero-overhead Template IR. No runtime diffing, no reconciler.
  - title: Framework-portable
    details: No framework lock-in. The engine is a single npm package usable from any build toolchain.
---
