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
