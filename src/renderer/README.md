# @neutro/view/renderer

Turns a Template IR into live DOM with fine-grained bindings, consuming the reactive
core. Web Components are a compile *target*, not the programming model.

## Architecture

One template language, one IR, two front-ends, two back-ends:
- **Front-ends → IR:** a tagged-template `` html`...` `` (no-build mode) and a `.nv`
  file front-end (primary ergonomic mode, `{}` delimiters). Both produce identical IR.
- **IR → output:** the runtime **interpreter** (here) and a **compiler** back-end
  (deferred — "the interpreter, partially evaluated").

The IR contract is [`docs/template-ir.md`](../../docs/template-ir.md).

## Surface

- `mount(ir, parent, doc?)` — instantiate a Template IR into a parent; returns a disposer.
- `createHtmlTag(doc)` — the tagged-template front-end.
- `structurallyEqual(a, b)` — the differential comparator (structural DOM equality,
  used to assert interpreter/compiler back-end equivalence).

## Status

Interpreter back-end functionally complete for the PoC: all six binding kinds
(text, attr, prop, event, child [primitives], conditional) verified against the real
core. Disposal is §6-correct (one `createRoot` per mounted region; no leaked edges).
Real-DOM behavior (custom-element lifecycle) and the compiler back-end are the next
phase.
