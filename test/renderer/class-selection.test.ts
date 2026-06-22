/**
 * class-selection gate tests
 * Gates G0-G7: TC-CL-01..08, TC-CL-G2/G3/G4/G5/G7, TC-CL-G4-string
 * Stream: (3) renderer/templating
 */
import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { emitMount } from '../../src/compiler/emitted-mount.js'
import { flushSync, signal } from '../../src/core/core.js'
import { classes, createHtmlTag } from '../../src/renderer/html-tag.js'
import type { ClassesSentinel } from '../../src/renderer/html-tag.js'
import { mount } from '../../src/renderer/interpreter.js'
import type { AttrBinding, ClassListBinding, TemplateIR } from '../../src/renderer/ir.js'
import { parseNvFile } from '../../src/renderer/nv-parser.js'
import { irStructurallyEqual } from './ir-equivalence.js'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document
const html = createHtmlTag(document)

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkParent(): Element {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}
function rmParent(el: Element) {
  document.body.removeChild(el)
}

type MountFn = (ir: TemplateIR, parent: Element, doc: Document) => () => void

const backends: Array<[string, MountFn]> = [
  ['interpreter', (ir, parent, doc) => mount(ir, parent, doc)],
  [
    'emitted-mount',
    (ir, parent, doc) => {
      const { mountFn } = emitMount(ir)
      return mountFn(parent, doc)
    },
  ],
]

function withBothBackends(ir: TemplateIR, assert: (parent: Element, dispose: () => void) => void) {
  for (const [label, mountFn] of backends) {
    void label
    const parent = mkParent()
    const dispose = mountFn(ir, parent, document)
    flushSync()
    try {
      assert(parent, dispose)
    } finally {
      dispose()
      rmParent(parent)
    }
  }
}

// ── TC-CL-01: classes() produces ClassListBinding ────────────────────────────

test('TC-CL-01  classes() produces IR with kind=classlist', () => {
  const ir = html`<div class="${classes({ active: () => true })}"></div>`
  expect(ir.bindings.length).toBe(1)
  expect(ir.bindings[0]!.kind).toBe('classlist')
})

// ── TC-CL-02: initial render, object form (BOTH back-ends) ───────────────────

test('TC-CL-02  initial render: active=true, disabled=false', () => {
  const ir = html`<div class="${classes({ active: () => true, disabled: () => false })}"></div>`
  withBothBackends(ir, (parent) => {
    const div = parent.querySelector('div')!
    expect(div.classList.contains('active')).toBe(true)
    expect(div.classList.contains('disabled')).toBe(false)
  })
})

// ── TC-CL-03: reactivity — toggle a key (BOTH back-ends) ─────────────────────

test('TC-CL-03  reactivity: toggle active via signal', () => {
  const active = signal(false)
  const ir = html`<div class="${classes({ active: () => active() })}"></div>`
  withBothBackends(ir, (parent) => {
    const div = parent.querySelector('div')!
    // Initial: false → class absent
    expect(div.classList.contains('active')).toBe(false)
    // Set true
    active.set(true)
    flushSync()
    expect(div.classList.contains('active')).toBe(true)
    // Set false again
    active.set(false)
    flushSync()
    expect(div.classList.contains('active')).toBe(false)
  })
})

// ── TC-CL-04: per-key isolation (G1) — BOTH back-ends ────────────────────────

test('TC-CL-04  G1 per-key isolation: toggling active does not re-run big thunk', () => {
  for (const [label, mountFn] of backends) {
    void label
    const active = signal(false)
    const big = signal(false)
    let bigCallCount = 0
    const ir = html`<div class="${classes({
      active: () => active(),
      big: () => {
        bigCallCount++
        return big()
      },
    })}"></div>`
    const parent = mkParent()
    const dispose = mountFn(ir, parent, document)
    flushSync()
    // Record big's call count after initial flush
    const countAfterMount = bigCallCount
    // Toggle only active
    active.set(true)
    flushSync()
    // big thunk must not have been called again
    expect(bigCallCount).toBe(countAfterMount)
    // active must be present
    expect(parent.querySelector('div')!.classList.contains('active')).toBe(true)
    // big must still be absent
    expect(parent.querySelector('div')!.classList.contains('big')).toBe(false)
    dispose()
    rmParent(parent)
  }
})

// ── TC-CL-05: static token (BOTH back-ends) ───────────────────────────────────

test('TC-CL-05  static token: btn always present at mount', () => {
  const ir = html`<div class="${classes('btn', { active: () => true })}"></div>`
  withBothBackends(ir, (parent) => {
    const div = parent.querySelector('div')!
    expect(div.classList.contains('btn')).toBe(true)
  })
})

// ── TC-CL-06: array form (BOTH back-ends) ─────────────────────────────────────

