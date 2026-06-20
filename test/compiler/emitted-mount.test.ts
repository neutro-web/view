/**
 * nv Compiler Back-End — Phase 1b Differential Gate Tests
 * Spec: Phase 1b spec 2026-06-19 §5 (gate cases) + §7 (perf characterization)
 *
 * Each test runs the same TemplateIR through two back-ends:
 *   Interpreter (ground truth): mount(ir, parent, doc)
 *   Emitter    (under test):    emitMount(ir, verdicts).mountFn(parent, doc)
 *
 * Comparison via structurallyEqual() (attribute-order-independent, NOT outerHTML).
 * flushSync() required after every signal write before DOM assertion.
 *
 * Gate cases (§5 of the spec):
 *   GATE 1 — Tracked read parity (ACCEPT): write source → DOM updates identically.
 *   GATE 2 — PLAIN binding parity: non-reactive expr → same behavior as interpreter.
 *   GATE 3 — Event-write DECLINE: diagnostic produced + binding not broken (DOM matches).
 *   GATE 4 — No-leak parity: mount + dispose → identical zero-observer state.
 *   GATE 5 — Corpus parity: all in-slice binding kinds (Text/Attr/Prop/Event) match.
 *
 * Phase 1b-2 additions: ChildBinding + ConditionalBinding gate cases.
 * Performance characterization (§7): logged, not a gate assertion.
 */

import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { emitMount } from '../../src/compiler/emitted-mount.js'
import {
  type EqualityPolicy,
  emitEqualityHook,
  emitEqualityHooks,
} from '../../src/compiler/equality-hook-emitter.js'
import type { BindingErasureVerdict } from '../../src/compiler/types.js'
import { __test, flushSync, signal, sync } from '../../src/core/core.js'
import { structurallyEqual } from '../../src/renderer/comparator.js'
import { createHtmlTag } from '../../src/renderer/html-tag.js'
import { mount } from '../../src/renderer/interpreter.js'
import type {
  ChildBinding,
  ConditionalBinding,
  EventBinding,
  PropBinding,
  TemplateIR,
  TextBinding,
} from '../../src/renderer/ir.js'

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
    hidden.set(null)
    flushSync()
    assertEqual(cI, cE, 'post-null')
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

  const ir: TemplateIR = {
    id: 'test:decline-event',
    shape: {
      html: '<button>click</button>',
      bindingPaths: [[0]],
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

  expect(diagnostics.length, 'DECLINE produces exactly one diagnostic').toBe(1)
  expect(diagnostics[0]!.includes('sync-target'), 'diagnostic mentions sync-target').toBe(true)

  assertEqual(containerI, containerE, 'DECLINE: DOM matches interpreter at mount')

  const buttonE = containerE.querySelector('button') as HTMLElement
  buttonE.click()
  flushSync()

  const buttonI = containerI.querySelector('button') as HTMLElement
  buttonI.click()
  flushSync()

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

  expect(__test.observerCount(count), 'two observers before dispose').toBe(2)

  disposeI()
  expect(__test.observerCount(count), 'one observer after interpreter dispose').toBe(1)
  expect(containerI.querySelector('span'), 'interpreter DOM removed').toBeNull()

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

test('GATE 5: SyncBinding (still deferred) throws at emit time', () => {
  const ir: TemplateIR = {
    id: 'test:sync-deferred',
    shape: { html: '<input />', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'sync',
        pathIndex: 0,
        propName: 'value',
        readExpr: () => '',
        eventName: 'input',
        writeTarget: () => ({ set: () => {} }),
      } as unknown as ChildBinding,
    ],
  }
  expect(() => emitMount(ir)).toThrow()
})

// ── §7: Performance characterization ─────────────────────────────────────────

test('§7: Performance characterization (emitted vs. interpreter, logged, not a gate)', () => {
  const { document, html } = makeDom()
  const a = signal(0)
  const b = signal(0)
  const c = signal(0)
  const ir = html`<div class="${() => String(a())}">${() => b() + c()}</div>`

  const ITERATIONS = 1000

  for (let i = 0; i < 10; i++) {
    const d = mount(ir, document.createElement('div'), document)
    flushSync()
    d()
  }

  const t0 = performance.now()
  for (let i = 0; i < ITERATIONS; i++) {
    const parent = document.createElement('div')
    const d = mount(ir, parent, document)
    flushSync()
    d()
  }
  const interpreterMountMs = performance.now() - t0

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

  expect(
    emitterMountMs < interpreterMountMs * 2,
    `emitter mount is >2x slower than interpreter (${(emitterMountMs / interpreterMountMs).toFixed(2)}x) — unexpected`,
  ).toBe(true)
})

// ══════════════════════════════════════════════════════════════════════════════
// Phase 1b-2: ChildBinding + ConditionalBinding Gate Tests
// ══════════════════════════════════════════════════════════════════════════════

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChildIR(expr: () => string | number | null | undefined): TemplateIR {
  return {
    id: 'test:child',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [{ kind: 'child', pathIndex: 0, expr } as ChildBinding],
  }
}

function makeConditionalIR(
  condition: () => boolean,
  consequentHtml: string,
  alternateHtml: string | null,
): TemplateIR {
  const consequent: TemplateIR = {
    id: 'test:branch-true',
    shape: { html: consequentHtml, bindingPaths: [] },
    bindings: [],
  }
  const alternate: TemplateIR | null = alternateHtml
    ? { id: 'test:branch-false', shape: { html: alternateHtml, bindingPaths: [] }, bindings: [] }
    : null
  return {
    id: 'test:conditional',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'conditional',
        pathIndex: 0,
        condition,
        consequent,
        alternate,
      } as ConditionalBinding,
    ],
  }
}

