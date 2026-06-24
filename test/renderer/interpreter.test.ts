/**
 * nv Renderer — Interpreter Differential Conformance Suite
 * Stream: (3) Renderer/templating
 * IR contract: nv-template-ir.md v0.2, §8 (Differential Conformance Suite)
 *
 * Covers TC-01 through TC-02 (PoC slice: TextBinding + AttrBinding) plus
 * TC-07 (disposal / no-leak) and TC-09 (ChildBinding non-primitive rejection).
 *
 * Suite design (§8.3): for each test, the interpreter output is compared
 * against a hand-specified expected DOM tree using the structural comparator
 * (not outerHTML). The compiler back-end is deferred; when it is built, it
 * slots in as the second comparand and the same structural comparator is used.
 *
 * Two-back-end note: currently one back-end (interpreter). The test harness is
 * structured so the compiler back-end plugs in later without changing the
 * assertions.
 *
 * Owner-tree wiring: effects are owned by the mount region's root (createRoot).
 * After dispose(), signal observerCounts return to 0 (no leaks).
 * We verify this using __test.observerCount() from the runtime's test surface.
 */

import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { emitMount } from '../../src/compiler/emitted-mount.js'
import {
  __test,
  createRoot as coreCreateRoot,
  derived,
  errorBoundary,
  flushSync,
  signal,
} from '../../src/core/core.js'
import { structurallyEqual } from '../../src/renderer/comparator.js'
import { createHtmlTag } from '../../src/renderer/html-tag.js'
import { mount } from '../../src/renderer/interpreter.js'
import type {
  ChildBinding,
  ComponentBinding,
  ConditionalBinding,
  EventBinding,
  ListBinding,
  PropBinding,
  SyncBinding,
  TemplateIR,
  TextBinding,
  WritableSignal,
} from '../../src/renderer/ir.js'

// ── jsdom setup ───────────────────────────────────────────────────────────────

// All tests share one jsdom instance. Each test creates its own parent element
// and appends it to document.body to give effects a live DOM to write into.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document
const html = createHtmlTag(document)

/** Build an expected DOM from an HTML string for structural comparison. */
function expected(htmlStr: string): Element {
  const div = document.createElement('div')
  div.innerHTML = htmlStr
  return div
}

/** Create a fresh parent div attached to body (for clean per-test isolation). */
function mkParent(): Element {
  const div = document.createElement('div')
  document.body.appendChild(div)
  return div
}

/** Cleanup: remove a parent from the DOM after a test. */
function rmParent(el: Element): void {
  el.remove()
}

// ── TC-01: TextBinding ─────────────────────────────────────────────────────────

test('TC-01a  initial DOM after mount + flush', () => {
  const count = signal(0)
  const ir = html`<span>${() => count()}</span>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  const result = structurallyEqual(parent, expected('<span>0</span>'))
  expect(result.equal, `Structural mismatch: ${result.diffPath}`).toBe(true)

  dispose()
  rmParent(parent)
})

test('TC-01b  reactive update: signal write → text changes', () => {
  const count = signal(0)
  const ir = html`<span>${() => count()}</span>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  count.set(42)
  flushSync()

  const result = structurallyEqual(parent, expected('<span>42</span>'))
  expect(result.equal, `Structural mismatch: ${result.diffPath}`).toBe(true)

  dispose()
  rmParent(parent)
})

test('TC-01c  multiple updates: each change reflected', () => {
  const val = signal('hello')
  const ir = html`<p>${() => val()}</p>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  val.set('world')
  flushSync()
  expect(structurallyEqual(parent, expected('<p>world</p>')).equal, 'world update').toBe(true)

  // TextBinding always maintains a Text node at the binding position. When the value
  // becomes empty, the text node persists with data=''. The expected DOM must include
  // an empty text node to match — innerHTML='<p></p>' produces 0 children (no text
  // node), which would be structurally different from the interpreter's 1-child state.
  val.set('')
  flushSync()
  const emptyP = document.createElement('div')
  const pEl = document.createElement('p')
  pEl.appendChild(document.createTextNode(''))
  emptyP.appendChild(pEl)
  expect(structurallyEqual(parent, emptyP).equal, 'empty-string update').toBe(true)

  dispose()
  rmParent(parent)
})

test('TC-01d  null/undefined renders as empty string', () => {
  const val = signal<string | null | undefined>('text')
  const ir = html`<span>${() => val()}</span>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  // See TC-01c: empty text node must be represented explicitly in expected DOM.
  const emptySpan = (): Element => {
    const wrapper = document.createElement('div')
    const span = document.createElement('span')
    span.appendChild(document.createTextNode(''))
    wrapper.appendChild(span)
    return wrapper
  }

  val.set(null)
  flushSync()
  expect(structurallyEqual(parent, emptySpan()).equal, 'null → empty text').toBe(true)

  val.set(undefined)
  flushSync()
  expect(structurallyEqual(parent, emptySpan()).equal, 'undefined → empty text').toBe(true)

  dispose()
  rmParent(parent)
})

// ── TC-02: AttrBinding ─────────────────────────────────────────────────────────

test('TC-02a  initial attribute value after mount + flush', () => {
  const cls = signal('active')
  const ir = html`<div class="${() => cls()}">content</div>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  const result = structurallyEqual(parent, expected('<div class="active">content</div>'))
  expect(result.equal, `Structural mismatch: ${result.diffPath}`).toBe(true)

  dispose()
  rmParent(parent)
})

test('TC-02b  reactive attribute update', () => {
  const cls = signal('inactive')
  const ir = html`<button class="${() => cls()}">click</button>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  cls.set('active')
  flushSync()

  const result = structurallyEqual(parent, expected('<button class="active">click</button>'))
  expect(result.equal, `Structural mismatch: ${result.diffPath}`).toBe(true)

  dispose()
  rmParent(parent)
})

test('TC-02c  false/null removes the attribute', () => {
  const disabled = signal<boolean | null>(false)
  const ir = html`<button disabled="${() => disabled()}">btn</button>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()
  // false → removeAttribute
  const elAfterFalse = parent.querySelector('button') as HTMLButtonElement
  expect(elAfterFalse.hasAttribute('disabled'), 'disabled should be absent for false').toBe(false)

  disabled.set(true)
  flushSync()
  // true → setAttribute with empty value
  const elAfterTrue = parent.querySelector('button') as HTMLButtonElement
  expect(elAfterTrue.hasAttribute('disabled'), 'disabled should be present for true').toBe(true)
  expect(elAfterTrue.getAttribute('disabled'), 'disabled should be present for true').toBe('')

  disabled.set(null)
  flushSync()
  const elAfterNull = parent.querySelector('button') as HTMLButtonElement
  expect(elAfterNull.hasAttribute('disabled'), 'disabled should be absent for null').toBe(false)

  dispose()
  rmParent(parent)
})

test('TC-02d  TextBinding + AttrBinding in one template', () => {
  const cls = signal('foo')
  const label = signal('hello')
  const ir = html`<div class="${() => cls()}">${() => label()}</div>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  expect(
    structurallyEqual(parent, expected('<div class="foo">hello</div>')).equal,
    'initial state',
  ).toBe(true)

  cls.set('bar')
  label.set('world')
  flushSync()

  expect(
    structurallyEqual(parent, expected('<div class="bar">world</div>')).equal,
    'after update',
  ).toBe(true)

  dispose()
  rmParent(parent)
})

// ── TC-07: Disposal / No-Leak ──────────────────────────────────────────────────

test('TC-07a  dispose removes DOM from parent', () => {
  const val = signal('before')
  const ir = html`<span>${() => val()}</span>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()
  expect(parent.children.length, 'one child before dispose').toBe(1)

  dispose()

  expect(parent.children.length, 'no children after dispose').toBe(0)
  rmParent(parent)
})

test('TC-07b  after dispose, signal writes do not update DOM', () => {
  const val = signal('before')
  const ir = html`<span>${() => val()}</span>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  dispose()
  val.set('after')
  flushSync()

  // Parent is empty; no span to update
  expect(parent.children.length).toBe(0)
  rmParent(parent)
})

test('TC-07c  no-leak: TextBinding signal has 0 observers after dispose', () => {
  const val = signal('hello')
  const ir = html`<span>${() => val()}</span>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  // Before dispose: val has at least 1 observer (the text effect)
  expect(__test.observerCount(val) >= 1, 'effect should be observing val before dispose').toBe(true)

  dispose()

  // After dispose: all observer edges removed
  expect(__test.observerCount(val), 'no observers after dispose (no leak)').toBe(0)
  rmParent(parent)
})

test('TC-07d  no-leak: AttrBinding signal has 0 observers after dispose', () => {
  const cls = signal('active')
  const ir = html`<div class="${() => cls()}">x</div>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  expect(__test.observerCount(cls) >= 1, 'cls observed before dispose').toBe(true)

  dispose()

  expect(__test.observerCount(cls), 'cls not observed after dispose (no leak)').toBe(0)
  rmParent(parent)
})