test('TC-CL-06  array form: btn static + active reactive', () => {
  for (const [label, mountFn] of backends) {
    void label
    // Fresh signal per backend run to avoid cross-run contamination
    const active = signal(false)
    const ir = html`<div class="${classes(['btn', { active: () => active() }])}"></div>`
    const parent = mkParent()
    const dispose = mountFn(ir, parent, document)
    flushSync()
    try {
      const div = parent.querySelector('div')!
      expect(div.classList.contains('btn')).toBe(true)
      expect(div.classList.contains('active')).toBe(false)
      active.set(true)
      flushSync()
      expect(div.classList.contains('active')).toBe(true)
    } finally {
      dispose()
      rmParent(parent)
    }
  }
})

// ── TC-CL-07: multi-token key ─────────────────────────────────────────────────

test('TC-CL-07  multi-token key: "btn btn-primary" → both present', () => {
  const ir = html`<div class="${classes({ 'btn btn-primary': () => true })}"></div>`
  withBothBackends(ir, (parent) => {
    const div = parent.querySelector('div')!
    expect(div.classList.contains('btn')).toBe(true)
    expect(div.classList.contains('btn-primary')).toBe(true)
  })
})

// ── TC-CL-08: .nv parse path produces ClassListBinding ───────────────────────

test('TC-CL-08  .nv parse: class="${{ active: isActive() }}" → classlist binding', () => {
  const source =
    'const Comp = $component(() => {\n' +
    '  $script(() => {\n' +
    '    const isActive = signal(true)\n' +
    '  })\n' +
    '  $render(() => html`<div class="${{ active: isActive() }}"></div>`)\n' +
    '})\n'
  const results = parseNvFile(source, 'cls.nv', document)
  expect(results.length).toBe(1)
  const ir = results[0]!.ir
  expect(ir.bindings.some((b) => b.kind === 'classlist')).toBe(true)
})

// ── TC-CL-G2: FE-equivalence (THE gate) ──────────────────────────────────────

test('TC-CL-G2  FE-equivalence: tagged-template classes() and .nv class="${{...}}" produce irStructurallyEqual IR', () => {
  // Tagged-template version
  const ttIr = html`<div class="${classes({ active: () => true })}"></div>`

  // .nv version
  const source =
    'const Comp = $component(() => {\n' +
    '  $script(() => {\n' +
    '    const isActive = signal(true)\n' +
    '  })\n' +
    '  $render(() => html`<div class="${{ active: isActive() }}"></div>`)\n' +
    '})\n'
  const results = parseNvFile(source, 'cls.nv', document)
  const nvIr = results[0]!.ir

  const result = irStructurallyEqual(document, ttIr, nvIr)
  expect(result.equal, result.reason).toBe(true)
})

// ── TC-CL-G3: differential parity (interpreter vs emitMount) ─────────────────

test('TC-CL-G3  differential parity: object form — both back-ends same DOM at mount + after toggle', () => {
  for (const form of ['object', 'array'] as const) {
    const sig = signal(false)
    const ir =
      form === 'object'
        ? html`<div class="${classes({ active: () => sig() })}"></div>`
        : html`<div class="${classes(['btn', { active: () => sig() }])}"></div>`

    // Mount both back-ends
    const p1 = mkParent()
    const d1 = mount(ir, p1, document)
    flushSync()

    const { mountFn } = emitMount(ir)
    const p2 = mkParent()
    const d2 = mountFn(p2, document)
    flushSync()

    try {
      // At mount
      expect(p1.querySelector('div')!.className).toBe(p2.querySelector('div')!.className)

      // After toggle
      sig.set(true)
      flushSync()
      expect(p1.querySelector('div')!.classList.contains('active')).toBe(true)
      expect(p2.querySelector('div')!.classList.contains('active')).toBe(true)
      expect(p1.querySelector('div')!.className).toBe(p2.querySelector('div')!.className)
    } finally {
      d1()
      d2()
      rmParent(p1)
      rmParent(p2)
    }
  }
})

// ── TC-CL-G4: G4 fail-shows-teeth — snapshot sentinel freezes DOM ─────────────

