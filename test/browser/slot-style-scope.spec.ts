import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
/**
 * G6: §5 guarantee — no child-hash attr on projected (parent-authored slot) nodes.
 *
 * Spec §5, reading (b): The child component must NOT stamp data-nv-s-<childhash>
 * on slot content authored by the parent. The child's scope hash is opaque to
 * parent-authored nodes; only the parent's scope hash may appear on them.
 *
 * This test mounts a parent component with styled slot content inside a child
 * component outlet, then asserts that the projected node carries NO
 * data-nv-s-<childhash> attribute.
 */
import { type Page, expect, test } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(__dirname, 'dist', 'nv-bundle.js')

async function loadNv(page: Page): Promise<void> {
  await page.goto('about:blank')
  await page.addScriptTag({ path: BUNDLE })
}

test.describe('G6: §5 guarantee — no child-hash attr on projected nodes', () => {
  // Use three browser projects (chromium, firefox, webkit) via Playwright config.

  test('G6: projected nodes carry no data-nv-s-<childhash>', async ({ page }) => {
    await loadNv(page)

    const result = await page.evaluate(() => {
      const { mount, flushSync } = window.__nv

      // Child component hash (simulated) — represents the child's own scope
      const childHash = 'childhash1'
      const childScopeAttr = `data-nv-s-${childHash}`

      // Parent's scope hash
      const parentHash = 'parenthash1'
      const parentScopeAttr = `data-nv-s-${parentHash}`
      const rewClass = `card_${parentHash}`
      const parentCss = `.${rewClass} { color: rgb(255, 0, 0) }`

      // Projected (slot) content authored by the parent.
      // This node should carry parent-scope attributes (card_parentHash class),
      // but MUST NOT carry child-scope attribute (data-nv-s-childhash).
      const slotContentIR = {
        id: 'slot:g6',
        shape: {
          html: '<div data-test-projected></div>',
          bindingPaths: [[0]],
        },
        bindings: [
          {
            kind: 'classlist' as const,
            pathIndex: 0,
            entries: [{ kind: 'toggle' as const, key: rewClass, expr: () => true }],
          },
        ],
      }

      // Child component IR — has its own style artifact with childHash.
      // The child mounts its own template; it should NOT stamp childHash onto projected nodes.
      const childIR = {
        id: 'child:g6',
        shape: {
          html: `<section class="child-host"><!--nv-0--></section>`,
          bindingPaths: [[0, 0]],
        },
        bindings: [{ kind: 'slot-outlet' as const, pathIndex: 0, name: 'default' }],
        // Child has its own style artifact — its scopeHash must NOT bleed onto projected nodes
        styleArtifact: {
          staticCss: `:where([${childScopeAttr}]) .child-host { background: blue }`,
          scopeHash: childHash,
        },
      }

      // Parent IR — mounts ChildComp with slot content.
      // Single-root element required for styleArtifact (mount stamps data-nv-s on it).
      // bindingPaths[0] = [0, 0] = firstChild of the first element = <!--nv-comp-0-->
      const parentIR = {
        id: 'parent:g6',
        shape: {
          html: '<div data-test-parent-root><!--nv-comp-0--></div>',
          bindingPaths: [[0, 0]],
        },
        bindings: [
          {
            kind: 'component' as const,
            pathIndex: 0,
            component: () => childIR,
            props: [],
            propNames: [],
            slots: [{ name: 'default', content: () => slotContentIR }],
          },
        ],
        styleArtifact: { staticCss: parentCss, scopeHash: parentHash },
      }

      const parent = document.createElement('div')
      document.body.appendChild(parent)
      mount(parentIR, parent, document)
      flushSync()

      const projected = parent.querySelector('[data-test-projected]') as HTMLElement | null
      const findings: string[] = []

      if (!projected) {
        findings.push('projected node not found in DOM')
      } else {
        // §5 guarantee: NO data-nv-s-<childhash> on projected node
        const nvSAttrs = [...projected.attributes]
          .map((a) => a.name)
          .filter((n) => n.startsWith('data-nv-s-'))

        if (nvSAttrs.includes(childScopeAttr)) {
          findings.push(
            `projected node has forbidden child-scope attr: ${childScopeAttr} (found: ${nvSAttrs.join(', ')})`,
          )
        }

        // Sanity: the projected node DOES have the parent's class (rewritten token)
        if (!projected.classList.contains(rewClass)) {
          findings.push(`projected node missing expected parent-scope class: ${rewClass}`)
        }

        void parentScopeAttr // parent-scope attr goes on the parent IR's root, not on slot content
      }

      parent.remove()
      return { ok: findings.length === 0, findings }
    })

    expect(result.ok, result.findings.join('\n')).toBe(true)
  })

  test('G6-b: child component root DOES get child-scope attr (positive control)', async ({
    page,
  }) => {
    // Positive control: the CHILD component's own template root DOES get data-nv-s-<childhash>.
    // This is the expected behavior for the child's own scope — only PROJECTED nodes are exempt.
    await loadNv(page)

    const result = await page.evaluate(() => {
      const { mount, flushSync } = window.__nv

      const childHash = 'childhash2'
      const childScopeAttr = `data-nv-s-${childHash}`
      const childCss = `:where([${childScopeAttr}]) .child-root { color: green }`

      // A standalone child IR with its own style (no slot content from parent).
      // Mounting this directly should stamp data-nv-s-<childhash> on its root.
      const childIR = {
        id: 'standalone:g6b',
        shape: {
          html: '<div class="child-root" data-test-child-root></div>',
          bindingPaths: [],
        },
        bindings: [],
        styleArtifact: { staticCss: childCss, scopeHash: childHash },
      }

      const parent = document.createElement('div')
      document.body.appendChild(parent)
      mount(childIR, parent, document)
      flushSync()

      const childRoot = parent.querySelector('[data-test-child-root]') as HTMLElement | null
      const findings: string[] = []

      if (!childRoot) {
        findings.push('child root not found')
      } else {
        // Positive control: child's own root MUST have the child-scope attr
        if (!childRoot.hasAttribute(childScopeAttr)) {
          findings.push(`child root missing expected ${childScopeAttr}`)
        }
      }

      parent.remove()
      return { ok: findings.length === 0, findings }
    })

    expect(result.ok, result.findings.join('\n')).toBe(true)
  })

  test('G6-c: slot content inside child outlet has NO child-scope attr (nv-parser path)', async ({
    page,
  }) => {
    // Verify the same G6 guarantee using a different slot content shape:
    // a plain static element passed as slot content to a child with its own scope.
    await loadNv(page)

    const result = await page.evaluate(() => {
      const { mount, flushSync } = window.__nv

      const childHash = 'childhash3'
      const childScopeAttr = `data-nv-s-${childHash}`

      const slotContentIR = {
        id: 'slot:g6c',
        shape: { html: '<p data-test-projected-c>hello</p>', bindingPaths: [] },
        bindings: [],
      }

      const childIR = {
        id: 'child:g6c',
        shape: { html: '<article><!--nv-0--></article>', bindingPaths: [[0, 0]] },
        bindings: [{ kind: 'slot-outlet' as const, pathIndex: 0, name: 'default' }],
        styleArtifact: {
          staticCss: `:where([${childScopeAttr}]) article { border: 1px solid }`,
          scopeHash: childHash,
        },
      }

      const parentIR = {
        id: 'parent:g6c',
        shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
        bindings: [
          {
            kind: 'component' as const,
            pathIndex: 0,
            component: () => childIR,
            props: [],
            propNames: [],
            slots: [{ name: 'default', content: () => slotContentIR }],
          },
        ],
      }

      const parent = document.createElement('div')
      document.body.appendChild(parent)
      mount(parentIR, parent, document)
      flushSync()

      const projected = parent.querySelector('[data-test-projected-c]') as HTMLElement | null
      const findings: string[] = []

      if (!projected) {
        findings.push('projected node not found')
      } else {
        const nvSAttrs = [...projected.attributes]
          .map((a) => a.name)
          .filter((n) => n.startsWith('data-nv-s-'))

        if (nvSAttrs.includes(childScopeAttr)) {
          findings.push(`projected node has forbidden child-scope attr: ${childScopeAttr}`)
        }
      }

      parent.remove()
      return { ok: findings.length === 0, findings }
    })

    expect(result.ok, result.findings.join('\n')).toBe(true)
  })
})