test('TC-07e  no-leak: multiple bindings, all signals clean after dispose', () => {
  const cls = signal('x')
  const text = signal('y')
  const ir = html`<span class="${() => cls()}">${() => text()}</span>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  dispose()

  expect(__test.observerCount(cls), 'cls clean').toBe(0)
  expect(__test.observerCount(text), 'text clean').toBe(0)
  rmParent(parent)
})

test('TC-07f  dispose is idempotent (second call is a no-op)', () => {
  const val = signal('v')
  const ir = html`<span>${() => val()}</span>`
  const parent = mkParent()

  const dispose = mount(ir, parent, document)
  flushSync()

  dispose()
  // Second call must not throw
  expect(() => dispose()).not.toThrow()

  rmParent(parent)
})

// ── TC-09: ChildBinding non-primitive rejection ────────────────────────────────

test('TC-09a  ChildBinding with DOM Node value throws at runtime', () => {
  // Manually construct a TemplateIR with a ChildBinding (kind: 'child').
  // The html tag classifies text holes as TextBinding, not ChildBinding.
  // TC-09 exercises the ChildBinding code path directly via a hand-built IR.
  const doc = document
  const anchorComment = '<!--nv-0-->'
  const shapeHtml = `<div>${anchorComment}</div>`

  const nodeValueExpr = () => doc.createElement('span') as unknown as string // DOM node, not primitive

  const ir: TemplateIR = {
    id: 'tc09-test',
    shape: {
      html: shapeHtml,
      bindingPaths: [[0, 0]], // path to first child of div (the comment)
    },
    bindings: [
      {
        kind: 'child',
        pathIndex: 0,
        expr: nodeValueExpr,
      } satisfies ChildBinding,
    ],
  }

  const parent = mkParent()
  const dispose = mount(ir, parent, doc)

  // The error fires inside the effect when it runs. We must flush to trigger it.
  // Because the error is in an effect (not a derived), it routes to the error
  // boundary / console.error rather than throwing synchronously out of flushSync.
  // We verify it via the effect not updating the DOM (error state, not a value).
  // The specific error message is tested by checking the effect doesn't silently succeed.
  //
  // Interpreter v0 behavior: the error is routed via §5.4.4 (no errorBoundary registered
  // → global handler → console.error). The ChildBinding effect enters Error state.
  // The text node remains empty (no valid update occurred).

  // Capture console.error to verify the right error was emitted
  const errors: string[] = []
  const origConsoleError = console.error
  console.error = (...args: unknown[]) => {
    errors.push(String(args[0]))
  }

  try {
    flushSync()
  } finally {
    console.error = origConsoleError
  }

  // Verify the error was routed (not silently swallowed)
  const nvError = errors.find(
    (e) => e.includes('[nv]') || e.includes('ChildBinding') || e.includes('non-primitive'),
  )
  expect(
    nvError !== undefined,
    `Expected a [nv] ChildBinding error to be routed. Captured errors: ${JSON.stringify(errors)}`,
  ).toBe(true)

  dispose()
  rmParent(parent)
})

test('TC-09b  ChildBinding with primitive value works correctly (PoC supported path)', () => {
  // Confirm the primitive path IS supported, so TC-09a is a real rejection, not
  // a general ChildBinding failure.
  const val = signal<string | null>('hello')

  const shapeHtml = '<div><!--nv-0--></div>'
  const primitiveExpr = () => val()

  const ir: TemplateIR = {
    id: 'tc09b-test',
    shape: {
      html: shapeHtml,
      bindingPaths: [[0, 0]],
    },
    bindings: [
      {
        kind: 'child',
        pathIndex: 0,
        expr: primitiveExpr,
      } satisfies ChildBinding,
    ],
  }

  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  // The comment is replaced with a Text node + anchor comment in ChildBinding.
  // div should have a text node "hello" + the original comment (anchor).
  const div = parent.firstChild as Element
  expect(div !== null, 'div present').toBe(true)

  // Find the text node in the div
  let textContent = ''
  for (let i = 0; i < div.childNodes.length; i++) {
    const n = div.childNodes[i]!
    if (n.nodeType === 3 /* TEXT_NODE */) textContent += (n as Text).data
  }
  expect(textContent).toBe('hello')

  val.set('world')
  flushSync()

  let updated = ''
  for (let i = 0; i < div.childNodes.length; i++) {
    const n = div.childNodes[i]!
    if (n.nodeType === 3 /* TEXT_NODE */) updated += (n as Text).data
  }
  expect(updated).toBe('world')

  dispose()
  expect(__test.observerCount(val), 'no leak after dispose').toBe(0)
  rmParent(parent)
})

// ── TC-03: PropBinding ─────────────────────────────────────────────────────────
//
// PropBinding writes DOM properties directly (el.propName = value) rather than
// HTML attributes. Tests construct IRs manually — the tagged-template front-end
// classifies all holes as text or attr; PropBinding/EventBinding/ChildBinding/
// ConditionalBinding require either the .nv file front-end or manual IR construction.

test('TC-03a  initial DOM property set after mount + flush', () => {
  const val = signal('hello')
  const ir: TemplateIR = {
    id: 'prop-03a',
    shape: { html: '<input>', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'prop',
        pathIndex: 0,
        name: 'value',
        expr: () => val(),
      } satisfies PropBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const input = parent.querySelector('input') as HTMLInputElement
  expect(input.value).toBe('hello')

  dispose()
  rmParent(parent)
})

test('TC-03b  reactive property update on signal write', () => {
  const val = signal('initial')
  const ir: TemplateIR = {
    id: 'prop-03b',
    shape: { html: '<input>', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'prop',
        pathIndex: 0,
        name: 'value',
        expr: () => val(),
      } satisfies PropBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  val.set('updated')
  flushSync()

  const input = parent.querySelector('input') as HTMLInputElement
  expect(input.value).toBe('updated')

  dispose()
  rmParent(parent)
})

test('TC-03c  PropBinding: no leak after dispose', () => {
  const checked = signal(false)
  const ir: TemplateIR = {
    id: 'prop-03c',
    shape: { html: '<input type="checkbox">', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'prop',
        pathIndex: 0,
        name: 'checked',
        expr: () => checked(),
      } satisfies PropBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  expect(__test.observerCount(checked) >= 1, 'observed before dispose').toBe(true)
  dispose()
  expect(__test.observerCount(checked), 'no leak after dispose').toBe(0)
  rmParent(parent)
})

// ── TC-04: EventBinding ────────────────────────────────────────────────────────
//
// EventBinding: single wrapper-listener + effect that tracks the handler expression.
// v0 always uses handlerKind: 'reactive' (no stable-handler optimisation in PoC).
//
// jsdom event-dispatch flag: jsdom's dispatchEvent is synchronous and fires
// the handler inline. Real browsers also fire synchronously for programmatic
// dispatchEvent calls. This is adequate for v0 ("does it fire, does disposal
// remove it, does re-run update the handler"). Edge cases that require real-
// browser validation: passive-listener semantics, capture-vs-bubble ordering
// across shadow DOM boundaries, trusted-event checks. Flag those as Claude Code.

test('TC-04a  handler fires on dispatchEvent', () => {
  let callCount = 0
  const handler = (_e: Event): void => {
    callCount++
  }

  const ir: TemplateIR = {
    id: 'event-04a',
    shape: { html: '<button>click</button>', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'event',
        pathIndex: 0,
        eventName: 'click',
        handler: () => handler,
        handlerKind: 'reactive',
      } satisfies EventBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync() // effect runs, sets current = handler

  const btn = parent.querySelector('button') as HTMLButtonElement
  btn.dispatchEvent(new dom.window.Event('click'))
  expect(callCount, 'handler fired once').toBe(1)

  btn.dispatchEvent(new dom.window.Event('click'))
  expect(callCount, 'handler fired twice').toBe(2)

  dispose()
  rmParent(parent)
})

test('TC-04b  disposal removes listener — handler does not fire after dispose', () => {
  let callCount = 0
  const handler = (_e: Event): void => {
    callCount++
  }

  const ir: TemplateIR = {
    id: 'event-04b',
    shape: { html: '<button>click</button>', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'event',
        pathIndex: 0,
        eventName: 'click',
        handler: () => handler,
        handlerKind: 'reactive',
      } satisfies EventBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const btn = parent.querySelector('button') as HTMLButtonElement

  dispose()

  // After disposal the listener must be removed and the DOM node gone.
  // Dispatch to a detached node — no handler should fire.
  btn.dispatchEvent(new dom.window.Event('click'))
  expect(callCount, 'handler must not fire after dispose').toBe(0)

  rmParent(parent)
})

test('TC-04c  reactive handler: signal change updates which handler fires', () => {
  let countA = 0
  let countB = 0
  const handlerA = (_e: Event): void => {
    countA++
  }
  const handlerB = (_e: Event): void => {
    countB++
  }
  const useA = signal(true)

  const ir: TemplateIR = {
    id: 'event-04c',
    shape: { html: '<button>click</button>', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'event',
        pathIndex: 0,
        eventName: 'click',
        handler: () => (useA() ? handlerA : handlerB),
        handlerKind: 'reactive',
      } satisfies EventBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync() // effect runs: current = handlerA

  const btn = parent.querySelector('button') as HTMLButtonElement
  btn.dispatchEvent(new dom.window.Event('click'))
  expect(countA, 'handlerA fires initially').toBe(1)
  expect(countB).toBe(0)

  // Switch to handlerB — effect re-runs, current = handlerB
  useA.set(false)
  flushSync()

  btn.dispatchEvent(new dom.window.Event('click'))
  expect(countA, 'handlerA no longer fires').toBe(1)
  expect(countB, 'handlerB fires after switch').toBe(1)

  dispose()
  expect(__test.observerCount(useA), 'no leak after dispose').toBe(0)
  rmParent(parent)
})

// ── TC-05: ChildBinding ────────────────────────────────────────────────────────
//
// ChildBinding: an anchor comment node; a Text node is inserted before it and
// updated reactively. v0: primitive values only (string | number | null | undefined).
//
// Update semantics (ground-truth spec, decided deliberately):
//   UPDATE IN-PLACE — the Text node created at mount time persists for the
//   region's lifetime. Value changes write textNode.data, never replace the node.
//   Node identity is stable across updates. This matches TextBinding semantics
//   exactly (one update pattern for the compiler to match later).
//
//   Observable consequence: `parent.firstChild` refers to the same Text node
//   object before and after a value update. A replace-node strategy would create
//   a new Text node on each change — that is NOT the spec behavior.
//
// TC-09a/b already pin the non-primitive rejection path.

test('TC-05a  primitive value renders as text node before anchor', () => {
  const val = signal('hello')
  // ChildBinding shape: anchor comment inside a div.
  // Path [0, 0]: frag.childNodes[0] = div, div.childNodes[0] = comment.
  const ir: TemplateIR = {
    id: 'child-05a',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'child',
        pathIndex: 0,
        expr: () => val(),
      } satisfies ChildBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  // div should contain: [textNode:'hello', <!--nv-0-->]
  const div = parent.querySelector('div') as Element
  expect(div.childNodes.length, 'textNode + anchor').toBe(2)
  expect((div.childNodes[0]! as Text).data).toBe('hello')
  expect(div.childNodes[1]?.nodeType, 'anchor still present').toBe(8 /* COMMENT_NODE */)

  dispose()
  rmParent(parent)
})

test('TC-05b  update in-place: same Text node, different data', () => {
  // Verifies the in-place update spec: the Text node OBJECT is the same before
  // and after a signal write. Only textNode.data changes.
  const val = signal('first')
  const ir: TemplateIR = {
    id: 'child-05b',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'child',
        pathIndex: 0,
        expr: () => val(),
      } satisfies ChildBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element
  const textNodeBefore = div.childNodes[0] // capture reference before update
  expect((textNodeBefore as Text).data).toBe('first')

  val.set('second')
  flushSync()

  const textNodeAfter = div.childNodes[0]
  expect(textNodeAfter, 'same Text node object (in-place update)').toBe(textNodeBefore)
  expect((textNodeAfter as Text).data, 'data updated').toBe('second')

  dispose()
  rmParent(parent)
})

test('TC-05c  null / undefined render as empty string', () => {
  const val = signal<string | null | undefined>('text')
  const ir: TemplateIR = {
    id: 'child-05c',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'child',
        pathIndex: 0,
        expr: () => val(),
      } satisfies ChildBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element

  val.set(null)
  flushSync()
  expect((div.childNodes[0] as Text).data).toBe('')

  val.set(undefined)
  flushSync()
  expect((div.childNodes[0] as Text).data).toBe('')

  dispose()
  rmParent(parent)
})

test('TC-05d  ChildBinding: no leak after dispose', () => {
  const val = signal('hello')
  const ir: TemplateIR = {
    id: 'child-05d',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'child',
        pathIndex: 0,
        expr: () => val(),
      } satisfies ChildBinding,
    ],
  }
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  expect(__test.observerCount(val) >= 1, 'observed before dispose').toBe(true)
  dispose()
  expect(__test.observerCount(val), 'no leak after dispose').toBe(0)
  rmParent(parent)
})

// ── TC-06: ConditionalBinding ──────────────────────────────────────────────────
//
// ConditionalBinding: effect + createRoot per branch. The branch root is owned
// by the outer effect (via createRoot inside the effect body, which calls
// addChild(outerEffect, branchRoot)). On re-run, preRunCleanup disposes the old
// branch via the bridge onCleanup BEFORE the effect body executes, so
// branchDisposer is always null at the start of a re-run.
//
// The flip-many-times test (TC-06e/f) stress-tests the per-cycle mount/dispose
// that a single-flip test can't catch: a per-flip leak (dangling edge, extra DOM
// node) only surfaces under repetition. This is the runtime-fuzzer lesson applied
// to the renderer.

/** Helper: outer template with a single conditional anchor. */
function makeConditionalIR(
  condition: () => boolean,
  consequent: TemplateIR,
  alternate: TemplateIR | null = null,
): TemplateIR {
  return {
    id: `cond:${Date.now()}`,
    shape: {
      html: '<div><!--nv-0--></div>',
      // Path to the anchor comment: frag[0]=div, div[0]=comment
      bindingPaths: [[0, 0]],
    },
    bindings: [
      {
        kind: 'conditional',
        pathIndex: 0,
        condition,
        consequent,
        alternate,
      } satisfies ConditionalBinding,
    ],
  }
}

/** Static branch with no reactive bindings. */
function staticBranch(html: string): TemplateIR {
  return { id: `static:${html}`, shape: { html, bindingPaths: [] }, bindings: [] }
}

/** Reactive branch: a span whose text content tracks a signal. */
function reactiveTextBranch(expr: () => string | null | undefined): TemplateIR {
  return {
    id: 'reactive-text-branch',
    shape: { html: '<span><!--nv-0--></span>', bindingPaths: [[0, 0]] },
    bindings: [{ kind: 'text', pathIndex: 0, expr } satisfies TextBinding],
  }
}

test('TC-06a  condition=true: consequent mounted, alternate absent', () => {
  const show = signal(true)
  const ir = makeConditionalIR(
    () => show(),
    staticBranch('<span>A</span>'),
    staticBranch('<span>B</span>'),
  )
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element
  expect(div.querySelector('span') !== null, 'branch element present').toBe(true)
  expect((div.querySelector('span') as Element).textContent, 'consequent content').toBe('A')

  dispose()
  rmParent(parent)
})

test('TC-06b  condition=false: alternate mounted, consequent absent', () => {
  const show = signal(false)
  const ir = makeConditionalIR(
    () => show(),
    staticBranch('<span>A</span>'),
    staticBranch('<span>B</span>'),
  )
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element
  expect((div.querySelector('span') as Element).textContent, 'alternate content').toBe('B')

  dispose()
  rmParent(parent)
})

test('TC-06c  condition=false with null alternate: nothing mounted', () => {
  const show = signal(false)
  const ir = makeConditionalIR(
    () => show(),
    staticBranch('<span>A</span>'),
    null, // no alternate
  )
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element
  // div should have only the anchor comment (nodeType 8), no elements
  expect(div.children.length, 'no element children').toBe(0)
  expect(div.childNodes.length, 'anchor comment only').toBe(1)

  dispose()
  rmParent(parent)
})

test('TC-06d  flip once: old DOM gone, new DOM present', () => {
  const show = signal(true)
  const ir = makeConditionalIR(
    () => show(),
    staticBranch('<span>A</span>'),
    staticBranch('<span>B</span>'),
  )
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element
  expect((div.querySelector('span') as Element).textContent, 'initially A').toBe('A')

  show.set(false)
  flushSync()

  expect((div.querySelector('span') as Element).textContent, 'flipped to B').toBe('B')
  // No residue: div has exactly 2 childNodes (branch element + anchor)
  expect(div.childNodes.length, 'no accumulated nodes after flip').toBe(2)

  dispose()
  rmParent(parent)
})

test('TC-06e  flip N=20 times: no accumulated DOM, content matches final state', () => {
  const show = signal(true)
  const ir = makeConditionalIR(
    () => show(),
    staticBranch('<span class="A">A</span>'),
    staticBranch('<span class="B">B</span>'),
  )
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element
  const N = 20

  for (let i = 0; i < N; i++) {
    show.set(i % 2 !== 0)
    flushSync()
    // DOM must have exactly 2 children (one branch + anchor) after each flip
    expect(
      div.childNodes.length,
      `flip ${i}: expected 2 childNodes, got ${div.childNodes.length}`,
    ).toBe(2)
  }

  // After N=20 flips (i=0..19; last flip i=19 is odd → show.set(true) → A mounted)
  expect(div.querySelector('.A') !== null, 'final branch is A (show=true after even N)').toBe(true)
  expect(div.querySelector('.B') === null, 'B branch fully removed').toBe(true)

  dispose()
  rmParent(parent)
})

test('TC-06f  flip N=20: 0 observers on condition signal after dispose', () => {
  const show = signal(true)
  const ir = makeConditionalIR(
    () => show(),
    staticBranch('<span>A</span>'),
    staticBranch('<span>B</span>'),
  )
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  for (let i = 0; i < 20; i++) {
    show.set(i % 2 !== 0)
    flushSync()
  }

  expect(__test.observerCount(show) >= 1, 'condition observed before dispose').toBe(true)
  dispose()
  expect(__test.observerCount(show), 'no leak on condition signal after dispose').toBe(0)
  rmParent(parent)
})

test('TC-06g  adversarial: write to old branch signal after flip — DOM unchanged', () => {
  // Reactive consequent branch: its text effect tracks `innerText`.
  // After condition flips to false, the consequent branch is unmounted.
  // Writing to `innerText` must be a no-op (effect was severed).
  const show = signal(true)
  const innerText = signal('original')
  const ir = makeConditionalIR(
    () => show(),
    reactiveTextBranch(() => innerText()),
    staticBranch('<p>alternate</p>'),
  )
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element
  // Verify initial state: consequent branch is a span with 'original'
  expect(div.querySelector('span') !== null, 'span present initially').toBe(true)

  // Flip to alternate — consequent branch (+ its effect) must be fully disposed
  show.set(false)
  flushSync()

  expect(__test.observerCount(innerText), 'innerText has no observers after flip').toBe(0)
  expect(div.querySelector('span') === null, 'span removed after flip').toBe(true)
  expect(div.querySelector('p') !== null, 'alternate p present').toBe(true)

  // Adversarial write: must be a no-op
  innerText.set('mutated')
  flushSync()

  // DOM still shows alternate, no resurrected span
  expect(div.querySelector('span') === null, 'old branch does not resurrect on signal write').toBe(
    true,
  )
  expect((div.querySelector('p') as Element).textContent, 'alternate unchanged').toBe('alternate')

  dispose()
  expect(__test.observerCount(show), 'show signal clean after dispose').toBe(0)
  expect(__test.observerCount(innerText), 'innerText clean after dispose').toBe(0)
  rmParent(parent)
})

test('TC-06h  parent region dispose while branch mounted: full cleanup', () => {
  // Dispose the entire mount region while a conditional branch is active.
  // All reactive edges (condition signal, branch signal) must be severed.
  const show = signal(true)
  const branchText = signal('inside')
  const ir = makeConditionalIR(
    () => show(),
    reactiveTextBranch(() => branchText()),
    null,
  )
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  expect(__test.observerCount(show) >= 1, 'show observed').toBe(true)
  expect(__test.observerCount(branchText) >= 1, 'branchText observed').toBe(true)

  dispose()

  expect(__test.observerCount(show), 'show clean after dispose').toBe(0)
  expect(__test.observerCount(branchText), 'branchText clean after dispose').toBe(0)

  // DOM removed
  expect(parent.children.length, 'outer div removed').toBe(0)
  rmParent(parent)
})

// ── TC-10: ListBinding ─────────────────────────────────────────────────────────
//
// Spec §8: 8 test obligations.
// Pattern mirrors TC-06 (ConditionalBinding): build IR helpers, test both
// structural DOM correctness and no-leak invariants.
//
// Item structure used throughout: { id: number; label: string }

type Item = { id: number; label: string }

/** Outer template whose single binding is a ListBinding. */
function makeListIR(
  items: () => readonly Item[],
  makeItem: (vs: WritableSignal<unknown>, is: WritableSignal<number>) => TemplateIR,
): TemplateIR {
  return {
    id: 'list-test',
    shape: {
      // The anchor comment is at frag[0]=ul, ul[0]=comment
      html: '<ul><!--nv-0--></ul>',
      bindingPaths: [[0, 0]],
    },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: items as () => readonly unknown[],
        key: (item) => (item as Item).id,
        itemTemplate: makeItem,
      } satisfies ListBinding,
    ],
  }
}

/** Item template: <li> with text bound to valueSig().label */
function liTextTemplate(vs: WritableSignal<unknown>, _is: WritableSignal<number>): TemplateIR {
  return {
    id: 'li-text',
    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'text',
        pathIndex: 0,
        expr: () => (vs() as Item).label,
      } satisfies TextBinding,
    ],
  }
}

/** Item template: <li> with text bound to valueSig().label + " #" + indexSig() */
function liIndexTemplate(vs: WritableSignal<unknown>, is: WritableSignal<number>): TemplateIR {
  return {
    id: 'li-index',
    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'text',
        pathIndex: 0,
        expr: () => `${(vs() as Item).label}#${is()}`,
      } satisfies TextBinding,
    ],
  }
}

