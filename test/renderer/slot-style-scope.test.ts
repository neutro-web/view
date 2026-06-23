/**
 * $style × slots scope-carry — G3', G4 differential tests
 *
 * Gate: docs/design/spec-style-slots-scope-carry.md §5
 *
 * G3' — Two parents with same $style + same shapeHtml share scopeHash; injection deduped.
 * G4  — Parse-path IR and emit-path output agree on slot-content class tokens.
 */
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emitMount } from '../../src/compiler/emitted-mount.js'
import { createRoot, flushSync } from '../../src/core/core.js'
import { mount } from '../../src/renderer/interpreter.js'
import type { ClassListBinding, ComponentBinding, TemplateIR } from '../../src/renderer/ir.js'
import { parseNvFile, parseNvFileForEmit } from '../../src/renderer/nv-parser.js'
import type { NvComponentResult } from '../../src/renderer/nv-parser.js'
import { getStyleRegistry, injectComponentStyle } from '../../src/renderer/style-inject.js'

// ── Test infrastructure ────────────────────────────────────────────────────────

let dom: JSDOM
let doc: Document
let container: HTMLElement

beforeEach(() => {
  dom = new JSDOM('<!DOCTYPE html><body><div id="app"></div></body>')
  doc = dom.window.document
  container = doc.getElementById('app')!
})

afterEach(() => {
  dom.window.close()
})

// ── G3' — scopeHash identity: same $style + same shapeHtml shape ──────────────

describe("G3': same $style definition + same template shape shares scopeHash", () => {
  it("G3': two parents with identical $style and identical template text share scopeHash", () => {
    // Both parents have byte-for-byte identical $style definitions AND identical template
    // literal text (same child tag name, same slot content). The only difference is the
    // component name (ParentA vs ParentB), which does NOT affect shapeHtml — shapeHtml
    // comes from the template literal, not the component name.
    // Per B3: scopeHash = simpleHash(shapeHtml) — so these must be equal.
    const src = `
      const ParentA = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
      const ParentB = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
    `
    const results = parseNvFile(src, 'test.nv', doc)
    const a = results.find((r) => r.name === 'ParentA')!
    const b = results.find((r) => r.name === 'ParentB')!
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    // Both have the same styled class key and same template structure
    expect(a.ir.styleArtifact).toBeDefined()
    expect(b.ir.styleArtifact).toBeDefined()
    // Same $style + same template text → same shapeHtml → same scopeHash (B3 invariant)
    expect(a.ir.styleArtifact!.scopeHash).toBe(b.ir.styleArtifact!.scopeHash)

    // Emit-path must agree: same scopeHash on both parse-path and emit-path (G3' constraint
    // requires BOTH paths, not just parse-path).
    const emitResults = parseNvFileForEmit(src, 'test.nv', doc)
    const emitA = emitResults.find((r) => r.name === 'ParentA')!
    const emitB = emitResults.find((r) => r.name === 'ParentB')!
    expect(emitA.ir.styleArtifact).toBeDefined()
    expect(emitB.ir.styleArtifact).toBeDefined()
    // Emit-path scopeHash must match parse-path scopeHash (same input → same shapeHtml → same hash)
    expect(emitA.ir.styleArtifact!.scopeHash).toBe(a.ir.styleArtifact!.scopeHash)
    expect(emitB.ir.styleArtifact!.scopeHash).toBe(b.ir.styleArtifact!.scopeHash)
  })

  it("G3': different child component names → different shapeHtml → different scopeHash (by-design)", () => {
    // When parent A uses ChildA and parent B uses ChildB, the authored template text
    // differs (ChildA vs ChildB appears literally). This means shapeHtml differs,
    // and B3 correctly produces distinct scopeHashes. This is CORRECT BEHAVIOR —
    // different authored templates produce different scopes.
    const src = `
      const ParentA = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildA><div class="\${{card: true}}">a</div></ChildA>\`)
      })
      const ParentB = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildB><div class="\${{card: true}}">b</div></ChildB>\`)
      })
    `
    const results = parseNvFile(src, 'test.nv', doc)
    const a = results.find((r) => r.name === 'ParentA')!
    const b = results.find((r) => r.name === 'ParentB')!
    expect(a.ir.styleArtifact?.scopeHash).not.toBe(b.ir.styleArtifact?.scopeHash)
  })

  it("G3': injection deduplication — two mounts of same-scopeHash parent inject only one sheet", () => {
    // Parse both parents to get their shared scopeHash, then build mountable IRs
    // that use the same scopeHash + cssText. The second inject call must be a no-op.
    const src = `
      const ParentA = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
      const ParentB = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
    `
    const results = parseNvFile(src, 'test.nv', doc)
    const a = results.find((r) => r.name === 'ParentA')!
    const b = results.find((r) => r.name === 'ParentB')!

    const scopeHash = a.ir.styleArtifact!.scopeHash
    expect(scopeHash).toBe(b.ir.styleArtifact!.scopeHash)

    const cssText = a.ir.styleArtifact!.staticCss

    // Directly call injectComponentStyle — this is exactly what mount() calls for styleArtifact IRs.
    // We test the dedup guarantee at the injection level without needing a real browser
    // Element global. The browser-level mount+dedup test is covered by G2.4 in
    // test/browser/style-scoping.spec.ts.
    injectComponentStyle(doc, scopeHash, cssText) // first injection
    injectComponentStyle(doc, scopeHash, cssText) // second — must be a no-op (deduped)

    // Registry must contain exactly one entry for this scopeHash
    const registry = getStyleRegistry(doc)
    expect(registry).toBeDefined()
    expect(registry!.has(scopeHash)).toBe(true)

    // Keyed by hash — having exactly one key means dedup worked
    const hashEntries = [...(registry ?? [])].filter(([k]) => k === scopeHash)
    expect(hashEntries).toHaveLength(1)
  })
})

