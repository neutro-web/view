import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Page, expect, test } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(__dirname, 'dist', 'nv-bundle.js')

async function loadNv(page: Page): Promise<void> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
}

const HASH = 'abcd1234'

test('G2.1: class-rewrite scopes IN — scoped element gets class + data-nv-s attr', async ({
  page,
}) => {
  await loadNv(page)
  const result = await page.evaluate((hash) => {
    const { mount, flushSync } = window.__nv
    const className = `card_${hash}`
    const cssText = `.${className} { color: rgb(255, 0, 0) }`
    const ir = {
      id: `g21-${hash}`,
      shape: { html: `<div class="${className}">hello</div>`, bindingPaths: [] },
      bindings: [],
      styleArtifact: { staticCss: cssText, scopeHash: hash },
    }
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    mount(ir, parent, document)
    flushSync()
    const div = parent.querySelector('div')
    const findings: string[] = []
    if (!div?.hasAttribute(`data-nv-s-${hash}`)) findings.push('missing data-nv-s attr')
    const color = div ? getComputedStyle(div).color : ''
    if (color !== 'rgb(255, 0, 0)') findings.push(`color not applied: ${color}`)
    parent.remove()
    return { ok: findings.length === 0, findings }
  }, HASH)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

test('G2.2: class-rewrite scopes OUT — outside element not styled', async ({ page }) => {
  await loadNv(page)
  const result = await page.evaluate((hash) => {
    const { mount, flushSync } = window.__nv
    const className = `card_${hash}`
    const cssText = `.${className} { color: rgb(255, 0, 0) }`
    const ir = {
      id: `g22-${hash}`,
      shape: { html: `<div class="${className}">hello</div>`, bindingPaths: [] },
      bindings: [],
      styleArtifact: { staticCss: cssText, scopeHash: hash },
    }
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    mount(ir, parent, document)
    flushSync()
    const outside = document.createElement('div')
    outside.className = 'card'
    document.body.appendChild(outside)
    const color = getComputedStyle(outside).color
    const findings: string[] = []
    if (color === 'rgb(255, 0, 0)') findings.push('outside element incorrectly styled')
    parent.remove()
    outside.remove()
    return { ok: findings.length === 0, findings }
  }, HASH)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

test('G2.3: selector-form :where() scoping — button inside styled, outside not', async ({
  page,
}) => {
  await loadNv(page)
  const result = await page.evaluate((hash) => {
    const { mount, flushSync } = window.__nv
    const scopeAttr = `data-nv-s-${hash}`
    const cssText = `:where([${scopeAttr}]) button { padding: 10px }`
    const ir = {
      id: `g23-${hash}`,
      shape: { html: '<div><button>inside</button></div>', bindingPaths: [] },
      bindings: [],
      styleArtifact: { staticCss: cssText, scopeHash: hash },
    }
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    mount(ir, parent, document)
    flushSync()
    const findings: string[] = []
    const insideBtn = parent.querySelector('button')
    const insidePadding = insideBtn ? getComputedStyle(insideBtn).paddingTop : ''
    if (insidePadding !== '10px') findings.push(`inside button padding: ${insidePadding}`)
    const outsideBtn = document.createElement('button')
    document.body.appendChild(outsideBtn)
    const outsidePadding = getComputedStyle(outsideBtn).paddingTop
    if (outsidePadding === '10px') findings.push('outside button incorrectly padded')
    parent.remove()
    outsideBtn.remove()
    return { ok: findings.length === 0, findings }
  }, HASH)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

test('G2.4: hoist-once dedup — 3 mounts of same id inject only 1 sheet', async ({ page }) => {
  await loadNv(page)
  const result = await page.evaluate((hash) => {
    const { mount, flushSync } = window.__nv
    const cssText = `.card_${hash} { color: red }`
    const makeIr = () => ({
      id: `g24-${hash}`,
      shape: { html: '<div>x</div>', bindingPaths: [] },
      bindings: [],
      styleArtifact: { staticCss: cssText, scopeHash: hash },
    })
    const parents = [1, 2, 3].map(() => {
      const p = document.createElement('div')
      document.body.appendChild(p)
      return p
    })
    for (const p of parents) {
      mount(makeIr(), p, document)
      flushSync()
    }
    const findings: string[] = []
    if (typeof document.adoptedStyleSheets !== 'undefined') {
      const count = document.adoptedStyleSheets.filter((s: CSSStyleSheet) =>
        [...s.cssRules].some((r) => r.cssText.includes(`card_${hash}`)),
      ).length
      if (count !== 1) findings.push(`adoptedStyleSheets count: ${count}, expected 1`)
    } else {
      const styles = document.querySelectorAll('style')
      const matching = [...styles].filter((s) => s.textContent?.includes(`card_${hash}`))
      if (matching.length !== 1) findings.push(`style elements: ${matching.length}, expected 1`)
    }
    for (const p of parents) p.remove()
    return { ok: findings.length === 0, findings }
  }, HASH)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

test('G2.5: injection via doc param — does not touch global document', async ({ page }) => {
  await loadNv(page)
  const result = await page.evaluate(() => {
    const { injectComponentStyle } = window.__nv
    const doc2 = document.implementation.createHTMLDocument()
    const beforeCount = document.head.querySelectorAll('style').length
    injectComponentStyle(doc2, 'g25-test', 'body { color: blue }')
    const afterCount = document.head.querySelectorAll('style').length
    const findings: string[] = []
    if (afterCount !== beforeCount)
      findings.push(`global document got ${afterCount - beforeCount} new style(s)`)
    return { ok: findings.length === 0, findings }
  })
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

test('G2.6: differential — interpreter and emitMount produce identical data-nv-s attr', async ({
  page,
}) => {
  await loadNv(page)
  const result = await page.evaluate((hash) => {
    const { mount, emitMount, flushSync } = window.__nv
    const cssText = `.card_${hash} { color: red }`
    const makeIr = (id: string) => ({
      id,
      shape: { html: '<div>x</div>', bindingPaths: [] },
      bindings: [],
      styleArtifact: { staticCss: cssText, scopeHash: hash },
    })
    const pA = document.createElement('div')
    const pB = document.createElement('div')
    document.body.appendChild(pA)
    document.body.appendChild(pB)
    mount(makeIr('g26-interp'), pA, document)
    emitMount(makeIr('g26-emit')).mountFn(pB, document)
    flushSync()
    const divA = pA.querySelector('div')
    const divB = pB.querySelector('div')
    const attrA = divA?.getAttribute(`data-nv-s-${hash}`)
    const attrB = divB?.getAttribute(`data-nv-s-${hash}`)
    const findings: string[] = []
    if (attrA === null || attrA === undefined)
      findings.push('interpreter root missing data-nv-s attr')
    if (attrB === null || attrB === undefined)
      findings.push('emitMount root missing data-nv-s attr')
    if (attrA !== attrB) findings.push(`attr mismatch: interp="${attrA}" emit="${attrB}"`)
    pA.remove()
    pB.remove()
    return { ok: findings.length === 0, findings }
  }, HASH)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

// ── G3 — StyleVarBinding gate tests ──────────────────────────────────────────

const VAR_NAME = '--nv-testvar'

test('G3.2: dynamic update — StyleVarBinding setProperty reflects signal change', async ({
  page,
}) => {
  await loadNv(page)
  const result = await page.evaluate((varName) => {
    const { signal, flushSync, mount } = window.__nv
    const colorSignal = signal('red')
    const ir = {
      id: 'g32-style-var',
      shape: { html: '<div>x</div>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'style-var' as const,
          pathIndex: 0,
          varName,
          expr: () => colorSignal(),
        },
      ],
    }
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    mount(ir, parent, document)
    flushSync()

    const el = parent.querySelector('div') as HTMLElement
    const findings: string[] = []

    const valueBefore = el.style.getPropertyValue(varName)
    if (valueBefore !== 'red')
      findings.push(`initial value wrong: '${valueBefore}' (expected 'red')`)

    colorSignal.set('blue')
    flushSync()
    const valueAfter = el.style.getPropertyValue(varName)
    if (valueAfter !== 'blue')
      findings.push(`after update value wrong: '${valueAfter}' (expected 'blue')`)

    parent.remove()
    return { ok: findings.length === 0, findings }
  }, VAR_NAME)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

test('G3.3: null → removeProperty — StyleVarBinding removes custom property on null', async ({
  page,
}) => {
  await loadNv(page)
  const result = await page.evaluate((varName) => {
    const { signal, flushSync, mount } = window.__nv
    const colorSignal = signal<string | null>('green')
    const ir = {
      id: 'g33-style-var',
      shape: { html: '<div>x</div>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'style-var' as const,
          pathIndex: 0,
          varName,
          expr: () => colorSignal(),
        },
      ],
    }
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    mount(ir, parent, document)
    flushSync()

    const el = parent.querySelector('div') as HTMLElement
    const findings: string[] = []

    const valueBefore = el.style.getPropertyValue(varName)
    if (valueBefore !== 'green')
      findings.push(`initial value wrong: '${valueBefore}' (expected 'green')`)

    colorSignal.set(null)
    flushSync()
    // CSS custom property API returns '' when property is absent
    const valueAfter = el.style.getPropertyValue(varName)
    if (valueAfter !== '') findings.push(`after null: expected '' (absent), got '${valueAfter}'`)

    parent.remove()
    return { ok: findings.length === 0, findings }
  }, VAR_NAME)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

test('G3.4: no re-injection on update — stylesheet count stable across 5 signal writes', async ({
  page,
}) => {
  await loadNv(page)
  const result = await page.evaluate((varName) => {
    const { signal, flushSync, mount } = window.__nv
    const colorSignal = signal('red')
    const hash = 'g34hash'
    const cssText = `.card_${hash} { color: var(${varName}) }`
    const ir = {
      id: `g34-style-var-${hash}`,
      shape: { html: '<div>x</div>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'style-var' as const,
          pathIndex: 0,
          varName,
          expr: () => colorSignal(),
        },
      ],
      styleArtifact: { staticCss: cssText, scopeHash: hash },
    }
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    mount(ir, parent, document)
    flushSync()

    // Record sheet count after initial mount
    const countBefore =
      typeof document.adoptedStyleSheets !== 'undefined'
        ? document.adoptedStyleSheets.length
        : document.querySelectorAll('style').length

    // 5 signal writes + flush each time
    for (let i = 0; i < 5; i++) {
      colorSignal.set(`color-${i}`)
      flushSync()
    }

    const countAfter =
      typeof document.adoptedStyleSheets !== 'undefined'
        ? document.adoptedStyleSheets.length
        : document.querySelectorAll('style').length

    const findings: string[] = []
    if (countAfter > countBefore)
      findings.push(`stylesheet count increased: ${countBefore} → ${countAfter}`)

    parent.remove()
    return { ok: findings.length === 0, findings }
  }, VAR_NAME)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

test('G3.5: misclassification safe — varBindingDescs present for dynamic $style IR', async ({
  page,
}) => {
  // NOTE: The reactive-vs-static split logic lives in nv-parser.ts (buildStyleArtifact).
  // Unit tests in test/renderer/style-lowering.test.ts cover the parser split exhaustively.
  // This browser test verifies that an IR with varBindingDescs wires correctly:
  // the style-var binding is applied and the desc metadata is structurally present.
  await loadNv(page)
  const result = await page.evaluate((varName) => {
    const { signal, flushSync, mount } = window.__nv
    const colorSignal = signal('purple')
    // Simulate what the compiler emits for a dynamic $style: staticCss uses var(...)
    // and the corresponding style-var binding drives the actual value.
    const varBindingDescs = [{ varName, exprSrc: 'colorSignal()', propertyName: 'color' }]
    const ir = {
      id: 'g35-misclassify',
      shape: { html: '<div>x</div>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'style-var' as const,
          pathIndex: 0,
          varName,
          expr: () => colorSignal(),
        },
      ],
      styleArtifact: {
        staticCss: `.card_g35 { color: var(${varName}) }`,
        scopeHash: 'g35hash',
        varBindingDescs,
      },
    }
    const findings: string[] = []
    if (!varBindingDescs || varBindingDescs.length === 0)
      findings.push('varBindingDescs should be non-empty for dynamic $style')

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    mount(ir, parent, document)
    flushSync()
    const el = parent.querySelector('div') as HTMLElement
    const val = el.style.getPropertyValue(varName)
    if (val !== 'purple') findings.push(`style-var not applied: '${val}' (expected 'purple')`)

    parent.remove()
    return { ok: findings.length === 0, findings }
  }, VAR_NAME)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

test('G3.6: differential — interpreter and emitMount produce identical StyleVarBinding inline style', async ({
  page,
}) => {
  await loadNv(page)
  const result = await page.evaluate((varName) => {
    const { signal, flushSync, mount, emitMount } = window.__nv
    const colorSignal = signal('orange')

    const makeIr = (id: string) => ({
      id,
      shape: { html: '<div>x</div>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'style-var' as const,
          pathIndex: 0,
          varName,
          expr: () => colorSignal(),
        },
      ],
    })

    const pA = document.createElement('div')
    const pB = document.createElement('div')
    document.body.appendChild(pA)
    document.body.appendChild(pB)

    mount(makeIr('g36-interp'), pA, document)
    emitMount(makeIr('g36-emit')).mountFn(pB, document)
    flushSync()

    const elA = pA.querySelector('div') as HTMLElement
    const elB = pB.querySelector('div') as HTMLElement

    const findings: string[] = []
    const valA = elA.style.getPropertyValue(varName)
    const valB = elB.style.getPropertyValue(varName)
    if (valA !== 'orange') findings.push(`interpreter: expected 'orange', got '${valA}'`)
    if (valB !== 'orange') findings.push(`emitMount: expected 'orange', got '${valB}'`)
    if (valA !== valB) findings.push(`differential mismatch: interp='${valA}' emit='${valB}'`)

    // Signal change — both must update identically
    colorSignal.set('teal')
    flushSync()
    const valA2 = elA.style.getPropertyValue(varName)
    const valB2 = elB.style.getPropertyValue(varName)
    if (valA2 !== 'teal') findings.push(`interpreter after update: expected 'teal', got '${valA2}'`)
    if (valB2 !== 'teal') findings.push(`emitMount after update: expected 'teal', got '${valB2}'`)
    if (valA2 !== valB2)
      findings.push(`differential mismatch after update: interp='${valA2}' emit='${valB2}'`)

    pA.remove()
    pB.remove()
    return { ok: findings.length === 0, findings }
  }, VAR_NAME)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

test('G3.7: wireStyleVar owner cleanup — effect torn down on dispose, no update after', async ({
  page,
}) => {
  await loadNv(page)
  const result = await page.evaluate((varName) => {
    const { signal, flushSync, mount } = window.__nv
    const colorSignal = signal('cyan')
    const ir = {
      id: 'g37-style-var',
      shape: { html: '<div>x</div>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'style-var' as const,
          pathIndex: 0,
          varName,
          expr: () => colorSignal(),
        },
      ],
    }
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const dispose = mount(ir, parent, document)
    flushSync()

    const el = parent.querySelector('div') as HTMLElement
    const findings: string[] = []

    const valueBefore = el.style.getPropertyValue(varName)
    if (valueBefore !== 'cyan')
      findings.push(`pre-dispose value wrong: '${valueBefore}' (expected 'cyan')`)

    // Dispose tears down effects; capture the inline style value at this point
    dispose()
    const valueAtDispose = el.style.getPropertyValue(varName)

    // Write signal after dispose — effect must be torn down, property must not change
    colorSignal.set('magenta')
    flushSync()
    const valueAfterDispose = el.style.getPropertyValue(varName)

    if (valueAfterDispose === 'magenta')
      findings.push('effect not torn down: inline style updated to magenta after dispose')

    // Sanity: value at dispose and after must match (no live effect)
    if (valueAfterDispose !== valueAtDispose)
      findings.push(`value changed after dispose: '${valueAtDispose}' → '${valueAfterDispose}'`)

    parent.remove()
    return { ok: findings.length === 0, findings, valueAtDispose, valueAfterDispose }
  }, VAR_NAME)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

const CL_HASH = 'cl42hash'

test('G4.1: classlist toggle uses rewritten class name', async ({ page }) => {
  await loadNv(page)
  const result = await page.evaluate((hash) => {
    const { signal, flushSync, mount } = window.__nv
    const show = signal(true)
    const rewClass = `card_${hash}`
    const ir = {
      id: `g41-${hash}`,
      shape: { html: '<div></div>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'classlist' as const,
          pathIndex: 0,
          entries: [{ kind: 'toggle' as const, key: rewClass, expr: () => show() }],
        },
      ],
      styleArtifact: { staticCss: `.${rewClass} { color: rgb(255,0,0) }`, scopeHash: hash },
      classRewrites: new Map([['card', rewClass]]),
    }
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    mount(ir, parent, document)
    flushSync()
    const el = parent.querySelector('div') as HTMLElement
    const findings: string[] = []
    if (!el.classList.contains(rewClass)) findings.push(`missing class ${rewClass}`)
    if (el.classList.contains('card')) findings.push('has unrewritten class card')
    show.set(false)
    flushSync()
    if (el.classList.contains(rewClass))
      findings.push(`class ${rewClass} still present after toggle off`)
    parent.remove()
    return { ok: findings.length === 0, findings }
  }, CL_HASH)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})

test('G4.2: styled when toggled on — scoped CSS applies', async ({ page }) => {
  await loadNv(page)
  const result = await page.evaluate((hash) => {
    const { signal, flushSync, mount } = window.__nv
    const show = signal(true)
    const rewClass = `card_${hash}`
    const ir = {
      id: `g42-${hash}`,
      shape: { html: '<div></div>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'classlist' as const,
          pathIndex: 0,
          entries: [{ kind: 'toggle' as const, key: rewClass, expr: () => show() }],
        },
      ],
      styleArtifact: { staticCss: `.${rewClass} { color: rgb(255, 0, 0) }`, scopeHash: hash },
      classRewrites: new Map([['card', rewClass]]),
    }
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    mount(ir, parent, document)
    flushSync()
    const el = parent.querySelector('div') as HTMLElement
    const color = getComputedStyle(el).color
    parent.remove()
    return { color }
  }, CL_HASH)
  expect(result.color).toBe('rgb(255, 0, 0)')
})

test('G4.3: differential — both mount and emitMount produce rewritten class', async ({ page }) => {
  await loadNv(page)
  const result = await page.evaluate((hash) => {
    const { signal, flushSync, mount, emitMount } = window.__nv
    const rewClass = `card_${hash}`
    const makeIr = (id: string) => ({
      id,
      shape: { html: '<div></div>', bindingPaths: [[0]] },
      bindings: [
        {
          kind: 'classlist' as const,
          pathIndex: 0,
          entries: [{ kind: 'toggle' as const, key: rewClass, expr: () => true }],
        },
      ],
      styleArtifact: { staticCss: `.${rewClass} { color: rgb(255, 0, 0) }`, scopeHash: hash },
      classRewrites: new Map([['card', rewClass]]),
    })
    const pA = document.createElement('div')
    const pB = document.createElement('div')
    document.body.appendChild(pA)
    document.body.appendChild(pB)
    mount(makeIr(`g43a-${hash}`), pA, document)
    emitMount(makeIr(`g43b-${hash}`)).mountFn(pB, document)
    flushSync()
    const elA = pA.querySelector('div') as HTMLElement
    const elB = pB.querySelector('div') as HTMLElement
    const findings: string[] = []
    if (!elA.classList.contains(rewClass)) findings.push(`mount: missing ${rewClass}`)
    if (elA.classList.contains('card')) findings.push('mount: has unrewritten card')
    if (!elB.classList.contains(rewClass)) findings.push(`emitMount: missing ${rewClass}`)
    if (elB.classList.contains('card')) findings.push('emitMount: has unrewritten card')
    const colorA = getComputedStyle(elA).color
    const colorB = getComputedStyle(elB).color
    if (colorA !== colorB) findings.push(`color mismatch: ${colorA} vs ${colorB}`)
    pA.remove()
    pB.remove()
    return { ok: findings.length === 0, findings }
  }, CL_HASH)
  expect(result.ok, result.findings.join('\n')).toBe(true)
})