// §8 obligation 1: Initial render — N items, correct order + content
test('TC-10a  initial render: N items correct order and content', () => {
  const items = signal<Item[]>([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
    { id: 3, label: 'C' },
  ])
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const ul = parent.querySelector('ul')!
  const lis = ul.querySelectorAll('li')
  expect(lis.length, '3 items').toBe(3)
  expect(lis[0]!.textContent, 'first item').toBe('A')
  expect(lis[1]!.textContent, 'second item').toBe('B')
  expect(lis[2]!.textContent, 'third item').toBe('C')

  dispose()
  rmParent(parent)
})

// §8 obligation 2: Append / prepend / insert-middle — new roots, correct DOM position
test('TC-10b  append: new item added at end', () => {
  const items = signal<Item[]>([{ id: 1, label: 'A' }])
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  items.set([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
  ])
  flushSync()

  const lis = parent.querySelectorAll('li')
  expect(lis.length, '2 items after append').toBe(2)
  expect(lis[0]!.textContent, 'first still A').toBe('A')
  expect(lis[1]!.textContent, 'appended B').toBe('B')

  dispose()
  rmParent(parent)
})

test('TC-10c  prepend: new item added at beginning', () => {
  const items = signal<Item[]>([{ id: 2, label: 'B' }])
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  items.set([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
  ])
  flushSync()

  const lis = parent.querySelectorAll('li')
  expect(lis.length, '2 items after prepend').toBe(2)
  expect(lis[0]!.textContent, 'prepended A first').toBe('A')
  expect(lis[1]!.textContent, 'B still second').toBe('B')

  dispose()
  rmParent(parent)
})