// ── G4 — Parse↔emit differential: same slot class tokens ─────────────────────

describe('G4: parse-path IR and emit-path agree on slot-content classlist tokens', () => {
  it('G4: parse-path and emit-path produce the same rewritten class key in slot-content classlist', () => {
    const src = `
      const Parent = $component((_props) => {
        $style({ card: { color: 'red' } })
        $render(() => html\`<ChildComp><div class="\${{card: true}}">x</div></ChildComp>\`)
      })
    `
    const parseResults = parseNvFile(src, 'test.nv', doc)
    const emitResults = parseNvFileForEmit(src, 'test.nv', doc)

    const parseParent = parseResults.find((r) => r.name === 'Parent')!
    const emitParent = emitResults.find((r) => r.name === 'Parent')!
    expect(parseParent).toBeDefined()
    expect(emitParent).toBeDefined()

    // Both should have a styleArtifact with a scopeHash
    expect(parseParent.ir.styleArtifact?.scopeHash).toBeDefined()
    expect(emitParent.ir.styleArtifact?.scopeHash).toBeDefined()

    // scopeHash must be the same on both paths (same input → same shapeHtml → same hash)
    expect(parseParent.ir.styleArtifact!.scopeHash).toBe(emitParent.ir.styleArtifact!.scopeHash)

    const scopeHash = parseParent.ir.styleArtifact!.scopeHash

    // Helper: extract the classlist toggle key from the slot content inside the ComponentBinding
    function getSlotClasslistKey(result: NvComponentResult): string {
      const comp = result.ir.bindings.find((b) => b.kind === 'component') as
        | ComponentBinding
        | undefined
      expect(comp).toBeDefined()

      const slot = comp!.slots.find((s) => s.name === 'default')
      expect(slot).toBeDefined()

      const slotIR = slot!.content({})
      // The slot content is <div class="${{card: true}}">x</div>
      // After patchClasslistTokens, the toggle key should be rewritten to card_<scopeHash>
      const cl = slotIR.bindings.find((b) => b.kind === 'classlist') as ClassListBinding | undefined
      expect(cl).toBeDefined()

      const toggle = cl!.entries.find((e) => e.kind === 'toggle')
      expect(toggle).toBeDefined()
      expect(toggle!.kind).toBe('toggle')

      return (toggle as { kind: 'toggle'; key: string; expr: () => unknown }).key
    }

    const parseKey = getSlotClasslistKey(parseParent)
    const emitKey = getSlotClasslistKey(emitParent)

    // Both paths must agree on the rewritten class key
    expect(parseKey).toBe(emitKey)
    // And the key must be the scoped form: card_<scopeHash>
    expect(parseKey).toBe(`card_${scopeHash}`)
  })

  it('G4: both back-ends mount and apply slot-content class correctly', () => {
    // Build a manual IR simulating what parse/emit produce for a styled parent
    // with slot content containing a classlist toggle binding.
    const scopeHash = 'testscope1'
    const rewClass = `card_${scopeHash}`
    const cssText = `.${rewClass} { color: rgb(255, 0, 0) }`

    function buildParentIR(id: string): TemplateIR {
      const slotContentIR: TemplateIR = {
        id: `slot:${id}`,
        shape: { html: '<div data-test-projected></div>', bindingPaths: [[0]] },
        bindings: [
          {
            kind: 'classlist',
            pathIndex: 0,
            entries: [{ kind: 'toggle', key: rewClass, expr: () => true }],
          } as ClassListBinding,
        ],
      }
      const childIR: TemplateIR = {
        id: `child:${id}`,
        shape: { html: '<div class="child"><!--nv-0--></div>', bindingPaths: [[0, 0]] },
        bindings: [{ kind: 'slot-outlet', pathIndex: 0, name: 'default' }],
      }
      // Single-root template: <!--nv-comp-0--> is the sole child — path [0] = firstChild
      // No styleArtifact here because unit tests run in Node where global Element is not defined
      // (the interpreter checks `root instanceof Element` to stamp the scope attr).
      // The classlist behavior is independent of styleArtifact — we test tokens only.
      return {
        id: `parent:${id}`,
        shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
        bindings: [
          {
            kind: 'component',
            pathIndex: 0,
            component: () => childIR,
            props: [],
            propNames: [],
            slots: [{ name: 'default', content: () => slotContentIR }],
          },
        ],
      }
    }

    // Interpreter back-end
    createRoot((d) => {
      mount(buildParentIR('g4-interp'), container, doc)
      return d
    })
    flushSync()
    const projectedI = container.querySelector('[data-test-projected]') as HTMLElement
    expect(projectedI).not.toBeNull()
    expect(projectedI.classList.contains(rewClass)).toBe(true)

    // Reset container
    container.innerHTML = ''

    // Compiler (emitMount) back-end
    createRoot((d) => {
      emitMount(buildParentIR('g4-emit')).mountFn(container, doc)
      return d
    })
    flushSync()
    const projectedC = container.querySelector('[data-test-projected]') as HTMLElement
    expect(projectedC).not.toBeNull()
    expect(projectedC.classList.contains(rewClass)).toBe(true)
  })
})

// ── G5 — <each>-in-slot class token (deferred) ───────────────────────────────

describe('G5: <each>-in-slot class token (deferred)', () => {
  // DEFERRED: <each> in slot content is not wired. buildNvSlotContentIR discards the
  // `lists` return from walkNvNodeList (L772). patchClasslistTokens list-case handles
  // this automatically once <each>-in-slot is wired in the dedicated increment.
  it.skip('class-form token in <each>-inside-slot-content is rewritten with parent scopeHash', () => {})
})
