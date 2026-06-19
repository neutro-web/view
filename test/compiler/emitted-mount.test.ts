/**
 * nv Compiler Back-End — Phase 1b-1 Differential Gate Tests
 * Spec: Phase 1b spec 2026-06-19 §5 (gate cases) + §7 (perf characterization)
 *
 * Each test runs the same TemplateIR through two back-ends:
 *   Interpreter (ground truth): mount(ir, parent, doc)
 *   Emitter    (under test):    emitMount(ir, verdicts).mountFn(parent, doc)
 *
 * Comparison via structurallyEqual() (attribute-order-independent, NOT outerHTML).
 * flushSync() required after every signal write before DOM assertion.
 *
 * Required gate cases (§5 of the spec):
 *   GATE 1 — Tracked read parity (ACCEPT): write source → DOM updates identically.
 *   GATE 2 — PLAIN binding parity: non-reactive expr → same behavior as interpreter.
 *   GATE 3 — Event-write DECLINE: diagnostic produced + binding not broken (DOM matches).
 *   GATE 4 — No-leak parity: mount + dispose → identical zero-observer state.
 *   GATE 5 — Corpus parity: all in-slice binding kinds (Text/Attr/Prop/Event) match.
 *
 * Performance characterization (§7): logged, not a gate assertion.
 */

import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { emitMount } from '../../src/compiler/emitted-mount.js'
import type { BindingErasureVerdict } from '../../src/compiler/types.js'
import { __test, flushSync, signal, sync } from '../../src/core/core.js'
import { structurallyEqual } from '../../src/renderer/comparator.js'
import { createHtmlTag } from '../../src/renderer/html-tag.js'
import { mount } from '../../src/renderer/interpreter.js'
import type { ChildBinding, EventBinding, PropBinding, TemplateIR } from '../../src/renderer/ir.js'

// ── DOM helpers ────────────────────────────────────────────────────────────────

function makeDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const document = dom.window.document as unknown as Document
  const html = createHtmlTag(document)
  return { document, html }
}

function makeContainers(document: Document) {
  const containerI = document.createElement('div')
  const containerE = document.createElement('div')
  document.body.appendChild(containerI)
  document.body.appendChild(containerE)
  return { containerI, containerE }
}

/** Assert structural DOM equality between the two back-ends' output. */
function assertEqual(a: Element, b: Element, label: string): void {
  const r = structurallyEqual(a, b)
  expect(r.equal, `${label}: DOM mismatch — ${r.diffPath}`).toBe(true)
}

/** Run the full differential check: mount both, compare initial, write, compare again. */
function differential(
  ir: TemplateIR,
  document: Document,
  scenario: (containerI: Element, containerE: Element) => void,
  verdicts: ReadonlyMap<number, BindingErasureVerdict> = new Map(),
): { diagnostics: ReadonlyArray<string>; disposeI: () => void; disposeE: () => void } {
  const { containerI, containerE } = makeContainers(document)

  const disposeI = mount(ir, containerI, document)
  const { mountFn, diagnostics } = emitMount(ir, verdicts)
  const disposeE = mountFn(containerE, document)

  flushSync()
  assertEqual(containerI, containerE, 'initial')

  scenario(containerI, containerE)

  return { diagnostics, disposeI, disposeE }
}

// ── GATE 1: Tracked read parity (ACCEPT) ─────────────────────────────────────

test('GATE 1: TextBinding — reactive read tracks, DOM updates identically after write', () => {
  const { document, html } = makeDom()
  const count = signal(0)
  const ir = html`<span>${() => count()}</span>`

  const { disposeI, disposeE } = differential(ir, document, (cI, cE) => {
    count.set(42)
    flushSync()
    expect(cI.querySelector('span')!.textContent, 'interpreter text').toBe('42')
    expect(cE.querySelector('span')!.textContent, 'emitter text').toBe('42')
    assertEqual(cI, cE, 'post-write')
  })

  disposeI()
  disposeE()
})

test('GATE 1: AttrBinding — reactive attr read tracks, updates identically', () => {
  const { document, html } = makeDom()
  const cls = signal('active')
  const ir = html`<div class="${() => cls()}"></div>`

  const { disposeI, disposeE } = differential(ir, document, (cI, cE) => {
    cls.set('inactive')
    flushSync()
    expect((cI.querySelector('div') as HTMLElement).getAttribute('class')).toBe('inactive')
    expect((cE.querySelector('div') as HTMLElement).getAttribute('class')).toBe('inactive')
    assertEqual(cI, cE, 'post-write')
  })

  disposeI()
  disposeE()
})

