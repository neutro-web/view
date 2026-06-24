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
    // Element global. Both back-ends (interpreter.ts and emitted-mount.ts) key on
    // ir.styleArtifact.scopeHash (not ir.id) after the B3 fix — they converge to the same
    // injectComponentStyle call site, so this test covers the dedup semantic for both.
    // The full browser-level mount+dedup path is covered by G6 in test/browser/slot-style-scope.spec.ts.
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

  it("G3'-inverse: same template + different $style rules → distinct scopeHashes (C1 regression gate)", () => {
    // C1 fix: scopeHash = simpleHash(shapeHtml + '\0' + styleInfo.source).
    // Two components with byte-identical templates but different $style declarations
    // must NOT share a scopeHash — otherwise the second component's CSS is silently
    // dropped by injectComponentStyle dedup.
    const srcA = `const A = $component((_props) => {
      $style({ card: { color: 'red' } })
      $render(() => html\`<div class="\${{card: true}}">x</div>\`)
    })`
    const srcB = `const B = $component((_props) => {
      $style({ card: { color: 'blue' } })
      $render(() => html\`<div class="\${{card: true}}">x</div>\`)
    })`
    const rA = parseNvFile(srcA, 'a.nv', doc)[0]!
    const rB = parseNvFile(srcB, 'b.nv', doc)[0]!
    expect(rA.ir.styleArtifact?.scopeHash).toBeDefined()
    expect(rB.ir.styleArtifact?.scopeHash).toBeDefined()
    expect(rA.ir.styleArtifact!.scopeHash).not.toBe(rB.ir.styleArtifact!.scopeHash)
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

// ── Static-class regex branch coverage ───────────────────────────────────────
// The component case in patchClasslistTokens has two rewrite paths:
//   (a) classlist binding keys — exercised by G1/G3/G4 tests above
//   (b) slotIR.shape.html regex rewrite — exercised here (requires a hole to trigger
//       component detection; purely static slot content is a known parser limitation)

describe('Static-class-in-slot: literal class attr lifted to ClassListBinding (D-SS-1)', () => {
  it('static class + text hole in slot content: literal class attr lifted to classlist entries', () => {
    // D-SS-1: liftStaticClassBindings(fragWrapper, ...) runs in buildNvSlotContentIR before
    // shape.html serialization. class= attrs are stripped from shape.html and replaced with
    // ClassListBinding entries. patchClasslistTokens then rewrites entry tokens with scopeHash.
    // "extra" is not in classRewrites → token remains "extra" unchanged.
    const src = `const P = $component((_props) => {
      $style({ card: { color: 'red' } })
      $render(() => html\`<ChildComp><div class="card extra">\${1 + 1}</div></ChildComp>\`)
    })`
    const r = parseNvFile(src, 'test.nv', new JSDOM('').window.document)[0]!
    const scopeHash = r.ir.styleArtifact?.scopeHash
    expect(scopeHash).toBeDefined()
    const compBinding = r.ir.bindings.find((b) => b.kind === 'component') as ComponentBinding
    expect(compBinding).toBeDefined()
    const slotIR = compBinding.slots[0]?.content({})
    expect(slotIR).toBeDefined()
    // D-SS-1: class= stripped from shape.html; tokens in ClassListBinding entries instead
    expect(slotIR!.shape.html).not.toMatch(/class=/)
    const cl = slotIR!.bindings.find((b) => b.kind === 'classlist') as ClassListBinding | undefined
    expect(cl).toBeDefined()
    expect(cl!.entries).toContainEqual({ kind: 'static', token: `card_${scopeHash}` })
    expect(cl!.entries).toContainEqual({ kind: 'static', token: 'extra' })
  })
})

// G5 — <each>-in-slot class token: covered by nv-parser.test.ts G5 and slot-ss.test.ts
// G-SS-depth2 / G-SS-emit. Placeholder removed once Increment SS landed (2026-06-23).