// ── GATE 1 (Child): tracked-read parity ───────────────────────────────────────

test('GATE 1 (Child): reactive value updates textNode.data identically — both back-ends', () => {
  const { document } = makeDom()
  const value = signal<string | number>('hello')
  const ir = makeChildIR(() => value())

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn, diagnostics } = emitMount(ir)
  const disposeE = mountFn(containerE, document)
  flushSync()

  expect(diagnostics.length).toBe(0)
  assertEqual(containerI, containerE, 'initial')
  expect(containerI.querySelector('div')!.textContent).toBe('hello')

  value.set('world')
  flushSync()
  assertEqual(containerI, containerE, 'post-string-write')
  expect(containerE.querySelector('div')!.textContent).toBe('world')

  value.set(42)
  flushSync()
  assertEqual(containerI, containerE, 'post-number-write')
  expect(containerE.querySelector('div')!.textContent).toBe('42')

  // Verify update = .data mutation, not node replacement.
  // Both should have [textNode, anchorComment] inside div (2 children).
  const divI = containerI.querySelector('div')!
  const divE = containerE.querySelector('div')!
  expect(divI.childNodes.length, 'interpreter: text + anchor (2 children)').toBe(2)
  expect(divE.childNodes.length, 'emitter: text + anchor (2 children)').toBe(2)
  expect(divI.childNodes[0]!.nodeType, 'interpreter: first child is Text').toBe(3)
  expect(divE.childNodes[0]!.nodeType, 'emitter: first child is Text').toBe(3)

  disposeI()
  disposeE()
})

test('GATE 1 (Child): null/undefined → empty string — both back-ends', () => {
  const { document } = makeDom()
  const value = signal<string | null | undefined>('x')
  const ir = makeChildIR(() => value())

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn } = emitMount(ir)
  const disposeE = mountFn(containerE, document)
  flushSync()

  value.set(null)
  flushSync()
  assertEqual(containerI, containerE, 'post-null')
  expect(containerI.querySelector('div')!.textContent).toBe('')

  value.set(undefined)
  flushSync()
  assertEqual(containerI, containerE, 'post-undefined')

  disposeI()
  disposeE()
})

// ── GATE 2 (Child): non-primitive rejection parity (TC-09) ───────────────────

test('GATE 2 (Child): non-primitive value routes error identically — both back-ends', () => {
  const { document } = makeDom()
  const errors: string[] = []
  const origError = console.error
  console.error = (...args: unknown[]) => {
    errors.push(String(args[0]))
    origError(...args)
  }

  const ir = makeChildIR(() => ({ notPrimitive: true }) as unknown as string)

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn } = emitMount(ir)
  const disposeE = mountFn(containerE, document)
  flushSync()

  console.error = origError

  expect(errors.length, `expected ≥2 errors, got ${errors.length}`).toBeGreaterThanOrEqual(2)
  expect(
    errors.every((e) => e.includes('[nv]')),
    'all errors are nv-formatted',
  ).toBe(true)

  assertEqual(containerI, containerE, 'non-primitive: DOM parity after error')

  disposeI()
  disposeE()
})

