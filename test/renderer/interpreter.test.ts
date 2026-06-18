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
import { __test, flushSync, signal } from '../../src/core/core'
import { structurallyEqual } from '../../src/renderer/comparator'
import { createHtmlTag } from '../../src/renderer/html-tag'
import { mount } from '../../src/renderer/interpreter'
import type {
  ChildBinding,
  ConditionalBinding,
  EventBinding,
  PropBinding,
  TemplateIR,
  TextBinding,
} from '../../src/renderer/ir'

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
  expect(!elAfterFalse.hasAttribute('disabled'), 'disabled should be absent for false').toBe(true)

  disabled.set(true)
  flushSync()
  // true → setAttribute with empty value
  const elAfterTrue = parent.querySelector('button') as HTMLButtonElement
  expect(elAfterTrue.hasAttribute('disabled'), 'disabled should be present for true').toBe(true)
  expect(elAfterTrue.getAttribute('disabled'), 'disabled should be present for true').toBe('')

  disabled.set(null)
  flushSync()
  const elAfterNull = parent.querySelector('button') as HTMLButtonElement
  expect(!elAfterNull.hasAttribute('disabled'), 'disabled should be absent for null').toBe(true)

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