test('TC-10d  insert-middle: item inserted between existing items', () => {
  const items = signal<Item[]>([
    { id: 1, label: 'A' },
    { id: 3, label: 'C' },
  ])
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  items.set([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
    { id: 3, label: 'C' },
  ])
  flushSync()

  const lis = parent.querySelectorAll('li')
  expect(lis.length, '3 items after insert').toBe(3)
  expect(lis[0]!.textContent).toBe('A')
  expect(lis[1]!.textContent).toBe('B')
  expect(lis[2]!.textContent).toBe('C')

  dispose()
  rmParent(parent)
})

// §8 obligation 3: Remove — root disposed, DOM gone, no-leak
test('TC-10e  remove: item DOM removed, reactive edges severed', () => {
  const items = signal<Item[]>([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
  ])
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()

  // Track a signal that the removed item reads, to verify observer is severed.
  const labelSig = signal('B-dynamic')
  let removedVsSig: WritableSignal<unknown> | null = null

  const irWithSpy = makeListIR(
    () => items(),
    (vs, is) => {
      if ((vs() as Item).id === 2) removedVsSig = vs
      return liTextTemplate(vs, is)
    },
  )

  const dispose = mount(irWithSpy, parent, document)
  flushSync()

  expect(parent.querySelectorAll('li').length, '2 items before remove').toBe(2)

  // Remove item id=2
  items.set([{ id: 1, label: 'A' }])
  flushSync()

  const lis = parent.querySelectorAll('li')
  expect(lis.length, '1 item after remove').toBe(1)
  expect(lis[0]!.textContent, 'remaining item').toBe('A')

  // The removed item's valueSig should have 0 observers (root disposed, edges severed)
  if (removedVsSig !== null) {
    expect(__test.observerCount(removedVsSig), 'removed item signal has 0 observers').toBe(0)
  }

  dispose()
  rmParent(parent)
})