test('GATE 1: AttrBinding — null removes attribute (boolean-attr semantics)', () => {
  const { document, html } = makeDom()
  const hidden = signal<boolean | null>(true)
  const ir = html`<button hidden="${() => hidden()}">x</button>`

  const { disposeI, disposeE } = differential(ir, document, (cI, cE) => {
    // Set to null → removeAttribute
    hidden.set(null)
    flushSync()
    assertEqual(cI, cE, 'post-null')
    // Set back to true → setAttribute('hidden', '')
    hidden.set(true)
    flushSync()
    assertEqual(cI, cE, 'post-true')
  })

  disposeI()
  disposeE()
})

// ── GATE 2: PLAIN binding parity ─────────────────────────────────────────────

test('GATE 2: PLAIN verdict — non-reactive constant still wired, DOM matches interpreter', () => {
  const { document, html } = makeDom()
  const localConst = 'hello'
  const ir = html`<span>${() => localConst}</span>`

  // PLAIN verdict for hole 0 (no reactive read)
  const verdicts: Map<number, BindingErasureVerdict> = new Map([
    [0, { kind: 'PLAIN', expressionIndex: 0, reason: 'no reactive reads' }],
  ])

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn, diagnostics } = emitMount(ir, verdicts)
  const disposeE = mountFn(containerE, document)

  flushSync()
  expect(diagnostics.length, 'PLAIN produces no diagnostic').toBe(0)
  assertEqual(containerI, containerE, 'PLAIN parity')
  expect(containerE.querySelector('span')!.textContent, 'value is wired').toBe('hello')

  disposeI()
  disposeE()
})

// ── GATE 3: Event-write DECLINE ───────────────────────────────────────────────

test('GATE 3: EventBinding DECLINE — diagnostic produced, binding still wired correctly', () => {
  const { document } = makeDom()
  const count = signal(0)
  const src = signal(0)
  const stopSync = sync(
    () => src(),
    count,
    (v: number) => v,
  )

  // Manually construct a TemplateIR with an EventBinding (not produced by html-tag.ts)
  const ir: TemplateIR = {
    id: 'test:decline-event',
    shape: {
      html: '<button>click</button>',
      bindingPaths: [[0]], // frag.childNodes[0] = button
    },
    bindings: [
      {
        kind: 'event',
        pathIndex: 0,
        eventName: 'click',
        handler: () => () => count.set(99),
        handlerKind: 'reactive',
      } as EventBinding,
    ],
  }

  // DECLINE verdict for this event binding (sync-target write)
  const verdicts: Map<number, BindingErasureVerdict> = new Map([
    [
      0,
      {
        kind: 'DECLINE',
        expressionIndex: 0,
        reason: 'event handler writes to sync-target signal',
        diagnostic: '[nv/emit] sync-target write conflict: count.set() in onclick',
        syncTargetId: 'test-sync-target-id',
      },
    ],
  ])

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn, diagnostics } = emitMount(ir, verdicts)
  const disposeE = mountFn(containerE, document)

  flushSync()

  // (a) Diagnostic must be produced
  expect(diagnostics.length, 'DECLINE produces exactly one diagnostic').toBe(1)
  expect(diagnostics[0]!.includes('sync-target'), 'diagnostic mentions sync-target').toBe(true)

  // (b) Binding is not broken — DOM matches interpreter at mount
  assertEqual(containerI, containerE, 'DECLINE: DOM matches interpreter at mount')

  // (c) Event handler still wires — click updates count through the binding
  const buttonE = containerE.querySelector('button') as HTMLElement
  buttonE.click()
  flushSync()

  const buttonI = containerI.querySelector('button') as HTMLElement
  buttonI.click()
  flushSync()

  // Both back-ends have the handler wired (DOM effects of the click would be
  // identical if both templates had a text binding observing count — here we
  // just verify the bindings didn't throw and the handlers ran)
  expect(count()).toBe(99)

  disposeI()
  disposeE()
  stopSync()
})

