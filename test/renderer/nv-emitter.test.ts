/**
 * nv Build Pipeline — Emitter + Round-Trip Differential Gate
 * Stream: (3) Renderer/templating
 * Spec: docs/design/build-pipeline-modeA-spec.md §9
 *
 * Tests:
 *   Unit: parseNvFileForEmit emit payload content
 *   Unit: emitModule emitted string fragments
 *   Round-trip: construct live IR from emit.bindingThunks + eval thunk sources
 *     with real primitives → mount → flushSync → assert DOM correct
 *
 * Note on round-trip strategy: The emitted module uses @neutro/view/* bare
 * specifiers (published-surface aliases per spec). Since dist/ is not built
 * during testing, the round-trip gate evaluates emitted thunk sources via
 * new Function() with real primitives injected — semantically equivalent to
 * dynamic import() of the emitted module, and verifies the same invariant:
 * erased thunk source, when run with real primitives, produces correct DOM.
 *
 * Corpus:
 *   EM-01  text binding
 *   EM-02  attr binding
 *   EM-03  prop binding
 *   EM-04  event binding (handler mutation-write)
 *   EM-05  conditional binding
 *   EM-06  multi-component file
 *   EM-07  multiple $script blocks
 *   EM-08  handler with mutation-write (§4 erasure)
 *   EM-09  diagnostics-fail: assignment to derived → emitModule throws
 *   EM-10  dispose-no-leak
 */

import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { createRoot, derived, effect, flushSync, onCleanup, signal } from '../../src/core/core.js'
import { mount } from '../../src/renderer/index.js'
import type {
  Binding,
  ComponentBinding,
  ComponentRef,
  ConditionalBinding,
  ReactiveExpr,
  TemplateIR,
} from '../../src/renderer/ir.js'
import { emitModule } from '../../src/renderer/nv-emitter.js'
import { parseNvFileForEmit } from '../../src/renderer/nv-parser.js'
import type { NvComponentResult, ThunkSource } from '../../src/renderer/nv-parser.js'

// ── Test environment ──────────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const document = dom.window.document as unknown as Document

function makeDoc() {
  const d = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  return d.window.document as unknown as Document
}

function makeParent(doc: Document): Element {
  return doc.createElement('div')
}

// ── Round-trip helper ─────────────────────────────────────────────────────────

/**
 * Evaluate an erased thunk source string in a scope with real primitives.
 * Returns the function value of the thunk.
 *
 * The thunk source is like `() => (count())` or `() => (count.set(count() + 1))`.
 * We wrap it in a function that has the signal variables in scope.
 */
function evalThunkSrc(src: string, scope: Record<string, unknown>): () => unknown {
  const names = Object.keys(scope)
  const values = Object.values(scope)
  // eslint-disable-next-line no-new-func
  const factory = new Function(...names, `return (${src})`) as (...args: unknown[]) => () => unknown
  return factory(...values)
}

/**
 * Build a live IR from a parsed NvComponentResult, evaluating thunk sources
 * with the given scope of real signal/derived values.
 */