// §8 obligation 4: Value change at kept key — item DOM updates, root PERSISTS
test('TC-10f  value change at kept key: DOM updates, item DOM node identity preserved', () => {
  const items = signal<Item[]>([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
  ])
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const lisBefore = parent.querySelectorAll('li')
  const firstLiBefore = lisBefore[0]!
  const secondLiBefore = lisBefore[1]!

  // Change item id=1's label — new object reference (immutable-item contract)
  items.set([
    { id: 1, label: 'A-updated' },
    { id: 2, label: 'B' },
  ])
  flushSync()

  const lisAfter = parent.querySelectorAll('li')
  expect(lisAfter.length, 'still 2 items').toBe(2)
  expect(lisAfter[0]!.textContent, 'first item updated').toBe('A-updated')
  expect(lisAfter[1]!.textContent, 'second unchanged').toBe('B')

  // NODE IDENTITY: same <li> elements — proves reactive-item (update), not rebuild (create/destroy)
  expect(lisAfter[0]!, 'first li node identity preserved').toBe(firstLiBefore)
  expect(lisAfter[1]!, 'second li node identity preserved').toBe(secondLiBefore)

  dispose()
  rmParent(parent)
})

// §8 obligation 5: Reorder — DOM order matches, roots persist, index accessor updates
test('TC-10g  reorder: DOM order matches new array, roots persist, index reactive', () => {
  const items = signal<Item[]>([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
    { id: 3, label: 'C' },
  ])
  // Use index template so we can verify the index signal updates
  const ir = makeListIR(() => items(), liIndexTemplate)
  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  const lisBefore = Array.from(parent.querySelectorAll('li'))
  // Initial: A#0, B#1, C#2
  expect(lisBefore[0]!.textContent).toBe('A#0')
  expect(lisBefore[1]!.textContent).toBe('B#1')
  expect(lisBefore[2]!.textContent).toBe('C#2')

  // Reorder to [C, A, B]
  items.set([
    { id: 3, label: 'C' },
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
  ])
  flushSync()

  const lisAfter = Array.from(parent.querySelectorAll('li'))
  expect(lisAfter.length, '3 items after reorder').toBe(3)
  expect(lisAfter[0]!.textContent, 'C now first').toBe('C#0')
  expect(lisAfter[1]!.textContent, 'A now second').toBe('A#1')
  expect(lisAfter[2]!.textContent, 'B now third').toBe('B#2')

  // Node identity: every <li> is the exact same object before and after reorder.
  // wireList uses insertBefore on the existing rec.rootEl — no new elements for kept keys.
  // Build a label→element map from before, then check per-key object identity.
  const beforeByLabel = new Map(lisBefore.map((li) => [li.textContent, li] as const))
  expect(
    lisAfter.every((li) => li === beforeByLabel.get(li.textContent)),
    'all li nodes reused on reorder (move, not rebuild)',
  ).toBe(true)

  dispose()
  rmParent(parent)
})

// §8 obligation 6: Key collision → error-route (not last-wins, not throw-through)
test('TC-10h  key collision: duplicate key in snapshot → error-route', () => {
  const items = signal<Item[]>([{ id: 1, label: 'A' }])
  const ir = makeListIR(() => items(), liTextTemplate)
  const parent = mkParent()

  let caughtError: unknown = null

  // Mount inside an error boundary to catch the throw from the reconcile effect
  const dispose = coreCreateRoot((d) => {
    errorBoundary(
      (e) => {
        caughtError = e
      },
      () => {
        mount(ir, parent, document)
      },
    )
    return d
  })
  flushSync()

  // Trigger a duplicate key
  items.set([
    { id: 1, label: 'A' },
    { id: 1, label: 'A-dup' }, // duplicate id=1
  ])
  flushSync()

  expect(caughtError, 'error caught by boundary').not.toBeNull()
  expect(String(caughtError), 'error mentions duplicate key').toMatch(/duplicate key/)

  dispose()
  rmParent(parent)
})

// §8 obligation 7: List unmount — all item roots disposed, no-leak
test('TC-10i  list unmount: all item roots disposed, no reactive leaks', () => {
  const labelA = signal('A')
  const labelB = signal('B')

  const items = signal<Item[]>([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
  ])

  // Use templates that close over the external signals, so we can observe observer counts
  const ir = makeListIR(
    () => items(),
    (vs, _is) => ({
      id: 'li-ext',
      shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
      bindings: [
        {
          kind: 'text',
          pathIndex: 0,
          expr: () => ((vs() as Item).id === 1 ? labelA() : labelB()),
        } satisfies TextBinding,
      ],
    }),
  )

  const parent = mkParent()
  const dispose = mount(ir, parent, document)
  flushSync()

  expect(__test.observerCount(labelA) >= 1, 'labelA observed while mounted').toBe(true)
  expect(__test.observerCount(labelB) >= 1, 'labelB observed while mounted').toBe(true)

  dispose()

  expect(__test.observerCount(labelA), 'labelA has 0 observers after list unmount').toBe(0)
  expect(__test.observerCount(labelB), 'labelB has 0 observers after list unmount').toBe(0)
  expect(__test.observerCount(items), 'items signal has 0 observers after list unmount').toBe(0)

  expect(parent.querySelectorAll('li').length, 'no li elements after unmount').toBe(0)

  rmParent(parent)
})

// §8 obligation 8: Nested ListBinding — disposal cascades correctly
test('TC-10j  nested ListBinding: disposal cascades to inner list', () => {
  type Group = { id: number; label: string; children: Item[] }
  const groups = signal<Group[]>([
    {
      id: 1,
      label: 'G1',
      children: [
        { id: 11, label: 'A' },
        { id: 12, label: 'B' },
      ],
    },
  ])

  const outerLabel = signal('outer')

  const innerItems = (vs: WritableSignal<unknown>) => (vs() as Group).children as readonly unknown[]

  const innerIR = (vs: WritableSignal<unknown>): TemplateIR => ({
    id: 'inner-list',
    shape: { html: '<ul><!--nv-0--></ul>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: () => innerItems(vs),
        key: (item) => (item as Item).id,
        itemTemplate: (childVs, _childIs) => ({
          id: 'inner-li',
          shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
          bindings: [
            {
              kind: 'text',
              pathIndex: 0,
              expr: () => (childVs() as Item).label,
            } satisfies TextBinding,
          ],
        }),
      } satisfies ListBinding,
    ],
  })

  const outerIR: TemplateIR = {
    id: 'outer-list',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: () => groups() as readonly unknown[],
        key: (g) => (g as Group).id,
        itemTemplate: (vs, _is) => innerIR(vs),
      } satisfies ListBinding,
    ],
  }

  const parent = mkParent()
  const dispose = mount(outerIR, parent, document)
  flushSync()

  expect(parent.querySelectorAll('li').length, '2 inner items initially').toBe(2)
  expect(__test.observerCount(groups) >= 1, 'groups observed').toBe(true)

  dispose()

  expect(parent.querySelectorAll('li').length, '0 li after dispose').toBe(0)
  expect(__test.observerCount(groups), 'groups has 0 observers after dispose').toBe(0)

  rmParent(parent)
})

// ── TC-MR: Multi-root template support ───────────────────────────────────────
//
// Back-ends previously only removed the first child of a mounted template on
// dispose. A 2-root template (<span> + <button>) leaked all but the first.
// These tests verify both back-ends correctly handle multi-root templates.

/**
 * Helper: mount via the given back-end and return a disposer.
 * Abstracts interpreter vs emitted-mount so the same assertions run for both.
 */
function mountVia(
  backend: 'interpreter' | 'emitted',
  ir: TemplateIR,
  parent: Element,
  doc: Document,
): () => void {
  if (backend === 'interpreter') {
    return mount(ir, parent, doc)
  }
  const { mountFn } = emitMount(ir)
  return mountFn(parent, doc)
}

/** 2-root template: <span>hello</span><button>click</button> */
const twoRootIR: TemplateIR = {
  id: 'tc-mr-two-root',
  shape: { html: '<span>hello</span><button>click</button>', bindingPaths: [] },
  bindings: [],
}

