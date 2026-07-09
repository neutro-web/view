/**
 * Doc-example test for docs/guides/stale-while-revalidate.md (tier-1 SWR).
 *
 * Demonstrates the recipe documented there is real, working code, not just
 * prose: `iff(() => r() === undefined, spinner, view)` keeps the resolved
 * view mounted (same DOM node identity, not rebuilt) through a pending
 * refetch, and naturally reflects the new value once it settles.
 * This is the "Tier-1 recipe verified" gate item from the PT-1b-i commission.
 *
 * Also regression-tests the guide's warning against gating the branch on a
 * compound `r.loading() && r() === undefined` condition: `wireConditional`
 * has no same-winner no-op check (unlike the deferred-swap construct), so
 * reading `r.loading()` inside the condition — even short-circuited — makes
 * it a tracked dependency and causes the branch to be torn down and rebuilt
 * on every loading flip, losing node identity even though the resolved
 * branch never changes.
 *
 * No new wire path is exercised — this is plain consumer code over
 * `resource()` and the existing `iff()`/`ConditionalBinding` machinery, so
 * JSDOM is sufficient (mirrors resource.test.ts's own "no DOM needed for
 * resource itself, but here we do mount" convention from html-tag.test.ts).
 */

import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createRoot, flushSync, signal } from '../../src/core/core.js'
import { createHtmlTag, iff } from '../../src/renderer/html-tag.js'
import { mount } from '../../src/renderer/interpreter.js'
import { resource } from '../../src/renderer/resource.js'

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>')
  const doc = dom.window.document
  const html = createHtmlTag(doc)
  return { doc, html }
}