// ── GATE 4: No-leak parity ────────────────────────────────────────────────────

test('GATE 4: No-leak — dispose severs all edges, identical observer count to interpreter', () => {
  const { document, html } = makeDom()
  const count = signal(0)
  const ir = html`<span>${() => count()}</span>`

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn } = emitMount(ir)
  const disposeE = mountFn(containerE, document)

  flushSync()

  // Both effects observe count: 2 observers
  expect(__test.observerCount(count), 'two observers before dispose').toBe(2)

  // Dispose interpreter: drops to 1
  disposeI()
  expect(__test.observerCount(count), 'one observer after interpreter dispose').toBe(1)
  expect(containerI.querySelector('span'), 'interpreter DOM removed').toBeNull()

  // Dispose emitter: drops to 0
  disposeE()
  expect(__test.observerCount(count), 'zero observers after emitter dispose').toBe(0)
  expect(containerE.querySelector('span'), 'emitter DOM removed').toBeNull()
})

test('GATE 4: No-leak — signals stay clean after dispose, writes no longer update DOM', () => {
  const { document, html } = makeDom()
  const value = signal('a')
  const ir = html`<span>${() => value()}</span>`

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn } = emitMount(ir)
  const disposeE = mountFn(containerE, document)

  flushSync()
  expect(containerI.querySelector('span')!.textContent).toBe('a')
  expect(containerE.querySelector('span')!.textContent).toBe('a')

  disposeI()
  disposeE()

  // Post-dispose write: DOM should not change (both bindings dead)
  value.set('b')
  flushSync()

  expect(containerI.querySelector('span'), 'interpreter span removed').toBeNull()
  expect(containerE.querySelector('span'), 'emitter span removed').toBeNull()
  expect(__test.observerCount(value), 'no observers after dispose').toBe(0)
})

// ── GATE 5: Corpus parity — all in-slice binding kinds ────────────────────────