test('TC-MR-01a  interpreter: 2-root mount — both roots present, dispose removes all', () => {
  const parent = mkParent()
  const dispose = mountVia('interpreter', twoRootIR, parent, document)
  flushSync()

  expect(parent.children.length, '2 root elements mounted').toBe(2)
  expect(parent.querySelector('span') !== null, 'span present').toBe(true)
  expect(parent.querySelector('button') !== null, 'button present').toBe(true)

  dispose()
  expect(parent.childElementCount, 'no children after dispose').toBe(0)

  rmParent(parent)
})

test('TC-MR-01b  emitted-mount: 2-root mount — both roots present, dispose removes all', () => {
  const parent = mkParent()
  const dispose = mountVia('emitted', twoRootIR, parent, document)
  flushSync()

  expect(parent.children.length, '2 root elements mounted').toBe(2)
  expect(parent.querySelector('span') !== null, 'span present').toBe(true)
  expect(parent.querySelector('button') !== null, 'button present').toBe(true)

  dispose()
  expect(parent.childElementCount, 'no children after dispose').toBe(0)

  rmParent(parent)
})

/** Outer IR wrapper with a conditional anchor. */
function makeConditionalIRMultiRoot(
  condition: () => boolean,
  consequent: TemplateIR,
  alternate: TemplateIR | null = null,
): TemplateIR {
  return {
    id: `cond-mr:${Date.now()}`,
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'conditional',
        pathIndex: 0,
        condition,
        consequent,
        alternate,
      } satisfies ConditionalBinding,
    ],
  }
}

const twoRootConsequent: TemplateIR = {
  id: 'tc-mr-cond-consequent',
  shape: { html: '<span>yes</span><em>also</em>', bindingPaths: [] },
  bindings: [],
}

const singleRootAlternate: TemplateIR = {
  id: 'tc-mr-cond-alternate',
  shape: { html: '<p>no</p>', bindingPaths: [] },
  bindings: [],
}

test('TC-MR-02a  interpreter: conditional with 2-root consequent — mount/unmount cleans up', () => {
  const show = signal(true)
  const ir = makeConditionalIRMultiRoot(() => show(), twoRootConsequent, singleRootAlternate)
  const parent = mkParent()
  const dispose = mountVia('interpreter', ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element
  // consequent: span + em + anchor comment = 3 childNodes
  expect(div.querySelector('span') !== null, 'span present on true').toBe(true)
  expect(div.querySelector('em') !== null, 'em present on true').toBe(true)

  show.set(false)
  flushSync()
  expect(div.querySelector('span') === null, 'span gone after flip').toBe(true)
  expect(div.querySelector('em') === null, 'em gone after flip').toBe(true)
  expect(div.querySelector('p') !== null, 'alternate p present').toBe(true)

  // Flip N times — no accumulation
  for (let i = 0; i < 10; i++) {
    show.set(i % 2 === 0)
    flushSync()
  }
  // After 10 flips (i=0..9; last i=9 is odd → show=false → alternate)
  expect(div.querySelector('p') !== null, 'alternate present after N flips').toBe(true)
  expect(div.querySelector('span') === null, 'no span leak after N flips').toBe(true)

  dispose()
  expect(parent.childElementCount, 'no children after dispose').toBe(0)
  expect(__test.observerCount(show), 'no observer leak on condition signal').toBe(0)

  rmParent(parent)
})

test('TC-MR-02b  emitted-mount: conditional with 2-root consequent — mount/unmount cleans up', () => {
  const show = signal(true)
  const ir = makeConditionalIRMultiRoot(() => show(), twoRootConsequent, singleRootAlternate)
  const parent = mkParent()
  const dispose = mountVia('emitted', ir, parent, document)
  flushSync()

  const div = parent.querySelector('div') as Element
  expect(div.querySelector('span') !== null, 'span present on true').toBe(true)
  expect(div.querySelector('em') !== null, 'em present on true').toBe(true)

  show.set(false)
  flushSync()
  expect(div.querySelector('span') === null, 'span gone after flip').toBe(true)
  expect(div.querySelector('em') === null, 'em gone after flip').toBe(true)
  expect(div.querySelector('p') !== null, 'alternate p present').toBe(true)

  for (let i = 0; i < 10; i++) {
    show.set(i % 2 === 0)
    flushSync()
  }
  expect(div.querySelector('p') !== null, 'alternate present after N flips').toBe(true)
  expect(div.querySelector('span') === null, 'no span leak after N flips').toBe(true)

  dispose()
  expect(parent.childElementCount, 'no children after dispose').toBe(0)
  expect(__test.observerCount(show), 'no observer leak on condition signal').toBe(0)

  rmParent(parent)
})

/** Outer list IR with items that have 2-root templates. */
function makeTwoRootListIR(items: () => readonly { id: number }[]): TemplateIR {
  return {
    id: 'tc-mr-list',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: items as () => readonly unknown[],
        key: (item) => (item as { id: number }).id,
        itemTemplate: (_vs, _is) => ({
          id: 'two-root-item',
          shape: { html: '<span>a</span><em>b</em>', bindingPaths: [] },
          bindings: [],
        }),
      } satisfies ListBinding,
    ],
  }
}

/** Capture all console.error arguments as a flat string array. */
function captureErrors(fn: () => void): string[] {
  const captured: string[] = []
  const orig = console.error
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '))
  }
  try {
    fn()
  } finally {
    console.error = orig
  }
  return captured
}

test('TC-MR-03a  interpreter: multi-root list item throws loudly', () => {
  const items = signal([{ id: 1 }])
  const ir = makeTwoRootListIR(() => items())
  const parent = mkParent()
  const dispose = mountVia('interpreter', ir, parent, document)

  const errors = captureErrors(() => flushSync())

  const match = errors.find((e) => e.includes('Multi-root list items are not supported'))
  expect(
    match !== undefined,
    `Expected multi-root list error. Got: ${JSON.stringify(errors)}`,
  ).toBe(true)

  dispose()
  rmParent(parent)
})

test('TC-MR-03b  emitted-mount: multi-root list item throws the SAME error message', () => {
  const items = signal([{ id: 1 }])
  const ir = makeTwoRootListIR(() => items())
  const parent = mkParent()
  const dispose = mountVia('emitted', ir, parent, document)

  const errors = captureErrors(() => flushSync())

  const match = errors.find((e) => e.includes('Multi-root list items are not supported'))
  expect(
    match !== undefined,
    `Expected multi-root list error. Got: ${JSON.stringify(errors)}`,
  ).toBe(true)

  dispose()
  rmParent(parent)
})

// ── TC-C01: wireComponent — reactive prop ─────────────────────────────────────

test('TC-C01  wireComponent: reactive prop — child updates when parent signal changes', () => {
  const n = signal(0)
  const parent = mkParent()

  const CounterFactory = (props: { count: () => number }, _slots: unknown): TemplateIR => ({
    id: 'counter',
    shape: { html: '<span><!--nv-0--></span>', bindingPaths: [[0, 0]] },
    bindings: [{ kind: 'text', pathIndex: 0, expr: () => String(props.count()) }],
  })

  const parentIR: TemplateIR = {
    id: 'parent',
    shape: { html: '<div><!--nv-comp-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'component',
        pathIndex: 0,
        component: CounterFactory as ComponentBinding['component'],
        props: [{ name: 'count', expr: () => n() }],
        propNames: ['count'],
        slots: [],
      } satisfies ComponentBinding,
    ],
  }

  const dispose = mount(parentIR, parent, document)
  flushSync()

  expect(parent.querySelector('span')?.textContent).toBe('0')
  n.set(42)
  flushSync()
  expect(parent.querySelector('span')?.textContent).toBe('42')
  dispose()
  expect(parent.querySelector('span')).toBeNull()
  rmParent(parent)
})

// ── TC-C02: wireComponent — static prop ───────────────────────────────────────

test('TC-C02  wireComponent: static prop — constant accessor', () => {
  const parent = mkParent()

  const LabelFactory = (props: { label: () => string }, _slots: unknown): TemplateIR => ({
    id: 'label',
    shape: { html: '<span><!--nv-0--></span>', bindingPaths: [[0, 0]] },
    bindings: [{ kind: 'text', pathIndex: 0, expr: () => props.label() }],
  })

  const parentIR: TemplateIR = {
    id: 'parent',
    shape: { html: '<div><!--nv-comp-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'component',
        pathIndex: 0,
        component: LabelFactory as ComponentBinding['component'],
        props: [{ name: 'label', expr: () => 'hello' }],
        propNames: ['label'],
        slots: [],
      } satisfies ComponentBinding,
    ],
  }

  const dispose = mount(parentIR, parent, document)
  flushSync()
  expect(parent.querySelector('span')?.textContent).toBe('hello')
  dispose()
  rmParent(parent)
})

