/**
 * FE-equivalence for DeferredSwapBinding (Gate-P pt1b-i, Task 5 item 8/9).
 *
 * Existing coverage before this file:
 *  - test/renderer/nv-parser.test.ts (~line 1484) asserts the `.nv` FE alone
 *    parses `<switch pending=>` into a `DeferredSwapBinding` with the right
 *    branches/fallback/pending shape (Task 3's own tests).
 *  - test/renderer/html-tag.test.ts has NO test at all for `match()`'s
 *    `pending` third argument (grepped — zero hits for "pending" in that
 *    file), so Task 2's own suite does not gate the tagged-template FE.
 *  - ir-equivalence.ts's `bindingEqual` switch had no `'deferred-swap'` case
 *    (grepped) — a deferred-swap binding compared through the shared oracle
 *    would silently short-circuit to "equal" after only the `kind` check,
 *    never comparing branches/fallback/pending. This is the actual gap:
 *    neither FE's own suite cross-checks against the other, and the shared
 *    oracle couldn't have caught a divergence even if a test called it.
 *
 * Fix applied (both parts needed together, item 8 in the Task 5 brief):
 *  1. Added a `'deferred-swap'` case to `bindingEqual` in ir-equivalence.ts,
 *     mirroring the existing `'switch'` case plus a presence check on
 *     `pending` (see that file for the full reasoning).
 *  2. This file: build the SAME `<switch pending=>` shape via both FEs
 *     (`.nv` parse and `match(branches, fallback, pending)` tagged-template)
 *     and assert they are structurally identical through the now-complete
 *     oracle.
 *
 * Pure IR-shape comparison, no real-DOM timing question — JSDOM/vitest is
 * sufficient here per the Task 5 brief (item 8's own carve-out).
 */
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { signal } from '../../src/core/core.js'
import { createHtmlTag, match } from '../../src/renderer/html-tag.js'
import { parseNvFile } from '../../src/renderer/nv-parser.js'
import { irStructurallyEqual } from './ir-equivalence.js'

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>')
  return { doc: dom.window.document }
}

describe('DeferredSwapBinding — FE-equivalence (.nv vs tagged-template)', () => {
  it('<switch pending=> and match(branches, fallback, pending) produce structurally identical IR', () => {
    const { doc } = setup()
    const html = createHtmlTag(doc)

    const src = `
      const C = $component(() => {
        $script(() => { const state = signal(0); const p = signal(false) })
        $render(() => html\`<div><switch pending="\${p}">
          <match when="\${state === 0}"><span>A</span></match>
          <match when="\${state === 1}"><span>B</span></match>
          <match><span>C</span></match>
        </switch></div>\`)
      })
    `
    const results = parseNvFile(src, 'switch-pending-fe.nv', doc)
    const nvIr = results[0]!.ir

    // Tagged-template equivalent, built with independently-created signals
    // (structural shape must match regardless of signal identity). Follows
    // the exact fixture shape of the plain-switch FE-equivalence gate at
    // html-tag.test.ts:188 ("G1 FE-equivalence"), plus the `pending` arg.
    const state = signal(0)
    const p = signal(false)
    const ttIr = html`<div>${match(
      [
        { when: () => state() === 0, body: () => html`<span>A</span>` },
        { when: () => state() === 1, body: () => html`<span>B</span>` },
      ],
      () => html`<span>C</span>`,
      () => p(),
    )}</div>`

    const res = irStructurallyEqual(doc, nvIr, ttIr)
    expect(res.equal, res.reason).toBe(true)

    // Sanity: both really did produce deferred-swap, not a plain switch —
    // guards against the comparison passing vacuously because both sides
    // degraded to 'switch' due to a parser/builder regression.
    const nvBinding = nvIr.bindings.find((b) => b.kind === 'deferred-swap' || b.kind === 'switch')
    const ttBinding = ttIr.bindings.find((b) => b.kind === 'deferred-swap' || b.kind === 'switch')
    expect(nvBinding?.kind).toBe('deferred-swap')
    expect(ttBinding?.kind).toBe('deferred-swap')
  })
})