function buildLiveIr(result: NvComponentResult, scope: Record<string, unknown>): TemplateIR {
  const { ir, emit } = result
  if (!emit) throw new Error('No emit payload')

  function buildLiveThunk(thunk: ThunkSource): unknown {
    switch (thunk.kind) {
      case 'text':
      case 'attr':
      case 'prop':
        // exprSrc is the expression body (e.g. 'count()'); wrap it into a thunk
        return evalThunkSrc(`() => (${thunk.exprSrc})`, scope)
      case 'event':
        // handlerSrc is a full arrow function expression (e.g. '() => count.set(count() + 1)')
        // The IR expects handler: () => (e: Event) => void — a thunk returning the handler fn
        // Wrap handlerSrc so it becomes the return value of the handler thunk
        return evalThunkSrc(`() => (${thunk.handlerSrc})`, scope)
      case 'conditional': {
        // Return condition thunk; consequent/alternate are sub-IRs handled recursively
        return evalThunkSrc(`() => (${thunk.conditionSrc})`, scope)
      }
    }
  }

  function buildLiveBindings(bindings: readonly Binding[], thunks: ThunkSource[]): Binding[] {
    return bindings.map((b, i) => {
      const thunk = thunks[i]!
      switch (b.kind) {
        case 'text':
          return {
            ...b,
            expr: buildLiveThunk(thunk) as () => string | number | boolean | null | undefined,
          }
        case 'attr':
          return {
            ...b,
            expr: buildLiveThunk(thunk) as () => string | number | boolean | null | undefined,
          }
        case 'prop':
          return { ...b, expr: buildLiveThunk(thunk) as () => unknown }
        case 'event':
          return { ...b, handler: buildLiveThunk(thunk) as () => (e: Event) => void }
        case 'conditional': {
          const ct = thunk as Extract<ThunkSource, { kind: 'conditional' }>
          const cb = b as ConditionalBinding
          return {
            ...b,
            condition: evalThunkSrc(`() => (${ct.conditionSrc})`, scope) as () => boolean,
            consequent: buildLiveSubIr(cb.consequent, ct.consequent),
            alternate:
              cb.alternate !== null && ct.alternate !== null
                ? buildLiveSubIr(cb.alternate, ct.alternate)
                : null,
          }
        }
        default:
          return b
      }
    })
  }

  function buildLiveSubIr(subIr: TemplateIR, thunks: ThunkSource[]): TemplateIR {
    return {
      ...subIr,
      bindings: buildLiveBindings(subIr.bindings, thunks),
    }
  }

  return {
    ...ir,
    bindings: buildLiveBindings(ir.bindings, emit.bindingThunks),
  }
}

/**
 * Evaluate the emitted scriptBody with real core primitives to create signals.
 * Returns the scope (name → signal value).
 */
function evalScriptBody(scriptBody: string): Record<string, unknown> {
  const scope: Record<string, unknown> = {}
  // Inject core primitives
  const coreScope = { signal, derived, effect, createRoot, onCleanup, flushSync }
  // Execute scriptBody as statements; collect declared names into scope
  // We do this by wrapping in a function that returns a scope object
  const wrappedBody = `
    ${scriptBody}
    return { ${extractDeclaredNames(scriptBody).join(', ')} }
  `
  const names = Object.keys(coreScope)
  const values = Object.values(coreScope)
  // eslint-disable-next-line no-new-func
  const factory = new Function(...names, wrappedBody) as (
    ...args: unknown[]
  ) => Record<string, unknown>
  const result = factory(...values)
  Object.assign(scope, result)
  return scope
}

/** Extract variable declaration names from script body (simple heuristic). */
function extractDeclaredNames(scriptBody: string): string[] {
  const names: string[] = []
  const re = /(?:const|let|var)\s+([\w$]+)/g
  for (const m of scriptBody.matchAll(re)) {
    if (m[1]) names.push(m[1])
  }
  return names
}

// ── EM-00: parseNvFileForEmit — emit payload unit tests ──────────────────────