// ── TC-C08: wireComponent — default slot ──────────────────────────────────────

test('TC-C08  wireComponent: default slot content mounts in child slot position', () => {
  const parent = mkParent()

  const CardFactory = (
    _props: unknown,
    slots: { default?: (p: Record<string, unknown>) => TemplateIR },
  ): TemplateIR => {
    const slotIR = slots.default?.({})
    return {
      id: 'card',
      shape: { html: '<div class="card"><!--nv-comp-0--></div>', bindingPaths: [[0, 0]] },
      bindings: slotIR
        ? [
            {
              kind: 'component',
              pathIndex: 0,
              component: () => slotIR,
              props: [],
              propNames: [],
              slots: [],
            } satisfies ComponentBinding,
          ]
        : [],
    }
  }

  const slotContent: TemplateIR = {
    id: 'slot-content',
    shape: { html: '<p>hello slot</p>', bindingPaths: [] },
    bindings: [],
  }

  const parentIR: TemplateIR = {
    id: 'parent',
    shape: { html: '<div><!--nv-comp-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'component',
        pathIndex: 0,
        component: CardFactory as ComponentBinding['component'],
        props: [],
        propNames: [],
        slots: [{ name: 'default', content: () => slotContent }],
      } satisfies ComponentBinding,
    ],
  }

  const dispose = mount(parentIR, parent, document)
  flushSync()
  expect(parent.querySelector('p')?.textContent).toBe('hello slot')
  dispose()
  expect(parent.querySelector('p')).toBeNull()
  rmParent(parent)
})

// ── TC-C09: wireComponent — multi-root child ──────────────────────────────────

test('TC-C09  wireComponent: multi-root child — all roots cleaned up on dispose', () => {
  const parent = mkParent()

  const MultiFactory = (_props: unknown, _slots: unknown): TemplateIR => ({
    id: 'multi',
    shape: { html: '<span>a</span><span>b</span>', bindingPaths: [] },
    bindings: [],
  })

  const parentIR: TemplateIR = {
    id: 'parent',
    shape: { html: '<div><!--nv-comp-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'component',
        pathIndex: 0,
        component: MultiFactory as ComponentBinding['component'],
        props: [],
        propNames: [],
        slots: [],
      } satisfies ComponentBinding,
    ],
  }

  const dispose = mount(parentIR, parent, document)
  flushSync()
  expect(parent.querySelectorAll('span').length).toBe(2)
  dispose()
  expect(parent.querySelectorAll('span').length).toBe(0)
  rmParent(parent)
})

// ── TC-C10: wireComponent — 1000-flip no-leak ─────────────────────────────────

test('TC-C10  wireComponent: 1000-flip no-leak — component inside conditional', () => {
  const show = signal(true)
  const parent = mkParent()

  const CounterFactory = (props: { n: () => number }): TemplateIR => ({
    id: 'c',
    shape: { html: '<span><!--nv-0--></span>', bindingPaths: [[0, 0]] },
    bindings: [{ kind: 'text', pathIndex: 0, expr: () => String(props.n()) }],
  })

  const compBinding: ComponentBinding = {
    kind: 'component',
    pathIndex: 0,
    component: CounterFactory as unknown as ComponentBinding['component'],
    props: [{ name: 'n', expr: () => 0 }],
    propNames: ['n'],
    slots: [],
  }

  const compIR: TemplateIR = {
    id: 'comp-ir',
    shape: { html: '<div><!--nv-comp-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [compBinding],
  }

  const parentIR: TemplateIR = {
    id: 'parent',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'conditional',
        pathIndex: 0,
        condition: () => Boolean(show()),
        consequent: compIR,
        alternate: null,
      },
    ],
  }

  const dispose = mount(parentIR, parent, document)
  flushSync()

  for (let i = 0; i < 1000; i++) {
    show.set(i % 2 === 0)
    flushSync()
  }

  // After 1000 flips (i=0..999), last iteration i=999: show = (999 % 2 === 0) = false
  // Conditional is hidden; dispose cleans up the outer mount.
  dispose()
  expect(parent.childElementCount).toBe(0)
  rmParent(parent)
})

// ── TC-C03: wireComponent — multi-prop, each updates independently ────────────

test('TC-C03  wireComponent: multi-prop — each updates independently', () => {
  const countSig = signal(0)
  const labelSig = signal('Hits')
  const parent = mkParent()
  let countRuns = 0
  let labelRuns = 0

  const CounterFactory = (
    props: { count: () => number; label: () => string },
    _slots: unknown,
  ): TemplateIR => ({
    id: 'ctr',
    shape: {
      html: '<span><!--nv-0-->: <!--nv-1--></span>',
      bindingPaths: [
        [0, 0],
        [0, 2],
      ],
    },
    bindings: [
      {
        kind: 'text',
        pathIndex: 0,
        expr: () => {
          countRuns++
          return String(props.count())
        },
      },
      {
        kind: 'text',
        pathIndex: 1,
        expr: () => {
          labelRuns++
          return props.label()
        },
      },
    ],
  })

  const parentIR: TemplateIR = {
    id: 'p',
    shape: { html: '<div><!--nv-comp-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'component',
        pathIndex: 0,
        component: CounterFactory as ComponentBinding['component'],
        props: [
          { name: 'count', expr: () => countSig() },
          { name: 'label', expr: () => labelSig() },
        ],
        propNames: ['count', 'label'],
        slots: [],
      } satisfies ComponentBinding,
    ],
  }

  const dispose = mount(parentIR, parent, document)
  flushSync()
  const initCount = countRuns
  const initLabel = labelRuns

  countSig.set(1)
  flushSync()
  expect(countRuns).toBe(initCount + 1)
  expect(labelRuns).toBe(initLabel) // label did NOT re-run

  labelSig.set('Goals')
  flushSync()
  expect(labelRuns).toBe(initLabel + 1)

  dispose()
  rmParent(parent)
})

// ── TC-C12: wireComponent — component inside list item ────────────────────────

test('TC-C12  wireComponent: component inside list item — per-item owner', () => {
  const itemsSig = signal<unknown>(['a', 'b'])
  const parent = mkParent()

  const ItemFactory = (props: { label: () => unknown }, _slots: unknown): TemplateIR => ({
    id: 'item',
    shape: { html: '<li><!--nv-0--></li>', bindingPaths: [[0, 0]] },
    bindings: [{ kind: 'text', pathIndex: 0, expr: () => String(props.label()) }],
  })

  const parentIR: TemplateIR = {
    id: 'list',
    shape: { html: '<ul><!--nv-0--></ul>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'list',
        pathIndex: 0,
        items: () => itemsSig() as unknown[],
        key: (item) => item as string,
        itemTemplate: (valueSig) => ({
          id: 'li',
          shape: { html: '<div><!--nv-comp-0--></div>', bindingPaths: [[0, 0]] },
          bindings: [
            {
              kind: 'component',
              pathIndex: 0,
              component: ItemFactory as ComponentBinding['component'],
              props: [{ name: 'label', expr: () => valueSig() }],
              propNames: ['label'],
              slots: [],
            } satisfies ComponentBinding,
          ],
        }),
      },
    ],
  }

  const dispose = mount(parentIR, parent, document)
  flushSync()
  expect(parent.querySelectorAll('li').length).toBe(2)

  itemsSig.set(['a'])
  flushSync()
  expect(parent.querySelectorAll('li').length).toBe(1)

  dispose()
  expect(parent.querySelectorAll('li').length).toBe(0)
  rmParent(parent)
})

// ── TC-C13: wireComponent — factory called exactly once at mount ───────────────

test('TC-C13  wireComponent: factory called exactly once at mount, not on prop updates', () => {
  const parent = mkParent()
  const countSig = signal(0)
  let factoryCalls = 0

  const CounterFactory: ComponentBinding['component'] = (props) => {
    factoryCalls++
    return {
      id: 'ctr',
      shape: { html: '<span><!--nv-0--></span>', bindingPaths: [[0, 0]] },
      bindings: [
        { kind: 'text', pathIndex: 0, expr: () => String((props.count as () => number)()) },
      ],
    }
  }

  const ir: TemplateIR = {
    id: 'p',
    shape: { html: '<div><!--nv-comp-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'component',
        pathIndex: 0,
        component: CounterFactory,
        props: [{ name: 'count', expr: () => countSig() }],
        propNames: ['count'],
        slots: [],
      } satisfies ComponentBinding,
    ],
  }

  const dispose = mount(ir, parent, document)
  flushSync()
  expect(factoryCalls).toBe(1)

  countSig.set(1)
  flushSync()
  expect(factoryCalls).toBe(1)

  countSig.set(2)
  flushSync()
  expect(factoryCalls).toBe(1)

  dispose()
  rmParent(parent)
})