// ── GATE 3 (Conditional): flip parity ────────────────────────────────────────

test('GATE 3 (Conditional): flip condition — correct branch mounted, old removed', () => {
  const { document } = makeDom()
  const show = signal(true)
  const ir = makeConditionalIR(() => show(), '<span>yes</span>', '<span>no</span>')

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn } = emitMount(ir)
  const disposeE = mountFn(containerE, document)
  flushSync()

  assertEqual(containerI, containerE, 'initial (true)')
  expect(containerI.querySelector('span')!.textContent).toBe('yes')

  show.set(false)
  flushSync()
  assertEqual(containerI, containerE, 'post-flip-false')
  expect(containerI.querySelector('span')!.textContent).toBe('no')

  show.set(true)
  flushSync()
  assertEqual(containerI, containerE, 'post-flip-true')
  expect(containerI.querySelector('span')!.textContent).toBe('yes')

  disposeI()
  disposeE()
})

test('GATE 3 (Conditional): null alternate — mounting nothing when false (pure if)', () => {
  const { document } = makeDom()
  const show = signal(true)
  const ir = makeConditionalIR(() => show(), '<span>present</span>', null)

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn } = emitMount(ir)
  const disposeE = mountFn(containerE, document)
  flushSync()

  assertEqual(containerI, containerE, 'initial (true)')
  expect(containerI.querySelector('span')).not.toBeNull()

  show.set(false)
  flushSync()
  assertEqual(containerI, containerE, 'post-flip-false: nothing mounted')
  expect(containerI.querySelector('span')).toBeNull()

  show.set(true)
  flushSync()
  assertEqual(containerI, containerE, 'post-flip-true: span back')

  disposeI()
  disposeE()
})

// ── GATE 4 (Conditional): flip-no-leak parity (THE load-bearing case) ─────────

test('GATE 4 (Conditional): 1000 flips — no DOM accumulation, observer count stays 1', () => {
  const { document } = makeDom()
  const show = signal(true)
  const ir = makeConditionalIR(() => show(), '<span>yes</span>', '<span>no</span>')

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn } = emitMount(ir)
  const disposeE = mountFn(containerE, document)
  flushSync()

  for (let i = 0; i < 1000; i++) {
    show.set(i % 2 === 0)
    flushSync()
  }

  const divI = containerI.querySelector('div')!
  const divE = containerE.querySelector('div')!

  expect(
    divI.childNodes.length,
    `interpreter: expected 2 children after 1000 flips, got ${divI.childNodes.length}`,
  ).toBe(2)
  expect(
    divE.childNodes.length,
    `emitter: expected 2 children after 1000 flips, got ${divE.childNodes.length}`,
  ).toBe(2)

  assertEqual(containerI, containerE, 'post-1000-flips DOM parity')

  expect(
    __test.observerCount(show),
    `expected 2 condition observers (1 per back-end), got ${__test.observerCount(show)}`,
  ).toBe(2)

  disposeI()
  expect(__test.observerCount(show), 'post-interpreter-dispose: 1 observer').toBe(1)
  disposeE()
  expect(__test.observerCount(show), 'post-all-dispose: 0 observers (no leak)').toBe(0)

  expect(containerI.querySelector('div'), 'interpreter div removed after dispose').toBeNull()
  expect(containerE.querySelector('div'), 'emitter div removed after dispose').toBeNull()
})

// ── GATE 5 (Conditional): adversarial severance parity ───────────────────────

