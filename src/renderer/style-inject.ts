/**
 * nv Style Injection Registry
 * Stream: (3) Renderer/templating
 *
 * Provides idempotent per-document style injection.
 * One style injection per (document, identityHash) pair.
 * WeakMap keyed on Document so GC removes entries when the document is collected.
 *
 * Injection strategy:
 *   - adoptedStyleSheets path (Chrome 73+, Safari 16.4+, Firefox 101+): zero-FOUC
 *   - <style> fallback: jsdom + older browsers
 */

type StyleEntry =
  | { kind: 'adopted'; sheet: CSSStyleSheet }
  | { kind: 'style-el'; el: HTMLStyleElement }

type StyleRegistry = Map<string, StyleEntry>

const docStyleRegistries = new WeakMap<Document, StyleRegistry>()

function getOrCreateRegistry(doc: Document): StyleRegistry {
  let registry = docStyleRegistries.get(doc)
  if (registry === undefined) {
    registry = new Map<string, StyleEntry>()
    docStyleRegistries.set(doc, registry)
  }
  return registry
}

/**
 * Inject a component's scoped CSS into the given document.
 *
 * Idempotent: if `identityHash` is already registered for this document, no-op.
 * Prefers adoptedStyleSheets; falls back to <style> element injection.
 */
export function injectComponentStyle(doc: Document, identityHash: string, cssText: string): void {
  const registry = getOrCreateRegistry(doc)
  if (registry.has(identityHash)) return

  if (typeof doc.adoptedStyleSheets !== 'undefined') {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(cssText)
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
    registry.set(identityHash, { kind: 'adopted', sheet })
  } else {
    const styleEl = doc.createElement('style') as HTMLStyleElement
    styleEl.textContent = cssText
    const target = doc.head ?? doc.body
    if (target !== null) {
      target.appendChild(styleEl)
    }
    registry.set(identityHash, { kind: 'style-el', el: styleEl })
  }
}