/** Controllable promise — resolve from outside synchronously. */
function deferred<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('tier-1 SWR recipe (docs/guides/stale-while-revalidate.md)', () => {
  it('first load shows the spinner branch (no data yet)', async () => {
    const { doc, html } = setup()
    const d1 = deferred<string>()

    const parent = doc.createElement('div')
    doc.body.appendChild(parent)

    const dispose = createRoot((d_) => {
      const r = resource(
        () => 'key',
        () => d1.promise,
      )

      const ir = html`<div>${iff(
        () => r() === undefined,
        () => html`<span class="spinner">loading</span>`,
        () => html`<span class="view">${() => r() ?? ''}</span>`,
      )}</div>`

      mount(ir, parent, doc)
      return d_
    })

    flushSync()
    expect(parent.querySelector('.spinner')?.textContent).toBe('loading')
    expect(parent.querySelector('.view')).toBeNull()

    dispose()
  })

  it('reactive-source refetch: view stays mounted (identity-preserving) while pending, updates on settle', async () => {
    const { doc, html } = setup()
    const d1 = deferred<string>()
    const d2 = deferred<string>()
    const src = signal('a')

    const parent = doc.createElement('div')
    doc.body.appendChild(parent)

    const dispose = createRoot((d_) => {
      const r = resource(
        () => src(),
        (s) => (s === 'a' ? d1.promise : d2.promise),
      )

      const ir = html`<div>${iff(
        () => r() === undefined,
        () => html`<span class="spinner">loading</span>`,
        () => html`<span class="view">${() => r() ?? ''}</span>`,
      )}</div>`

      mount(ir, parent, doc)
      return d_
    })

    flushSync()
    expect(parent.querySelector('.spinner')).not.toBeNull()

    d1.resolve('first-value')
    await d1.promise
    flushSync()

    expect(parent.querySelector('.view')?.textContent).toBe('first-value')
    const viewNodeBefore = parent.querySelector('.view')

    // Trigger a refetch: source changes, loading flips true again, but data() still
    // holds 'first-value' until the new fetch settles.
    src.set('b')
    flushSync()

    // Still pending — but the view branch must remain mounted (not replaced by the
    // spinner), and it must be the SAME node — the "why it's free" claim in the guide.
    expect(parent.querySelector('.spinner')).toBeNull()
    const viewNodeDuringPending = parent.querySelector('.view')
    expect(viewNodeDuringPending === viewNodeBefore).toBe(true)
    expect(viewNodeDuringPending?.textContent).toBe('first-value')

    d2.resolve('second-value')
    await d2.promise
    flushSync()

    // New value naturally reflected once it settles. (Node identity across the
    // settle itself is not part of the "free" claim — data() genuinely changes
    // value here, so the condition's effect legitimately re-runs; the "free"
    // guarantee is specifically about the pending WINDOW, asserted above, where
    // r() provably does not change.)
    expect(parent.querySelector('.view')?.textContent).toBe('second-value')
    expect(parent.querySelector('.spinner')).toBeNull()

    dispose()
  })

  it('separate pending indicator: r.loading() drives its own binding without touching the view branch', async () => {
    const { doc, html } = setup()
    const d1 = deferred<string>()
    const d2 = deferred<string>()
    const src = signal('a')

    const parent = doc.createElement('div')
    doc.body.appendChild(parent)

    const dispose = createRoot((d_) => {
      const r = resource(
        () => src(),
        (s) => (s === 'a' ? d1.promise : d2.promise),
      )

      const ir = html`<div>
        ${iff(
          () => r() === undefined,
          () => html`<span class="spinner">loading</span>`,
          () => html`<span class="view">${() => r() ?? ''}</span>`,
        )}
        ${iff(
          () => r.loading(),
          () => html`<span class="refreshing">refreshing</span>`,
        )}
      </div>`

      mount(ir, parent, doc)
      return d_
    })

    flushSync()
    expect(parent.querySelector('.refreshing')).not.toBeNull() // initial load

    d1.resolve('first-value')
    await d1.promise
    flushSync()

    expect(parent.querySelector('.view')?.textContent).toBe('first-value')
    expect(parent.querySelector('.refreshing')).toBeNull()
    const viewNodeBefore = parent.querySelector('.view')

    src.set('b')
    flushSync()

    // The pending indicator appears, but the view branch is untouched — same node.
    expect(parent.querySelector('.refreshing')).not.toBeNull()
    expect(parent.querySelector('.view') === viewNodeBefore).toBe(true)
    expect(parent.querySelector('.view')?.textContent).toBe('first-value')

    d2.resolve('second-value')
    await d2.promise
    flushSync()

    expect(parent.querySelector('.refreshing')).toBeNull()
    expect(parent.querySelector('.view')?.textContent).toBe('second-value')

    dispose()
  })

  it('anti-pattern regression: compounding r.loading() into the branch condition rebuilds the view node on every refetch', async () => {
    const { doc, html } = setup()
    const d1 = deferred<string>()
    const d2 = deferred<string>()
    const src = signal('a')

    const parent = doc.createElement('div')
    doc.body.appendChild(parent)

    const dispose = createRoot((d_) => {
      const r = resource(
        () => src(),
        (s) => (s === 'a' ? d1.promise : d2.promise),
      )

      // Deliberately the pattern the guide warns against: r.loading() read
      // inside the branch condition.
      const ir = html`<div>${iff(
        () => r.loading() && r() === undefined,
        () => html`<span class="spinner">loading</span>`,
        () => html`<span class="view">${() => r() ?? ''}</span>`,
      )}</div>`

      mount(ir, parent, doc)
      return d_
    })

    flushSync()
    d1.resolve('first-value')
    await d1.promise
    flushSync()

    const viewNodeBefore = parent.querySelector('.view')
    expect(viewNodeBefore?.textContent).toBe('first-value')

    src.set('b')
    flushSync()

    // Content is still correct, but the node identity was NOT preserved —
    // this is the regression the guide's warning exists to prevent.
    const viewNodeDuringPending = parent.querySelector('.view')
    expect(viewNodeDuringPending?.textContent).toBe('first-value')
    expect(viewNodeDuringPending === viewNodeBefore).toBe(false)

    d2.resolve('second-value')
    await d2.promise
    flushSync()

    expect(parent.querySelector('.view')?.textContent).toBe('second-value')

    dispose()
  })
})