test('GATE 5 (Conditional): post-flip write to OLD branch has no effect on DOM', () => {
  const { document } = makeDom()
  const show = signal(true)
  const branchValue = signal('A')

  const consequent: TemplateIR = {
    id: 'test:branch-reactive',
    shape: { html: '<span><!--nv-0--></span>', bindingPaths: [[0, 0]] },
    bindings: [{ kind: 'text', pathIndex: 0, expr: () => branchValue() } as TextBinding],
  }

  const alternate: TemplateIR = {
    id: 'test:branch-alt',
    shape: { html: '<em>else</em>', bindingPaths: [] },
    bindings: [],
  }

  const ir: TemplateIR = {
    id: 'test:conditional-reactive-branch',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'conditional',
        pathIndex: 0,
        condition: () => show(),
        consequent,
        alternate,
      } as ConditionalBinding,
    ],
  }

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn } = emitMount(ir)
  const disposeE = mountFn(containerE, document)
  flushSync()

  expect(containerI.querySelector('span')!.textContent).toBe('A')

  show.set(false)
  flushSync()
  assertEqual(containerI, containerE, 'after flip to alternate')
  expect(containerI.querySelector('em')!.textContent).toBe('else')

  branchValue.set('STALE')
  flushSync()
  assertEqual(containerI, containerE, 'after stale write to old branch')
  expect(containerI.querySelector('em')!.textContent, 'em still says else').toBe('else')
  expect(containerI.querySelector('span'), 'span (old branch) is gone').toBeNull()

  show.set(true)
  flushSync()
  assertEqual(containerI, containerE, 'after flip back')
  expect(containerI.querySelector('span')!.textContent, 'new branch reads current value').toBe(
    'STALE',
  )

  disposeI()
  disposeE()
})

test('GATE 5 (Conditional): parent dispose while branch mounted — full cleanup', () => {
  const { document } = makeDom()
  const show = signal(true)
  const ir = makeConditionalIR(() => show(), '<span>yes</span>', null)

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn } = emitMount(ir)
  const disposeE = mountFn(containerE, document)
  flushSync()

  expect(containerI.querySelector('span')!.textContent).toBe('yes')
  expect(__test.observerCount(show), 'two observers before dispose').toBe(2)

  disposeI()
  disposeE()

  expect(__test.observerCount(show), 'zero observers after dispose-while-mounted').toBe(0)
  expect(containerI.querySelector('div'), 'interpreter div removed').toBeNull()
  expect(containerE.querySelector('div'), 'emitter div removed').toBeNull()
})

// ── GATE 6 (Conditional): corpus — mixed bindings in branch templates ─────────

test('GATE 6 (Conditional + Text): reactive text inside branch updates correctly', () => {
  const { document } = makeDom()
  const show = signal(true)
  const label = signal('hello')

  const consequent: TemplateIR = {
    id: 'test:branch-with-text',
    shape: { html: '<p><!--nv-0--></p>', bindingPaths: [[0, 0]] },
    bindings: [{ kind: 'text', pathIndex: 0, expr: () => label() } as TextBinding],
  }

  const ir: TemplateIR = {
    id: 'test:cond-text',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'conditional',
        pathIndex: 0,
        condition: () => show(),
        consequent,
        alternate: null,
      } as ConditionalBinding,
    ],
  }

  const { containerI, containerE } = makeContainers(document)
  const disposeI = mount(ir, containerI, document)
  const { mountFn } = emitMount(ir)
  const disposeE = mountFn(containerE, document)
  flushSync()

  assertEqual(containerI, containerE, 'initial')
  expect(containerI.querySelector('p')!.textContent).toBe('hello')

  label.set('world')
  flushSync()
  assertEqual(containerI, containerE, 'branch text updated')
  expect(containerE.querySelector('p')!.textContent).toBe('world')

  disposeI()
  disposeE()
})

// ── §6: Performance characterization (Child + Conditional) ───────────────────