// ── TC-SB: SyncBinding ─────────────────────────────────────────────────────────
// Helper: dispatch events with synthetic target properties.
// Must use the jsdom window's Event constructor to satisfy jsdom's type checks.
function dispatchInputEvent(el: Element, value: string): void {
  Object.defineProperty(el, 'value', { value, writable: true, configurable: true })
  const EventCtor =
    (el.ownerDocument?.defaultView as { Event?: typeof Event } | null)?.Event ?? Event
  el.dispatchEvent(new EventCtor('input', { bubbles: true }))
}
function dispatchChangeEvent(el: Element, checked: boolean): void {
  Object.defineProperty(el, 'checked', { value: checked, writable: true, configurable: true })
  const EventCtor =
    (el.ownerDocument?.defaultView as { Event?: typeof Event } | null)?.Event ?? Event
  el.dispatchEvent(new EventCtor('change', { bubbles: true }))
}

test('TC-SB-01  SyncBinding: programmatic set → DOM prop updates (value)', () => {
  const jsdom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const doc = jsdom.window.document as unknown as Document
  const body = doc.querySelector('body') as Element
  const val = signal('hello')
  const ir: TemplateIR = {
    id: 'sb-01',
    shape: { html: '<input />', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'sync',
        pathIndex: 0,
        propName: 'value',
        readExpr: () => val(),
        eventName: 'input',
        writeTarget: val,
      } satisfies SyncBinding,
    ],
  }
  const dispose = mount(ir, body, doc)
  flushSync()
  const input = body.querySelector('input') as HTMLInputElement
  expect(input.value).toBe('hello')
  val.set('world')
  flushSync()
  expect(input.value).toBe('world')
  dispose()
})

test('TC-SB-02  SyncBinding: DOM event → signal write-back (value, string)', () => {
  const jsdom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const doc = jsdom.window.document as unknown as Document
  const body = doc.querySelector('body') as Element
  const val = signal('')
  const dispose = mount(
    {
      id: 'sb-02',
      shape: { html: '<input />', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'sync',
          pathIndex: 0,
          propName: 'value',
          readExpr: () => val(),
          eventName: 'input',
          writeTarget: val,
        } satisfies SyncBinding,
      ],
    },
    body,
    doc,
  )
  flushSync()
  const input = body.querySelector('input') as Element
  dispatchInputEvent(input, 'typed')
  flushSync()
  expect(val()).toBe('typed')
  dispose()
})

test('TC-SB-03  SyncBinding: checked extractor yields boolean, not string', () => {
  const jsdom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const doc = jsdom.window.document as unknown as Document
  const body = doc.querySelector('body') as Element
  const checked = signal(false)
  const dispose = mount(
    {
      id: 'sb-03',
      shape: { html: '<input type="checkbox" />', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'sync',
          pathIndex: 0,
          propName: 'checked',
          readExpr: () => checked(),
          eventName: 'change',
          writeTarget: checked,
        } satisfies SyncBinding,
      ],
    },
    body,
    doc,
  )
  flushSync()
  const input = body.querySelector('input') as Element
  dispatchChangeEvent(input, true)
  flushSync()
  expect(typeof checked()).toBe('boolean') // NOT 'string'
  expect(checked()).toBe(true)
  dispose()
})

test('TC-SB-04  SyncBinding: dispose removes listener, signal goes to 0 observers', () => {
  const jsdom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const doc = jsdom.window.document as unknown as Document
  const body = doc.querySelector('body') as Element
  const val = signal('a')
  const dispose = mount(
    {
      id: 'sb-04',
      shape: { html: '<input />', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'sync',
          pathIndex: 0,
          propName: 'value',
          readExpr: () => val(),
          eventName: 'input',
          writeTarget: val,
        } satisfies SyncBinding,
      ],
    },
    body,
    doc,
  )
  flushSync()
  const input = body.querySelector('input') as Element
  dispose()
  dispatchInputEvent(input, 'after-dispose')
  flushSync()
  expect(val()).toBe('a') // listener removed — write-back did not fire
  expect(__test.observerCount(val)).toBe(0)
})

test('TC-SB-05  SyncBinding: custom transform (map arity)', () => {
  const jsdom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const doc = jsdom.window.document as unknown as Document
  const body = doc.querySelector('body') as Element
  const num = signal(0)
  const dispose = mount(
    {
      id: 'sb-05',
      shape: { html: '<input />', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'sync',
          pathIndex: 0,
          propName: 'value',
          readExpr: () => String(num()),
          eventName: 'input',
          writeTarget: num,
          transform: (_ev: unknown) => 42, // always writes 42
        } satisfies SyncBinding,
      ],
    },
    body,
    doc,
  )
  flushSync()
  const input = body.querySelector('input') as Element
  dispatchInputEvent(input, 'anything')
  flushSync()
  expect(num()).toBe(42)
  dispose()
})

test('TC-SB-06  SyncBinding: 1-arg transform receives extracted value (string), NOT raw Event', () => {
  const jsdom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const doc = jsdom.window.document as unknown as Document
  const body = doc.querySelector('body') as Element
  const val = signal('')
  const transformArgs: unknown[] = []
  const dispose = mount(
    {
      id: 'sb-06',
      shape: { html: '<input />', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'sync',
          pathIndex: 0,
          propName: 'value',
          readExpr: () => val(),
          eventName: 'input',
          writeTarget: val,
          transform: (v: unknown) => {
            transformArgs.push(v)
            return v
          },
        } satisfies SyncBinding,
      ],
    },
    body,
    doc,
  )
  flushSync()
  const input = body.querySelector('input') as Element
  dispatchInputEvent(input, 'hello')
  flushSync()
  // transform should have been called with the extracted string value, not an Event object
  expect(transformArgs.length, 'transform called').toBeGreaterThan(0)
  const arg = transformArgs[0]
  expect(typeof arg, 'argument should be a string, not an Event').toBe('string')
  expect(arg).toBe('hello')
  dispose()
})

test('TC-SB-07  SyncBinding: 2-arg (reduce) transform receives (extractedValue, currentSignalValue)', () => {
  const jsdom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const doc = jsdom.window.document as unknown as Document
  const body = doc.querySelector('body') as Element
  const val = signal('initial')
  const transformCalls: [unknown, unknown][] = []
  const dispose = mount(
    {
      id: 'sb-07',
      shape: { html: '<input />', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'sync',
          pathIndex: 0,
          propName: 'value',
          readExpr: () => val(),
          eventName: 'input',
          writeTarget: val,
          transform: (extracted: unknown, current: unknown) => {
            transformCalls.push([extracted, current])
            return extracted
          },
        } satisfies SyncBinding,
      ],
    },
    body,
    doc,
  )
  flushSync()
  const input = body.querySelector('input') as Element
  dispatchInputEvent(input, 'typed')
  flushSync()
  expect(transformCalls.length, 'transform called').toBeGreaterThan(0)
  const [extracted, current] = transformCalls[0]!
  expect(typeof extracted, 'first arg should be extracted string').toBe('string')
  expect(extracted).toBe('typed')
  expect(current).toBe('initial') // current signal value at time of event
  dispose()
})

test('TC-SB-08  SyncBinding: derived() as write target triggers console.error', () => {
  const jsdom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const doc = jsdom.window.document as unknown as Document
  const body = doc.querySelector('body') as Element
  const base = signal('base')
  const derivedSig = derived(() => base())
  const errors: string[] = []
  const origConsoleError = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  }
  try {
    // Wire sync binding with derived() as write target — should trigger dev-mode warning
    const dispose = mount(
      {
        id: 'sb-08',
        shape: { html: '<input />', bindingPaths: [[0]] },
        bindings: [
          {
            kind: 'sync',
            pathIndex: 0,
            propName: 'value',
            readExpr: () => derivedSig(),
            eventName: 'input',
            writeTarget: derivedSig as unknown as WritableSignal<unknown>,
          } satisfies SyncBinding,
        ],
      },
      body,
      doc,
    )
    flushSync()
    dispose()
  } finally {
    console.error = origConsoleError
  }
  const match = errors.find((e) => e.includes('[nv] sync: write target is not a writable signal'))
  expect(
    match !== undefined,
    `Expected dev-mode error about non-writable signal. Got: ${JSON.stringify(errors)}`,
  ).toBe(true)
})
