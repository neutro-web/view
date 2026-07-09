# deferred-swap fixtures

Empty on purpose (directory created per the Task 5 brief so it exists, in
case a future maintainer wants file-based `.nv` fixtures for this construct).

`test/browser/deferred-swap.spec.ts` builds all its IR in-page via
`window.__nv.createHtmlTag` / `window.__nv.match` inside `page.evaluate`,
following `test/browser/real-browser.spec.ts`'s convention, rather than
authoring `.nv` files here. Reasoning (also stated at the top of the spec
file): every test in this suite needs fine-grained control over a
controllable-resource fetcher (resolve/reject on demand from the test) and,
for several tests, direct access to plain signals (`toggle`, `flag`, `tick`)
that live alongside the resource in the same reactive scope — both are far
easier to wire up as JS closures inside `page.evaluate` than to route through
`.nv`'s static authoring surface. The `.nv` authoring surface itself (Task 3)
already has its own dedicated fixture and parser-level tests at
`test/browser/fixtures/deferred-swap-parser/app-switch-pending.nv` and
`test/renderer/nv-parser.test.ts` (~line 1484) — this directory is for
real-browser *runtime* behavior of `wireDeferredSwap`, which is FE-agnostic
(both `.nv` and tagged-template forms compile to the same
`DeferredSwapBinding` IR and are wired by the same interpreter function), so
testing via one FE here does not reduce coverage of the other.