test('§6: Perf characterization — Child + Conditional, emitted vs. interpreter', () => {
  const { document } = makeDom()
  const show = signal(true)
  const value = signal('hello')

  const childIR = makeChildIR(() => value())
  const condIR = makeConditionalIR(() => show(), '<span>yes</span>', '<span>no</span>')

  const ITERS = 2000

  const t0 = performance.now()
  for (let i = 0; i < ITERS; i++) {
    const d = mount(childIR, document.createElement('div'), document)
    flushSync()
    d()
  }
  const interpreterChildMs = performance.now() - t0

  const { mountFn: childMountFn } = emitMount(childIR)
  const t1 = performance.now()
  for (let i = 0; i < ITERS; i++) {
    const d = childMountFn(document.createElement('div'), document)
    flushSync()
    d()
  }
  const emitterChildMs = performance.now() - t1

  const t2 = performance.now()
  for (let i = 0; i < ITERS; i++) {
    const d = mount(condIR, document.createElement('div'), document)
    flushSync()
    d()
  }
  const interpreterCondMs = performance.now() - t2

  const { mountFn: condMountFn } = emitMount(condIR)
  const t3 = performance.now()
  for (let i = 0; i < ITERS; i++) {
    const d = condMountFn(document.createElement('div'), document)
    flushSync()
    d()
  }
  const emitterCondMs = performance.now() - t3

  const cI = document.createElement('div')
  const cE = document.createElement('div')
  const dI = mount(condIR, cI, document)
  const { mountFn: mF } = emitMount(condIR)
  const dE = mF(cE, document)
  flushSync()

  const FLIPS = 200
  const f0 = performance.now()
  for (let i = 0; i < FLIPS; i++) {
    show.set(i % 2 === 0)
    flushSync()
  }
  const interpreterFlipMs = performance.now() - f0

  const f1 = performance.now()
  for (let i = 0; i < FLIPS; i++) {
    show.set(i % 2 === 0)
    flushSync()
  }
  const emitterFlipMs = performance.now() - f1

  dI()
  dE()

  console.log(`\n  §6 Child/Conditional perf (${ITERS} mount iterations, ${FLIPS} flips):`)
  console.log(
    `     Child mount:   interpreter ${interpreterChildMs.toFixed(1)}ms  emitter ${emitterChildMs.toFixed(1)}ms  (${(interpreterChildMs / emitterChildMs).toFixed(2)}x)`,
  )
  console.log(
    `     Cond mount:    interpreter ${interpreterCondMs.toFixed(1)}ms  emitter ${emitterCondMs.toFixed(1)}ms  (${(interpreterCondMs / emitterCondMs).toFixed(2)}x)`,
  )
  console.log(
    `     Cond flip:     interpreter ${interpreterFlipMs.toFixed(1)}ms  emitter ${emitterFlipMs.toFixed(1)}ms  (${(interpreterFlipMs / emitterFlipMs).toFixed(2)}x)`,
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2: Equality Hook Emission (step-3 only, setCompilerSources shelved)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Gate 4a: Emission fidelity ────────────────────────────────────────────────

test('P2 GATE 4a: FALSE policy → setCompilerEquals(fn, false) called, equals = false', () => {
  const arr = signal<string[]>([])
  expect(__test.getEquals(arr)).toBe(Object.is)

  emitEqualityHook(arr, 'FALSE', __test.setCompilerEquals)

  expect(__test.getEquals(arr)).toBe(false)
})

test('P2 GATE 4a: OBJECT_IS policy → NO emission, equals stays Object.is', () => {
  const count = signal(0)
  emitEqualityHook(count, 'OBJECT_IS', __test.setCompilerEquals)
  expect(__test.getEquals(count)).toBe(Object.is)
})

test('P2 GATE 4a: DECLINE policy → NO emission, equals stays Object.is', () => {
  const obj = signal({ x: 1 })
  emitEqualityHook(obj, 'DECLINE', __test.setCompilerEquals)
  expect(__test.getEquals(obj)).toBe(Object.is)
})

test('P2 GATE 4a: explicit-user-equals site → FALSE emission blocked by runtime guard', () => {
  const customEq = (a: number[], b: number[]) => a.length === b.length
  const arr = signal<number[]>([], { equals: customEq as never })

  emitEqualityHook(arr, 'DECLINE', __test.setCompilerEquals)
  expect(__test.getEquals(arr)).toBe(customEq)

  // Belt-and-suspenders: even if FALSE were emitted, runtime guard should protect
  emitEqualityHook(arr, 'FALSE', __test.setCompilerEquals)
  expect(__test.getEquals(arr)).toBe(customEq)
})

test('P2 GATE 4a: batch emitEqualityHooks applies only FALSE sites', () => {
  const count = signal(0)
  const items = signal<string[]>([])
  const obj = signal({ name: 'x' })

  const sites = new Map<object, EqualityPolicy>([
    [count, 'OBJECT_IS'],
    [items, 'FALSE'],
    [obj, 'DECLINE'],
  ])

  emitEqualityHooks(sites, __test.setCompilerEquals)

  expect(__test.getEquals(count)).toBe(Object.is)
  expect(__test.getEquals(items)).toBe(false)
  expect(__test.getEquals(obj)).toBe(Object.is)
})

// ── Gate 4b: Behavioral differential — THE PAYOFF CASE ───────────────────────

test('P2 GATE 4b: mutable-container WITHOUT Phase 2 → arr.push + set(arr) suppressed by Object.is', () => {
  const { document, html } = makeDom()
  const items = signal<string[]>([])

  const ir = html`<span>${() => String(items().length)}</span>`
  const container = document.createElement('div')
  document.body.appendChild(container)
  const dispose = mount(ir, container, document)
  flushSync()

  expect(container.querySelector('span')!.textContent).toBe('0')

  items().push('x')
  items.set(items())
  flushSync()

  expect(container.querySelector('span')!.textContent).toBe('0')

  dispose()
})

test('P2 GATE 4b: mutable-container WITH Phase 2 → arr.push + set(arr) propagates correctly', () => {
  const { document, html } = makeDom()
  const items = signal<string[]>([])

  emitEqualityHook(items, 'FALSE', __test.setCompilerEquals)
  expect(__test.getEquals(items)).toBe(false)

  const ir = html`<span>${() => String(items().length)}</span>`
  const container = document.createElement('div')
  document.body.appendChild(container)
  const dispose = mount(ir, container, document)
  flushSync()

  expect(container.querySelector('span')!.textContent).toBe('0')

  items().push('x')
  items.set(items())
  flushSync()

  expect(container.querySelector('span')!.textContent).toBe('1')

  items().push('y')
  items.set(items())
  flushSync()
  expect(container.querySelector('span')!.textContent).toBe('2')

  dispose()
})

test('P2 GATE 4b: emitted back-end + Phase 2 → same behavioral fix', () => {
  const { document, html } = makeDom()
  const items = signal<string[]>([])
  emitEqualityHook(items, 'FALSE', __test.setCompilerEquals)

  const ir = html`<span>${() => String(items().length)}</span>`
  const { mountFn } = emitMount(ir)

  const container = document.createElement('div')
  document.body.appendChild(container)
  const dispose = mountFn(container, document)
  flushSync()

  items().push('a')
  items.set(items())
  flushSync()
  expect(container.querySelector('span')!.textContent).toBe('1')

  dispose()
})

test('P2 GATE 4b: primitive signal with Phase 2 SKIPPED → identical behavior (OBJECT_IS is a no-op)', () => {
  const { document, html } = makeDom()
  const count = signal(0)
  emitEqualityHook(count, 'OBJECT_IS', __test.setCompilerEquals)
  expect(__test.getEquals(count)).toBe(Object.is)

  const ir = html`<span>${() => String(count())}</span>`
  const { mountFn } = emitMount(ir)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const dispose = mountFn(container, document)
  flushSync()

  count.set(42)
  flushSync()
  expect(container.querySelector('span')!.textContent).toBe('42')

  dispose()
})

// ── HC-perturbation characterization ─────────────────────────────────────────

test('P2 §5: Hidden-class characterization — emission overhead (logged, not a gate)', () => {
  const N = 10_000

  const t0 = performance.now()
  for (let i = 0; i < N; i++) {
    signal<string[]>([])
  }
  const withoutMs = performance.now() - t0

  const t1 = performance.now()
  for (let i = 0; i < N; i++) {
    const s = signal<string[]>([])
    emitEqualityHook(s, 'FALSE', __test.setCompilerEquals)
  }
  const withMs = performance.now() - t1

  const overheadPct = (((withMs - withoutMs) / withoutMs) * 100).toFixed(1)
  console.log(`\n  P2 §5 HC perturbation characterization (${N} signals):`)
  console.log(`     Without emission:  ${withoutMs.toFixed(2)}ms`)
  console.log(`     With emission:     ${withMs.toFixed(2)}ms`)
  console.log(
    `     Overhead:          ${overheadPct}%  (expected: minimal; only FALSE sites are written)`,
  )
  // No hard assertion — characterization only (test environment timing is noisy).
})