test('TC-CL-G4  fail-shows-teeth: snapshot sentinel freezes DOM (confirms TC-CL-03 has teeth)', () => {
  const active = signal(false)

  // Snapshot the boolean at construction time — NOT reactive
  const snapshotSentinel: ClassesSentinel = {
    __nvClasses: true,
    entries: [{ kind: 'toggle', key: 'active', expr: () => false }], // always false
  }

  // Manually build IR using the snapshot sentinel
  // We need the shape HTML and path — use the html tag to get the shape structure,
  // then swap out the binding's expr with our snapshot.
  const templateIr = html`<div class="${classes({ active: () => active() })}"></div>`
  const originalBinding = templateIr.bindings[0] as ClassListBinding
  const snapshotIr: TemplateIR = {
    id: 'snapshot-sentinel-test',
    shape: templateIr.shape,
    bindings: [
      {
        kind: 'classlist',
        pathIndex: originalBinding.pathIndex,
        entries: snapshotSentinel.entries,
      } satisfies ClassListBinding,
    ],
  }

  const parent = mkParent()
  const dispose = mount(snapshotIr, parent, document)
  flushSync()

  // Initially absent (snapshot always returns false)
  expect(parent.querySelector('div')!.classList.contains('active')).toBe(false)

  // Change the signal — snapshot won't respond
  active.set(true)
  flushSync()

  // DOM does NOT update — proves TC-CL-03 is non-trivial (reactive thunk IS needed)
  expect(parent.querySelector('div')!.classList.contains('active')).toBe(false)

  dispose()
  rmParent(parent)
})

// ── TC-CL-G5: G5 fail-shows-teeth — wrong-key binding goes red ───────────────

test('TC-CL-G5  fail-shows-teeth: wrong-key binding — active entry calls big thunk', () => {
  const active = signal(false)
  const big = signal(false)

  // Normal IR for shape/path
  const templateIr = html`<div class="${classes({ active: () => active(), big: () => big() })}"></div>`
  const originalBinding = templateIr.bindings[0] as ClassListBinding

  // Deliberately swap: active entry uses big's thunk
  const wrongKeyIr: TemplateIR = {
    id: 'wrong-key-test',
    shape: templateIr.shape,
    bindings: [
      {
        kind: 'classlist',
        pathIndex: originalBinding.pathIndex,
        entries: [
          { kind: 'toggle', key: 'active', expr: () => big() }, // wrong! uses big's signal
          { kind: 'toggle', key: 'big', expr: () => active() }, // wrong! uses active's signal
        ],
      } satisfies ClassListBinding,
    ],
  }

  const parent = mkParent()
  const dispose = mount(wrongKeyIr, parent, document)
  flushSync()

  // Initially both false, so nothing visible
  expect(parent.querySelector('div')!.classList.contains('active')).toBe(false)
  expect(parent.querySelector('div')!.classList.contains('big')).toBe(false)

  // Toggle big → wrong binding means 'active' (not big) gets toggled
  big.set(true)
  flushSync()
  // With wrong-key wiring: active class toggles when big signal changes (wrong behavior)
  expect(parent.querySelector('div')!.classList.contains('active')).toBe(true)
  // big class does NOT toggle (it's wired to active signal which is still false)
  expect(parent.querySelector('div')!.classList.contains('big')).toBe(false)

  dispose()
  rmParent(parent)
})

// ── TC-CL-G7: width-threshold fallback: >6 keys still works ──────────────────

test('TC-CL-G7  looping path (>6 keys): all truthy present, falsy absent; flip works', () => {
  for (const [label, mountFn] of backends) {
    void label
    // Fresh signal per backend run
    const g = signal(false)
    const ir = html`<div class="${classes({
      a: () => true,
      b: () => true,
      c: () => true,
      d: () => true,
      e: () => true,
      f: () => true,
      g: () => g(),
    })}"></div>`
    const parent = mkParent()
    const dispose = mountFn(ir, parent, document)
    flushSync()
    try {
      const div = parent.querySelector('div')!
      for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
        expect(div.classList.contains(key), `${key} should be present`).toBe(true)
      }
      expect(div.classList.contains('g')).toBe(false)

      g.set(true)
      flushSync()
      expect(div.classList.contains('g')).toBe(true)
    } finally {
      dispose()
      rmParent(parent)
    }
  }
})

// ── TC-CL-G4-string: string-form class produces AttrBinding (not classlist) ───

test('TC-CL-G4-string  string-form class="..." stays AttrBinding, not classlist', () => {
  const cls = signal('btn')
  const ir = html`<div class="${() => cls()}"></div>`

  // Shape check: AttrBinding, not ClassListBinding
  expect(ir.bindings.length).toBe(1)
  expect(ir.bindings[0]!.kind).toBe('attr')
  expect((ir.bindings[0] as AttrBinding).name).toBe('class')

  // Behavioral check: whole attribute is overwritten on change
  withBothBackends(ir, (parent) => {
    const div = parent.querySelector('div')!
    expect(div.getAttribute('class')).toBe('btn')

    cls.set('btn active')
    flushSync()
    // Whole attribute reassigned — not per-key toggle
    expect(div.getAttribute('class')).toBe('btn active')
    expect(div.classList.contains('btn')).toBe(true)
    expect(div.classList.contains('active')).toBe(true)

    // Remove active: whole attribute overwritten again
    cls.set('btn')
    flushSync()
    expect(div.getAttribute('class')).toBe('btn')
    expect(div.classList.contains('active')).toBe(false)
  })
})