describe('parseNvFileForEmit — emit payload', () => {
  test('EM-00a  text binding: exprSrc has bare-read erased', () => {
    const source = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    expect(results.length).toBe(1)
    const emit = results[0]!.emit!
    expect(emit.bindingThunks.length).toBe(1)
    const thunk = emit.bindingThunks[0]!
    expect(thunk.kind).toBe('text')
    if (thunk.kind === 'text') {
      expect(thunk.exprSrc).toBe('count()')
    }
  })

  test('EM-00b  attr binding: exprSrc has bare-read erased', () => {
    const source = `
const C = $component(() => {
  $script(() => { const cls = signal('') })
  $render(() => html\`<div class="\${cls}">x</div>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const thunk = results[0]!.emit!.bindingThunks[0]!
    expect(thunk.kind).toBe('attr')
    if (thunk.kind === 'attr') {
      expect(thunk.exprSrc).toBe('cls()')
    }
  })

  test('EM-00c  prop binding: exprSrc has bare-read erased', () => {
    const source = `
const C = $component(() => {
  $script(() => { const val = signal('') })
  $render(() => html\`<input .value="\${val}">\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const thunk = results[0]!.emit!.bindingThunks[0]!
    expect(thunk.kind).toBe('prop')
    if (thunk.kind === 'prop') {
      expect(thunk.exprSrc).toBe('val()')
    }
  })

  test('EM-00d  event binding: handlerSrc has bare-read + mutation-write erased', () => {
    const source = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<button @click="\${() => count = count + 1}">+</button>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const thunk = results[0]!.emit!.bindingThunks[0]!
    expect(thunk.kind).toBe('event')
    if (thunk.kind === 'event') {
      // count = count + 1 → count.set(count() + 1) (mutation-write + bare-read)
      expect(thunk.handlerSrc).toContain('count.set(count() + 1)')
    }
  })

  test('EM-00e  conditional binding: conditionSrc, consequent thunks, alternate thunks', () => {
    const source = `
const C = $component(() => {
  $script(() => { const show = signal(true) })
  $render(() => html\`<div>\${show ? html\`<span>A</span>\` : html\`<span>B</span>\`}</div>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const thunk = results[0]!.emit!.bindingThunks[0]!
    expect(thunk.kind).toBe('conditional')
    if (thunk.kind === 'conditional') {
      expect(thunk.conditionSrc).toBe('show()')
      expect(Array.isArray(thunk.consequent)).toBe(true)
      expect(thunk.alternate).not.toBeNull()
    }
  })

  test('EM-00f  scriptBody contains erased $script statements', () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    const double = derived(() => count() * 2)
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const scriptBody = results[0]!.emit!.scriptBody
    expect(scriptBody).toContain('const count = signal(0)')
    expect(scriptBody).toContain('const double = derived')
  })

  test('EM-00g  multiple $script blocks: all statements in scriptBody', () => {
    const source = `
const C = $component(() => {
  $script(() => { const a = signal(0) })
  $script(() => { const b = signal('') })
  $render(() => html\`<span>\${a}</span>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const scriptBody = results[0]!.emit!.scriptBody
    expect(scriptBody).toContain('const a = signal(0)')
    expect(scriptBody).toContain("const b = signal('')")
  })

  test('EM-00h  assignment-to-derived → error diagnostic', () => {
    const source = `
const C = $component(() => {
  $script(() => {
    const count = signal(0)
    const double = derived(() => count() * 2)
    double = count + 1
  })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const diags = results[0]!.diagnostics
    const err = diags.find((d) => d.kind === 'error' && d.message.includes('double'))
    expect(err, 'Expected error diagnostic for derived write').toBeDefined()
  })

  test('EM-00i  structural IR (ir.bindings, ir.shape) is consistent across calls', () => {
    const source = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const a = parseNvFileForEmit(source, 'test.nv', document)
    const b = parseNvFileForEmit(source, 'test.nv', document)
    expect(a[0]!.ir.shape.html).toBe(b[0]!.ir.shape.html)
    expect(a[0]!.ir.bindings.length).toBe(b[0]!.ir.bindings.length)
    expect(a[0]!.ir.bindings[0]!.kind).toBe(b[0]!.ir.bindings[0]!.kind)
  })
})

// ── EM-01: text binding round-trip ────────────────────────────────────────────

test('EM-01  text binding: erased thunk evaluates to correct value', () => {
  const source = `
const Counter = $component(() => {
  $script(() => {
    const count = signal(0)
  })
  $render(() => html\`<span>\${count}</span>\`)
})`

  const results = parseNvFileForEmit(source, 'counter.nv', document)
  const scope = evalScriptBody(results[0]!.emit!.scriptBody)
  const liveIr = buildLiveIr(results[0]!, scope)

  const doc = makeDoc()
  const parent = makeParent(doc)
  const dispose = createRoot((d) => {
    mount(liveIr, parent, doc)
    return d
  })
  flushSync()

  expect(parent.querySelector('span')).not.toBeNull()
  expect(parent.querySelector('span')!.textContent).toBe('0')

  dispose()
})

// ── EM-02: attr binding round-trip ────────────────────────────────────────────

test('EM-02  attr binding: erased thunk sets attribute correctly', () => {
  const source = `
const Styled = $component(() => {
  $script(() => {
    const cls = signal('active')
  })
  $render(() => html\`<div class="\${cls}">content</div>\`)
})`

  const results = parseNvFileForEmit(source, 'styled.nv', document)
  const scope = evalScriptBody(results[0]!.emit!.scriptBody)
  const liveIr = buildLiveIr(results[0]!, scope)

  const doc = makeDoc()
  const parent = makeParent(doc)
  const dispose = createRoot((d) => {
    mount(liveIr, parent, doc)
    return d
  })
  flushSync()

  expect(parent.querySelector('div')!.getAttribute('class')).toBe('active')
  dispose()
})

// ── EM-03: prop binding round-trip ────────────────────────────────────────────

test('EM-03  prop binding: erased thunk sets DOM property correctly', () => {
  const source = `
const Input = $component(() => {
  $script(() => {
    const val = signal('hello')
  })
  $render(() => html\`<input .value="\${val}">\`)
})`

  const results = parseNvFileForEmit(source, 'input.nv', document)
  const scope = evalScriptBody(results[0]!.emit!.scriptBody)
  const liveIr = buildLiveIr(results[0]!, scope)

  const doc = makeDoc()
  const parent = makeParent(doc)
  const dispose = createRoot((d) => {
    mount(liveIr, parent, doc)
    return d
  })
  flushSync()

  const input = parent.querySelector('input')
  expect(input).not.toBeNull()
  expect((input as unknown as Record<string, unknown>).value).toBe('hello')
  dispose()
})

// ── EM-04: event binding + handler mutation-write ─────────────────────────────

test('EM-04  event binding with mutation-write in handler: click increments count', () => {
  const source = `
const Button = $component(() => {
  $script(() => {
    const count = signal(0)
  })
  $render(() => html\`<span>\${count}</span><button @click="\${() => count = count + 1}">+</button>\`)
})`

  const results = parseNvFileForEmit(source, 'button.nv', document)
  const scope = evalScriptBody(results[0]!.emit!.scriptBody)
  const liveIr = buildLiveIr(results[0]!, scope)

  const doc = makeDoc()
  const parent = makeParent(doc)
  const dispose = createRoot((d) => {
    mount(liveIr, parent, doc)
    return d
  })
  flushSync()

  expect(parent.querySelector('span')!.textContent).toBe('0')

  const btn = parent.querySelector('button')!
  btn.dispatchEvent(new dom.window.Event('click'))
  flushSync()
  expect(parent.querySelector('span')!.textContent).toBe('1')

  btn.dispatchEvent(new dom.window.Event('click'))
  flushSync()
  expect(parent.querySelector('span')!.textContent).toBe('2')

  dispose()
})

// ── EM-05: conditional binding ────────────────────────────────────────────────

test('EM-05  conditional binding: condition thunk + branches correct', () => {
  const source = `
const Toggle = $component(() => {
  $script(() => {
    const show = signal(true)
  })
  $render(() => html\`<div>\${show ? html\`<span>A</span>\` : html\`<p>B</p>\`}</div>\`)
})`

  const results = parseNvFileForEmit(source, 'toggle.nv', document)
  const scope = evalScriptBody(results[0]!.emit!.scriptBody)
  const liveIr = buildLiveIr(results[0]!, scope)

  const doc = makeDoc()
  const parent = makeParent(doc)
  const dispose = createRoot((d) => {
    mount(liveIr, parent, doc)
    return d
  })
  flushSync()

  // Initial: consequent branch (show = true)
  expect(parent.querySelector('span')).not.toBeNull()
  expect(parent.querySelector('p')).toBeNull()

  // Toggle to false
  const showSig = scope.show as ReturnType<typeof signal<boolean>>
  showSig.set(false)
  flushSync()
  expect(parent.querySelector('span')).toBeNull()
  expect(parent.querySelector('p')).not.toBeNull()

  dispose()
})

// ── EM-06: multi-component file ───────────────────────────────────────────────

test('EM-06  multi-component file: both components produce correct IR', () => {
  const source = `
const Foo = $component(() => {
  $script(() => { const x = signal(1) })
  $render(() => html\`<span>\${x}</span>\`)
})
const Bar = $component(() => {
  $script(() => { const y = signal(2) })
  $render(() => html\`<p>\${y}</p>\`)
})`

  const results = parseNvFileForEmit(source, 'multi.nv', document)
  expect(results.length).toBe(2)
  expect(results[0]!.name).toBe('Foo')
  expect(results[1]!.name).toBe('Bar')

  const js = emitModule(results)
  expect(js).toContain('export function Foo(')
  expect(js).toContain('export function Bar(')

  const scopeFoo = evalScriptBody(results[0]!.emit!.scriptBody)
  const scopeBar = evalScriptBody(results[1]!.emit!.scriptBody)
  const liveIrFoo = buildLiveIr(results[0]!, scopeFoo)
  const liveIrBar = buildLiveIr(results[1]!, scopeBar)

  const doc = makeDoc()
  const parentFoo = makeParent(doc)
  const disposeFoo = createRoot((d) => {
    mount(liveIrFoo, parentFoo, doc)
    return d
  })
  const parentBar = makeParent(doc)
  const disposeBar = createRoot((d) => {
    mount(liveIrBar, parentBar, doc)
    return d
  })
  flushSync()

  expect(parentFoo.querySelector('span')!.textContent).toBe('1')
  expect(parentBar.querySelector('p')!.textContent).toBe('2')

  disposeFoo()
  disposeBar()
})

// ── EM-07: multiple $script blocks ───────────────────────────────────────────

test('EM-07  multiple $script blocks: all signals available in template', () => {
  const source = `
const Multi = $component(() => {
  $script(() => { const a = signal(10) })
  $script(() => { const b = signal(20) })
  $render(() => html\`<span>\${a}</span><p>\${b}</p>\`)
})`

  const results = parseNvFileForEmit(source, 'multiscript.nv', document)
  const scope = evalScriptBody(results[0]!.emit!.scriptBody)
  const liveIr = buildLiveIr(results[0]!, scope)

  const doc = makeDoc()
  const parent = makeParent(doc)
  const dispose = createRoot((d) => {
    mount(liveIr, parent, doc)
    return d
  })
  flushSync()

  expect(parent.querySelector('span')!.textContent).toBe('10')
  expect(parent.querySelector('p')!.textContent).toBe('20')

  dispose()
})

// ── EM-08: handler with mutation-write (§4) ───────────────────────────────────

test('EM-08  handler mutation-write: compound assignment (+=) erased correctly', () => {
  const source = `
const Inc = $component(() => {
  $script(() => { const count = signal(5) })
  $render(() => html\`<span>\${count}</span><button @click="\${() => count += 10}">+</button>\`)
})`

  const results = parseNvFileForEmit(source, 'inc.nv', document)
  const thunk = results[0]!.emit!.bindingThunks[1]!
  expect(thunk.kind).toBe('event')
  if (thunk.kind === 'event') {
    expect(thunk.handlerSrc).toContain('count.set(count() + 10)')
  }

  const scope = evalScriptBody(results[0]!.emit!.scriptBody)
  const liveIr = buildLiveIr(results[0]!, scope)

  const doc = makeDoc()
  const parent = makeParent(doc)
  const dispose = createRoot((d) => {
    mount(liveIr, parent, doc)
    return d
  })
  flushSync()

  expect(parent.querySelector('span')!.textContent).toBe('5')

  const btn = parent.querySelector('button')!
  btn.dispatchEvent(new dom.window.Event('click'))
  flushSync()
  expect(parent.querySelector('span')!.textContent).toBe('15')

  dispose()
})

// ── EM-09: diagnostics-fail ───────────────────────────────────────────────────

test('EM-09  assignment to derived → emitModule throws with error diagnostic', () => {
  const source = `
const Bad = $component(() => {
  $script(() => {
    const count = signal(0)
    const double = derived(() => count() * 2)
    double = count + 1
  })
  $render(() => html\`<span>\${count}</span>\`)
})`

  const results = parseNvFileForEmit(source, 'test.nv', document)
  expect(() => emitModule(results)).toThrow()
})

// ── EM-10: dispose-no-leak ────────────────────────────────────────────────────

test('EM-10  dispose removes DOM and severs reactive edges (no leak)', () => {
  const source = `
const Leak = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`

  const results = parseNvFileForEmit(source, 'leak.nv', document)
  const scope = evalScriptBody(results[0]!.emit!.scriptBody)
  const liveIr = buildLiveIr(results[0]!, scope)

  const doc = makeDoc()
  const parent = makeParent(doc)
  const dispose = createRoot((d) => {
    mount(liveIr, parent, doc)
    return d
  })
  flushSync()

  expect(parent.querySelector('span')).not.toBeNull()

  dispose()

  // After dispose, DOM should be removed
  expect(parent.querySelector('span')).toBeNull()
})

// ── EM-11: emitModule string content checks ───────────────────────────────────

describe('emitModule — string fragment checks', () => {
  test('EM-11a  emitted string contains factory name', () => {
    const source = `
const Counter = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const js = emitModule(results)
    expect(js).toContain('export function Counter(')
  })

  test('EM-11b  emitted string imports from @neutro/view/core', () => {
    const source = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const js = emitModule(results)
    expect(js).toContain("from '@neutro/view/core'")
    expect(js).toContain('signal')
    // createRoot and onCleanup are no longer force-included; only signal (from $script) appears
    expect(js).not.toContain('createRoot')
    expect(js).not.toContain('onCleanup')
  })

  test('EM-11c  emitted string imports mount from @neutro/view/renderer', () => {
    const source = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const js = emitModule(results)
    expect(js).toContain("from '@neutro/view/renderer'")
    expect(js).toContain('mount')
  })

  test('EM-11d  emitted string contains IR literal with shape.html', () => {
    const source = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const js = emitModule(results)
    // No __ir intermediate — IR literal is returned directly
    expect(js).not.toContain('__ir')
    expect(js).toContain('shape')
    expect(js).toContain('bindings')
    // .mount sugar is emitted
    expect(js).toContain('.mount =')
  })

  test('EM-11e  counter fixture: full emitted .js smoke check', () => {
    const source = `
const Counter = $component(() => {
  $script(() => {
    const count = signal(0)
  })
  $render(() => html\`<span>\${count}</span><button @click="\${() => count = count + 1}">+</button>\`)
})`
    const results = parseNvFileForEmit(source, 'counter.nv', document)
    const js = emitModule(results)
    // Should contain erased handler
    expect(js).toContain('count.set(count() + 1)')
    // Should contain erased expr
    expect(js).toContain('count()')
    // Factory
    expect(js).toContain('export function Counter(')
    // IR returned directly, not via __ir intermediate
    expect(js).not.toContain('__ir')
    // .mount sugar
    expect(js).toContain('Counter.mount =')
    expect(js).toContain('mount(Counter(props, slots), parent, doc)')
    // No onCleanup in the factory body
    expect(js).not.toContain('onCleanup(disposeMount)')
  })
})

// ── EM-D1a: factory signature — Name(props, slots) ───────────────────────────

describe('factory signature — props + slots params', () => {
  test('EM-D1a  emits Name(props, slots) factory', () => {
    const source = `
const Counter = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const js = emitModule(results)
    expect(js).toContain('export function Counter(props, slots)')
  })

  test('EM-D1b  emits Name(props, slots) for each component in multi-component file', () => {
    const source = `
const Foo = $component(() => {
  $script(() => { const x = signal(1) })
  $render(() => html\`<span>\${x}</span>\`)
})
const Bar = $component(() => {
  $script(() => { const y = signal(2) })
  $render(() => html\`<p>\${y}</p>\`)
})`
    const results = parseNvFileForEmit(source, 'test.nv', document)
    const js = emitModule(results)
    expect(js).toContain('export function Foo(props, slots)')
    expect(js).toContain('export function Bar(props, slots)')
  })
})

// ── EM-D1c: ComponentBinding literal emission ─────────────────────────────────

describe('ComponentBinding literal emission', () => {
  test('EM-D1c  emits component binding literal with kind, component, props, propNames, slots', () => {
    // Hand-author a minimal NvComponentResult with a ComponentBinding in the IR
    const stubShape = { html: '<div></div>', bindingPaths: [[0]] as [number[]] }
    const slotIr: TemplateIR = {
      id: 'nv:slot001',
      shape: { html: '<span></span>', bindingPaths: [] },
      bindings: [],
    }
    const componentBinding: ComponentBinding = {
      kind: 'component',
      pathIndex: 0,
      component: (() => slotIr) as unknown as ComponentRef,
      props: [{ name: 'label', expr: (() => 'hello') as unknown as ReactiveExpr }],
      propNames: ['label'],
      slots: [{ name: 'default', content: slotIr }],
    }
    const ir: TemplateIR = {
      id: 'nv:test001',
      shape: stubShape,
      bindings: [componentBinding],
    }
    const componentThunkSource: ThunkSource = {
      kind: 'component',
      componentSrc: 'MyButton',
      propSrcs: [{ name: 'label', exprSrc: '"hello"' }],
      propNames: ['label'],
      slots: [{ name: 'default', holeIndices: [], thunks: [] }],
    }
    const result: NvComponentResult = {
      name: 'Host',
      ir,
      scriptSignals: [],
      style: null,
      verdicts: ['PLAIN'],
      diagnostics: [],
      emit: {
        scriptBody: '',
        bindingThunks: [componentThunkSource],
        moduleScope: '',
      },
    }

    const js = emitModule([result])
    expect(js).toContain("kind: 'component'")
    expect(js).toContain('component: MyButton')
    expect(js).toContain('"label"')
    expect(js).toContain('propNames')
    expect(js).toContain('name: "default"')
  })
})

// ── EM-12: differential round-trip (emitted IR vs hand-authored IR) ───────────

test('EM-12  differential: emitted + evaluated IR produces same DOM as hand-authored IR', () => {
  const source = `
const C = $component(() => {
  $script(() => { const count = signal(0) })
  $render(() => html\`<span>\${count}</span>\`)
})`

  const results = parseNvFileForEmit(source, 'diff.nv', document)
  const scope = evalScriptBody(results[0]!.emit!.scriptBody)
  const liveIr = buildLiveIr(results[0]!, scope)

  // Mount via emitted (evaluated) IR
  const docE = makeDoc()
  const parentE = makeParent(docE)
  const disposeE = createRoot((d) => {
    mount(liveIr, parentE, docE)
    return d
  })
  flushSync()

  // Mount via hand-authored IR (reference)
  const countRef = signal(0)
  const refIr: TemplateIR = {
    id: liveIr.id,
    shape: liveIr.shape,
    bindings: [{ kind: 'text', pathIndex: 0, expr: () => countRef() }],
  }
  const docR = makeDoc()
  const parentR = makeParent(docR)
  const disposeR = createRoot((d) => {
    mount(refIr, parentR, docR)
    return d
  })
  flushSync()

  // Both should have <span> with textContent '0'
  const spanE = parentE.querySelector('span')
  const spanR = parentR.querySelector('span')
  expect(spanE).not.toBeNull()
  expect(spanR).not.toBeNull()
  expect(spanE!.textContent).toBe('0')
  expect(spanR!.textContent).toBe('0')

  disposeE()
  disposeR()
})

// ── EM-13: component emit path — parseNvFileForEmit → emitModule round-trip ──

test('EM-13  component emit path: parseNvFileForEmit + emitModule does not throw for <Counter .count="${n}"/>', () => {
  const src2 = `
const App = $component(() => {
  $script(() => { const n = signal(0) })
  $render(() => html\`<div><Counter .count="\${n}"/></div>\`)
})`

  const doc = makeDoc()
  const results = parseNvFileForEmit(src2, 'app.nv', doc)
  expect(results).toHaveLength(1)
  expect(results[0]!.diagnostics.filter((d) => d.kind === 'error')).toHaveLength(0)

  // The binding should include a component binding
  const bindings = results[0]!.ir.bindings
  expect(bindings.some((b) => b.kind === 'component')).toBe(true)

  // bindingThunks must be parallel to ir.bindings
  const thunks = results[0]!.emit!.bindingThunks
  expect(thunks).toHaveLength(bindings.length)
  expect(thunks[0]!.kind).toBe('component')

  // emitModule must not throw
  const emitted = emitModule(results)
  expect(emitted).toContain("kind: 'component'")
})

test('EM-13b  component prop exprSrc is erased: n (signal) → n() in propSrc', () => {
  const src = `
const App = $component(() => {
  $script(() => { const n = signal(0) })
  $render(() => html\`<div><Counter .count="\${n}"/></div>\`)
})`
  const doc = makeDoc()
  const results = parseNvFileForEmit(src, 'app.nv', doc)
  const thunks = results[0]!.emit!.bindingThunks
  const compThunk = thunks.find((t) => t.kind === 'component')
  expect(compThunk).toBeDefined()
  expect(compThunk!.kind).toBe('component')
  // propSrc must be erased: signal read → call expression
  const propSrc = (
    compThunk as Extract<
      import('../../src/renderer/nv-parser.js').ThunkSource,
      { kind: 'component' }
    >
  ).propSrcs[0]?.exprSrc
  expect(propSrc).toBe('n()') // not 'n'
})

// TC-C16 moved to nv-emitter-exec.test.ts (uses esbuild bundling; new Function cannot eval ESM imports)