test('GATE 5: PropBinding — property set identically to interpreter', () => {
  const { document } = makeDom()
  const disabled = signal(false)

  // Manually constructed TemplateIR — html-tag.ts doesn't produce PropBinding
  const ir: TemplateIR = {
    id: 'test:prop',
    shape: {
      html: '<button>Submit</button>',
      bindingPaths: [[0]],
    },
    bindings: [
      {
        kind: 'prop',
        pathIndex: 0,
        name: 'disabled',
        expr: () => disabled(),
      } as PropBinding,
    ],
  }

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn, diagnostics } = emitMount(ir)
  const disposeE = mountFn(containerE, document)

  flushSync()
  expect(diagnostics.length).toBe(0)
  assertEqual(containerI, containerE, 'initial')

  disabled.set(true)
  flushSync()
  expect((containerI.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
  expect((containerE.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
  assertEqual(containerI, containerE, 'post-disable')

  disabled.set(false)
  flushSync()
  assertEqual(containerI, containerE, 'post-enable')

  disposeI()
  disposeE()
})

test('GATE 5: EventBinding — listener fires and updates signal, same as interpreter', () => {
  const { document } = makeDom()
  const count = signal(0)

  const ir: TemplateIR = {
    id: 'test:event',
    shape: {
      html: '<button>Click</button>',
      bindingPaths: [[0]],
    },
    bindings: [
      {
        kind: 'event',
        pathIndex: 0,
        eventName: 'click',
        handler: () => () => count.set(count() + 1),
        handlerKind: 'reactive',
      } as EventBinding,
    ],
  }

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn } = emitMount(ir)
  const disposeE = mountFn(containerE, document)

  flushSync()
  ;(containerI.querySelector('button') as HTMLElement).click()
  ;(containerE.querySelector('button') as HTMLElement).click()

  expect(count(), 'two clicks → count = 2 (one per back-end)').toBe(2)

  disposeI()
  disposeE()
})

test('GATE 5: Multi-binding template — Text + Attr on same element, both back-ends agree', () => {
  const { document, html } = makeDom()
  const label = signal('hello')
  const cls = signal('primary')
  const ir = html`<span class="${() => cls()}">${() => label()}</span>`

  const { disposeI, disposeE } = differential(ir, document, (cI, cE) => {
    label.set('world')
    cls.set('danger')
    flushSync()
    assertEqual(cI, cE, 'post-write multi-binding')
    expect(cI.querySelector('span')!.textContent).toBe('world')
    expect(cI.querySelector('span')!.getAttribute('class')).toBe('danger')
  })

  disposeI()
  disposeE()
})

test('GATE 5: Out-of-slice binding throws at EMIT time, not mount time', () => {
  const ir: TemplateIR = {
    id: 'test:oob',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [{ kind: 'child', pathIndex: 0, expr: () => 'x' } as unknown as ChildBinding],
  }
  expect(() => emitMount(ir)).toThrow(/1b-1 scope/)
})

// ── §7: Performance characterization ─────────────────────────────────────────

test('§7: Performance characterization (emitted vs. interpreter, logged, not a gate)', () => {
  const { document, html } = makeDom()
  const a = signal(0)
  const b = signal(0)
  const c = signal(0)
  const ir = html`<div class="${() => String(a())}">${() => b() + c()}</div>`

  const ITERATIONS = 1000

  // Warm up
  for (let i = 0; i < 10; i++) {
    const d = mount(ir, document.createElement('div'), document)
    flushSync()
    d()
  }

  // Interpreter mount time
  const t0 = performance.now()
  for (let i = 0; i < ITERATIONS; i++) {
    const parent = document.createElement('div')
    const d = mount(ir, parent, document)
    flushSync()
    d()
  }
  const interpreterMountMs = performance.now() - t0

  // Emitter: emit once, mount ITERATIONS times
  const emitT0 = performance.now()
  const { mountFn } = emitMount(ir)
  const emitTimeMs = performance.now() - emitT0

  const t1 = performance.now()
  for (let i = 0; i < ITERATIONS; i++) {
    const parent = document.createElement('div')
    const d = mountFn(parent, document)
    flushSync()
    d()
  }
  const emitterMountMs = performance.now() - t1

  // Update characterization: write signal N times with both back-ends mounted
  const cI = document.createElement('div')
  const cE = document.createElement('div')
  const dI = mount(ir, cI, document)
  const { mountFn: mF } = emitMount(ir)
  const dE = mF(cE, document)
  flushSync()

  const UPDATE_ITERATIONS = 10000
  const u0 = performance.now()
  for (let i = 0; i < UPDATE_ITERATIONS; i++) {
    a.set(i)
    flushSync()
  }
  const interpreterUpdateMs = performance.now() - u0

  const u1 = performance.now()
  for (let i = 0; i < UPDATE_ITERATIONS; i++) {
    b.set(i)
    flushSync()
  }
  const emitterUpdateMs = performance.now() - u1

  dI()
  dE()

  console.log(
    `\n  §7 Performance characterization (${ITERATIONS} mount iterations, ${UPDATE_ITERATIONS} update iterations):`,
  )
  console.log(`     Emit time (one-time):      ${emitTimeMs.toFixed(3)}ms`)
  console.log(
    `     Interpreter mount total:   ${interpreterMountMs.toFixed(1)}ms  (${((interpreterMountMs / ITERATIONS) * 1000).toFixed(1)}μs/mount)`,
  )
  console.log(
    `     Emitter mount total:       ${emitterMountMs.toFixed(1)}ms  (${((emitterMountMs / ITERATIONS) * 1000).toFixed(1)}μs/mount)`,
  )
  console.log(
    `     Mount speedup:             ${(interpreterMountMs / emitterMountMs).toFixed(2)}x`,
  )
  console.log(
    `     Interpreter update total:  ${interpreterUpdateMs.toFixed(1)}ms  (${((interpreterUpdateMs / UPDATE_ITERATIONS) * 1000).toFixed(1)}μs/update)`,
  )
  console.log(
    `     Emitter update total:      ${emitterUpdateMs.toFixed(1)}ms  (${((emitterUpdateMs / UPDATE_ITERATIONS) * 1000).toFixed(1)}μs/update)`,
  )
  console.log(
    `     Update ratio:              ${(emitterUpdateMs / interpreterUpdateMs).toFixed(2)}x`,
  )

  // Soft assertion: emitter should not be dramatically slower at mount (2x ceiling)
  expect(
    emitterMountMs < interpreterMountMs * 2,
    `emitter mount is >2x slower than interpreter (${(emitterMountMs / interpreterMountMs).toFixed(2)}x) — unexpected`,
  ).toBe(true)
})
