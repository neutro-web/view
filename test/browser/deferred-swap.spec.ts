/**
 * Real-browser gates for `wireDeferredSwap` (tier-2 `<switch pending=>` / SWR
 * deferred swap). See docs/gates/pt1b-i-deferred-swap.md (Ruling 3, the full
 * algorithm + adversarial-pass reasoning) and
 * docs/superpowers/plans/2026-07-08-pt1b-i-deferred-swap.md (Task 5's exact
 * item list, renumbered 1-12 skipping 8/9/12 — see that plan for why).
 *
 * IR-construction choice: every test here builds IR in-page via
 * `window.__nv.createHtmlTag` / `window.__nv.match`, matching
 * `real-browser.spec.ts`'s convention, rather than authoring `.nv` fixture
 * files (see test/browser/fixtures/deferred-swap/README.md for the full
 * reasoning — controllable-resource + plain-signal wiring is far more
 * tractable as in-page JS closures than through `.nv`'s static surface, and
 * `wireDeferredSwap` itself is FE-agnostic so this loses no coverage of the
 * `.nv` front-end, which has its own dedicated parser tests).
 *
 * Controllable-resource pattern: `mkCtl(sourceFn)` below wraps
 * `nv.resource()` with a fetcher that never resolves on its own — instead it
 * pushes `{ resolve, reject }` onto a local `pend` array the test can drive
 * directly (`pend[i].resolve(v)` / `pend[i].reject(e)`), then a `flushSync()`
 * (after a microtask tick so the promise continuation has run) to observe
 * the result. This is invented for this task — no pre-existing "controllable
 * async" fixture was found under test/browser/fixtures/ (confirmed by
 * reading the directory before writing this).
 *
 * All construction + assertion logic for each test runs inside a single
 * `page.evaluate` call (real node identity / closures can't cross the
 * Playwright serialization boundary), returning only a serializable
 * `{ ok, findings }` — the same convention `real-browser.spec.ts` uses.
 */

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

// ── Item 1: Deferred reveal — identity-preserving + live during pending ──────

test('1. Deferred reveal — old subtree DOM identity preserved and live while pending', async ({
  page,
}) => {
  await loadNv(page)

  const result = await page.evaluate(async () => {
    const nv = window.__nv
    const findings: string[] = []
    const html = nv.createHtmlTag(document)
    const container = document.createElement('div')
    document.body.appendChild(container)

    function mkCtl(sourceFn: () => unknown) {
      const pend: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = []
      const r = nv.resource(
        sourceFn,
        () => new Promise((resolve, reject) => pend.push({ resolve, reject })),
      )
      return { r, pend }
    }

    let dispose: () => void = () => {}
    const src = nv.signal(0)
    const tick = nv.signal(0)
    const { r, pend } = ((): ReturnType<typeof mkCtl> => {
      let out!: ReturnType<typeof mkCtl>
      dispose = nv.createRoot((d) => {
        out = mkCtl(() => src())
        const ir = html`<div>${nv.match(
          [{ when: () => true, body: () => html`<span class="live">t${() => tick()}</span>` }],
          null,
          () => out.r.loading(),
        )}</div>`
        nv.mount(ir, container, document)
        return d
      })
      return out
    })()
    // `container`'s own child is the permanent wrapping <div> the IR mounts into
    // (unconditionally present, not part of what the binding reveals/hides) —
    // `region` is that div; "nothing revealed" checks must look INSIDE it.
    const region = container.querySelector('div') as HTMLElement

    nv.flushSync()
    // First fetch still in flight: nothing revealed yet (item 6's invariant, checked here too).
    if (region.childElementCount !== 0)
      findings.push(`expected nothing mounted before first settle, got ${region.innerHTML}`)

    pend[0]!.resolve('v0')
    await Promise.resolve()
    nv.flushSync()

    const spanA = container.querySelector('.live')
    if (spanA === null) {
      findings.push('expected .live after first settle')
      return { ok: false, findings }
    }
    if (spanA.textContent !== 't0') findings.push(`expected 't0', got '${spanA.textContent}'`)

    // Trigger a refetch — enters the pending window.
    src.set(1)
    nv.flushSync()
    if (!r.loading()) findings.push('expected r.loading() true after src change')
    if (container.querySelector('.live') !== spanA)
      findings.push(
        `old subtree DOM node identity changed merely by entering the pending window; region=${region.innerHTML}`,
      )

    // Old subtree must still be LIVE while pending (its own effect still runs).
    tick.set(5)
    nv.flushSync()
    if (container.querySelector('.live')?.textContent !== 't5')
      findings.push('old subtree text did not update while pending — not actually live')
    if (container.querySelector('.live') !== spanA)
      findings.push('old subtree DOM node identity changed after a live update while pending')

    // Settle — same branch wins again, so this exercises the no-op path, not a rebuild.
    pend[1]!.resolve('v1')
    await Promise.resolve()
    nv.flushSync()
    const spanAfter = container.querySelector('.live')
    if (spanAfter !== spanA)
      findings.push('node identity changed after settle even though the same branch won again')
    if (spanAfter?.textContent !== 't5') findings.push('lost live state (local text) after settle')

    dispose()
    container.remove()
    return { ok: findings.length === 0, findings }
  })

  expect(result.ok, result.findings.join('\n')).toBe(true)
})

// ── Item 2: Atomic swap on settle — MutationObserver over the full sequence ──

test('2. Atomic swap on settle — no mutation-sequence frame has NEITHER branch attached', async ({
  page,
}) => {
  await loadNv(page)

  const result = await page.evaluate(async () => {
    const nv = window.__nv
    const findings: string[] = []
    const html = nv.createHtmlTag(document)
    const container = document.createElement('div')
    document.body.appendChild(container)

    function mkCtl(sourceFn: () => unknown) {
      const pend: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = []
      const r = nv.resource(
        sourceFn,
        () => new Promise((resolve, reject) => pend.push({ resolve, reject })),
      )
      return { r, pend }
    }

    const src = nv.signal(0)
    let r!: ReturnType<typeof mkCtl>['r']
    let pend!: ReturnType<typeof mkCtl>['pend']
    const dispose = nv.createRoot((d) => {
      const ctl = mkCtl(() => src())
      r = ctl.r
      pend = ctl.pend
      const ir = html`<div>${nv.match(
        [
          { when: () => r() === 0, body: () => html`<span class="a">A</span>` },
          { when: () => r() === 1, body: () => html`<span class="b">B</span>` },
        ],
        null,
        () => r.loading(),
      )}</div>`
      nv.mount(ir, container, document)
      return d
    })
    // The wrapping <div> (container's permanent child) is what actually gains/
    // loses branch children — observe IT, not `container` (whose own childList
    // never changes after the initial mount).
    const region = container.querySelector('div') as HTMLElement

    // Record every childList mutation on the region across the whole run.
    const records: { added: string[]; removed: string[] }[] = []
    const observer = new MutationObserver(() => {
      // Intentionally unused — we pull via takeRecords() synchronously below,
      // which does not require waiting for the callback microtask to fire.
    })
    observer.observe(region, { childList: true })

    function drain() {
      for (const rec of observer.takeRecords()) {
        records.push({
          added: Array.from(rec.addedNodes).map((n) => (n as Element).className ?? ''),
          removed: Array.from(rec.removedNodes).map((n) => (n as Element).className ?? ''),
        })
      }
    }

    nv.flushSync()
    drain() // first fetch pending: no mutation yet

    pend[0]!.resolve(0)
    await Promise.resolve()
    nv.flushSync()
    drain() // reveal 'a'

    src.set(1)
    nv.flushSync()
    drain() // pending window — must be silent (no mutation while held)

    pend[1]!.resolve(1)
    await Promise.resolve()
    nv.flushSync()
    drain() // atomic swap a → b

    // Replay the mutation sequence, tracking which classes are attached at each point.
    //
    // Only "neither attached" is checked as a failure. wireDeferredSwap inserts
    // the new branch's roots BEFORE disposing the old ones (interpreter.ts,
    // "Construction succeeded" comment) specifically so a visible content gap
    // is impossible — but for a multi-root swap, moving N new nodes in and M
    // old nodes out is inherently a SEQUENCE of discrete DOM calls; there is no
    // single native DOM API that atomically swaps an arbitrary N-root set for
    // an arbitrary M-root set (short of wrapping every branch in an extra
    // container element, which this codebase's mountFragment deliberately does
    // NOT do — multi-root templates are first-class, no wrapper). So a
    // transient "both attached" MutationRecord between the insert calls and
    // the dispose calls is real, unavoidable without a wrapper, and — the
    // actually load-bearing point — INVISIBLE to the user: all of this happens
    // synchronously within one effect run, before the browser ever gets a
    // chance to paint. MutationObserver records are finer-grained than paint
    // frames; asserting against "both" here would be asserting against
    // something no user ever sees, at the cost of real complexity (a second
    // staging buffer) for zero visible benefit. Found and corrected during
    // Task 5 (an earlier draft flagged "both" as a failure too and was wrong
    // to; see the plan's Task 5 Pass 6 note).
    const attached = new Set<string>()
    let everRevealed = false
    for (const rec of records) {
      for (const c of rec.removed) attached.delete(c)
      for (const c of rec.added) attached.add(c)
      const hasA = attached.has('a')
      const hasB = attached.has('b')
      if (hasA) everRevealed = true
      if (hasB) everRevealed = true
      if (everRevealed && !hasA && !hasB)
        findings.push('mutation frame has NEITHER branch attached after something was revealed')
    }
    if (!attached.has('b'))
      findings.push(`expected final state to be branch 'b', attached=${[...attached]}`)
    if (attached.has('a')) findings.push(`expected branch 'a' to be gone from final state`)
    if (records.length === 0)
      findings.push('no mutations recorded at all — observer wiring is broken')

    observer.disconnect()
    dispose()
    container.remove()
    return { ok: findings.length === 0, findings, recordCount: records.length }
  })

  expect(result.ok, `${result.findings.join('\n')}\n(records: ${result.recordCount})`).toBe(true)
})

// ── Item 3: Supersession — resource's own epoch guard, observed through the binding ──

test('3. Supersession — only the final source value is ever revealed; intermediate value never attaches', async ({
  page,
}) => {
  await loadNv(page)

  const result = await page.evaluate(async () => {
    const nv = window.__nv
    const findings: string[] = []
    const html = nv.createHtmlTag(document)
    const container = document.createElement('div')
    document.body.appendChild(container)

    function mkCtl(sourceFn: () => unknown) {
      const pend: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = []
      const r = nv.resource(
        sourceFn,
        () => new Promise((resolve, reject) => pend.push({ resolve, reject })),
      )
      return { r, pend }
    }

    const src = nv.signal(0)
    let r!: ReturnType<typeof mkCtl>['r']
    let pend!: ReturnType<typeof mkCtl>['pend']
    const dispose = nv.createRoot((d) => {
      const ctl = mkCtl(() => src())
      r = ctl.r
      pend = ctl.pend
      // Branch selection reflects resource's resolved value directly (echo fetcher).
      // NOTE: this test exercises resource's OWN epoch/staleness guarantee
      // (resource.ts: only the latest `gen === epoch` fetch's .then can ever
      // write `data`) AS OBSERVED through wireDeferredSwap — wireDeferredSwap
      // has no epoch counter of its own (Gate-P Ruling 3). The intermediate
      // value (1) below is never observed because resource silently drops
      // the stale continuation, not because of any mount-layer mechanism.
      const ir = html`<div>${nv.match(
        [
          { when: () => r() === 0, body: () => html`<span class="v0">0</span>` },
          { when: () => r() === 1, body: () => html`<span class="v1">1</span>` },
          { when: () => r() === 2, body: () => html`<span class="v2">2</span>` },
        ],
        null,
        () => r.loading(),
      )}</div>`
      nv.mount(ir, container, document)
      return d
    })
    const region = container.querySelector('div') as HTMLElement

    const records: { added: string[]; removed: string[] }[] = []
    const observer = new MutationObserver(() => {})
    observer.observe(region, { childList: true })
    function drain() {
      for (const rec of observer.takeRecords()) {
        records.push({
          added: Array.from(rec.addedNodes).map((n) => (n as Element).className ?? ''),
          removed: Array.from(rec.removedNodes).map((n) => (n as Element).className ?? ''),
        })
      }
    }

    nv.flushSync()
    pend[0]!.resolve(0) // settle initial fetch (v=0)
    await Promise.resolve()
    nv.flushSync()
    drain()
    if (container.querySelector('.v0') === null)
      findings.push('expected v0 revealed after initial settle')

    // Two source changes in quick succession while the first refetch is still pending.
    src.set(1)
    nv.flushSync()
    src.set(2)
    nv.flushSync()
    drain() // both still pending — nothing should have moved

    // Resolve OUT OF ORDER: settle the newest (gen for src=2) FIRST...
    pend[2]!.resolve(2)
    await Promise.resolve()
    nv.flushSync()
    drain()
    // ...then the stale one (gen for src=1) — resource's epoch guard must drop this no-op.
    pend[1]!.resolve(1)
    await Promise.resolve()
    nv.flushSync()
    drain()

    const everAddedV1 = records.some((rec) => rec.added.includes('v1'))
    if (everAddedV1)
      findings.push(
        'intermediate value (v1) attached to the DOM at some point — should NEVER attach',
      )
    if (container.querySelector('.v2') === null)
      findings.push('expected final revealed branch to be v2')
    if (region.childElementCount !== 1)
      findings.push(`expected exactly 1 revealed element, got ${region.childElementCount}`)

    observer.disconnect()
    dispose()
    container.remove()
    return { ok: findings.length === 0, findings }
  })

  expect(result.ok, result.findings.join('\n')).toBe(true)
})

// ── Item 4: Dual disposal on teardown mid-pending ─────────────────────────────

test('4. Dispose mid-pending — old subtree fully torn down, no staged-fragment leak', async ({
  page,
}) => {
  await loadNv(page)

  const result = await page.evaluate(async () => {
    const nv = window.__nv
    const findings: string[] = []
    const html = nv.createHtmlTag(document)
    const container = document.createElement('div')
    document.body.appendChild(container)

    function mkCtl(sourceFn: () => unknown) {
      const pend: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = []
      const r = nv.resource(
        sourceFn,
        () => new Promise((resolve, reject) => pend.push({ resolve, reject })),
      )
      return { r, pend }
    }

    const src = nv.signal(0)
    let r!: ReturnType<typeof mkCtl>['r']
    let pend!: ReturnType<typeof mkCtl>['pend']
    const dispose = nv.createRoot((d) => {
      const ctl = mkCtl(() => src())
      r = ctl.r
      pend = ctl.pend
      const ir = html`<div>${nv.match(
        [{ when: () => true, body: () => html`<span class="only">only</span>` }],
        null,
        () => r.loading(),
      )}</div>`
      nv.mount(ir, container, document)
      return d
    })

    nv.flushSync()
    pend[0]!.resolve('x')
    await Promise.resolve()
    nv.flushSync()

    const span = container.querySelector('.only')
    if (span === null) {
      findings.push('expected .only mounted after first settle')
      return { ok: false, findings }
    }

    // Start a refetch — enters pending — then dispose BEFORE it settles.
    src.set(1)
    nv.flushSync()
    if (!r.loading()) findings.push('expected loading() true (pending window) before dispose')

    dispose()

    if (span.isConnected)
      findings.push('old subtree node still connected to the document after dispose')
    if (container.childElementCount !== 0)
      findings.push(
        `expected container empty after dispose, got ${container.childElementCount} children`,
      )
    // No staging DocumentFragment is ever created until pending() reads false (Ruling 3) —
    // trivially true here since we never got there, but assert the observable consequence
    // (no orphaned nodes anywhere in the document from this test) rather than just assuming it.
    if (document.querySelectorAll('.only').length !== 0)
      findings.push('a copy of .only leaked somewhere in the document after dispose')

    container.remove()
    return { ok: findings.length === 0, findings }
  })

  expect(result.ok, result.findings.join('\n')).toBe(true)
})

// ── Item 5a: Rejected refetch — free no-op, no swap, error observable ────────

test('5a. Rejected refetch — old subtree stays mounted (same identity), error() reflects rejection, no swap', async ({
  page,
}) => {
  await loadNv(page)

  const result = await page.evaluate(async () => {
    const nv = window.__nv
    const findings: string[] = []
    const html = nv.createHtmlTag(document)
    const container = document.createElement('div')
    document.body.appendChild(container)

    function mkCtl(sourceFn: () => unknown) {
      const pend: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = []
      const r = nv.resource(
        sourceFn,
        () => new Promise((resolve, reject) => pend.push({ resolve, reject })),
      )
      return { r, pend }
    }

    const src = nv.signal(0)
    let r!: ReturnType<typeof mkCtl>['r']
    let pend!: ReturnType<typeof mkCtl>['pend']
    const dispose = nv.createRoot((d) => {
      const ctl = mkCtl(() => src())
      r = ctl.r
      pend = ctl.pend
      const ir = html`<div>${nv.match(
        [{ when: () => true, body: () => html`<span class="only">only</span>` }],
        null,
        () => r.loading(),
      )}</div>`
      nv.mount(ir, container, document)
      return d
    })

    nv.flushSync()
    pend[0]!.resolve('ok')
    await Promise.resolve()
    nv.flushSync()

    const spanBefore = container.querySelector('.only')
    if (spanBefore === null) {
      findings.push('expected .only mounted after first settle')
      return { ok: false, findings }
    }

    src.set(1)
    nv.flushSync()
    // Reject the refetch. Per resource.ts, `data()` is intentionally left
    // unchanged on rejection — the deferred-swap binding's when()s resolve
    // to the SAME winner, so `winner === revealed` no-ops for free (Gate-P
    // Ruling 3 pass 2). No special-case code exists for this in
    // wireDeferredSwap; this test locks that in.
    pend[1]!.reject(new Error('fetch-rejected'))
    await Promise.resolve()
    nv.flushSync()

    if (r.loading()) findings.push('expected loading() false after rejection settles')
    const errVal = r.error()
    if (!(errVal instanceof Error) || errVal.message !== 'fetch-rejected')
      findings.push(`expected r.error() to reflect the rejection, got ${String(errVal)}`)

    const spanAfter = container.querySelector('.only')
    if (spanAfter !== spanBefore)
      findings.push('old subtree node identity changed after a rejected refetch')
    const region5a = container.querySelector('div') as HTMLElement
    if (region5a.childElementCount !== 1)
      findings.push(
        `expected exactly 1 element (no orphan/duplicate), got ${region5a.childElementCount}`,
      )

    dispose()
    container.remove()
    return { ok: findings.length === 0, findings }
  })

  expect(result.ok, result.findings.join('\n')).toBe(true)
})

// ── Item 5b: Construction throw — rethrown via errorBoundary, old subtree survives ──

test('5b. Construction throw in the new branch — old subtree stays mounted and live; error routes to errorBoundary', async ({
  page,
}) => {
  await loadNv(page)

  const result = await page.evaluate(async () => {
    const nv = window.__nv
    const findings: string[] = []
    const html = nv.createHtmlTag(document)
    const container = document.createElement('div')
    document.body.appendChild(container)

    const state = nv.signal(0)
    const tick = nv.signal(0)
    const errors: unknown[] = []

    // Fault injection: an EMPTY template (`html``) is a deterministic, fully
    // SYNCHRONOUS throw inside mountFragment itself ("Template produced an
    // empty fragment", interpreter.ts ~line 1223) — confirmed by reading the
    // source: mountFragment throws this synchronously, inline, before any
    // effect() it creates would even be scheduled, so it surfaces INSIDE
    // wireDeferredSwap's `try { createRoot(...) }` block, not via a deferred
    // effect elsewhere. (A text-binding-throws-on-read fault would instead
    // surface later, via a separately-scheduled effect routed independently
    // by flushAll's per-effect try/catch — NOT inside wireDeferredSwap's own
    // try/catch — so it would not exercise the capture-dispose-first
    // throw-safety guard this test targets.)
    let dispose: () => void = () => {}
    nv.errorBoundary(
      (e) => errors.push(e),
      () => {
        dispose = nv.createRoot((d) => {
          const ir = html`<div>${nv.match(
            [
              {
                when: () => state() === 0,
                body: () => html`<span class="a">${() => `t${tick()}`}</span>`,
              },
              { when: () => state() === 1, body: () => html`` },
            ],
            null,
            () => false, // never pending — swap attempted immediately on winner change
          )}</div>`
          nv.mount(ir, container, document)
          return d
        })
      },
    )

    nv.flushSync()
    const spanA = container.querySelector('.a')
    if (spanA === null) {
      findings.push('expected .a mounted initially')
      return { ok: false, findings }
    }

    state.set(1) // selects the throwing (empty-template) branch
    nv.flushSync()

    if (errors.length === 0)
      findings.push('expected the construction throw to route to errorBoundary')
    else {
      const msg = String((errors[0] as Error)?.message ?? errors[0])
      if (!/empty fragment/i.test(msg)) findings.push(`unexpected error message: ${msg}`)
    }

    // Old subtree must still be mounted, same identity, AND live.
    if (container.querySelector('.a') !== spanA)
      findings.push(
        'old subtree node identity changed after a construction throw in the new branch',
      )
    tick.set(7)
    nv.flushSync()
    if (container.querySelector('.a')?.textContent !== 't7')
      findings.push('old subtree stopped being live after a construction throw in the new branch')
    const region5b = container.querySelector('div') as HTMLElement
    if (region5b.childElementCount !== 1)
      findings.push(
        `expected no partial/orphaned new-branch nodes, got ${region5b.childElementCount} children`,
      )

    dispose()
    container.remove()
    return { ok: findings.length === 0, findings, errorCount: errors.length }
  })

  expect(result.ok, `${result.findings.join('\n')}\n(errors: ${result.errorCount})`).toBe(true)
})

// ── Item 6: First-load pending renders nothing (not even fallback) ───────────

test('6. First-load pending renders nothing — no fallback either, until first settle', async ({
  page,
}) => {
  await loadNv(page)

  const result = await page.evaluate(async () => {
    const nv = window.__nv
    const findings: string[] = []
    const html = nv.createHtmlTag(document)
    const container = document.createElement('div')
    document.body.appendChild(container)

    function mkCtl(sourceFn: () => unknown) {
      const pend: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = []
      const r = nv.resource(
        sourceFn,
        () => new Promise((resolve, reject) => pend.push({ resolve, reject })),
      )
      return { r, pend }
    }

    const src = nv.signal(0)
    let r!: ReturnType<typeof mkCtl>['r']
    let pend!: ReturnType<typeof mkCtl>['pend']
    const dispose = nv.createRoot((d) => {
      const ctl = mkCtl(() => src())
      r = ctl.r
      pend = ctl.pend
      const ir = html`<div>${nv.match(
        [{ when: () => r() === 0, body: () => html`<span class="a">A</span>` }],
        () => html`<span class="fb">FB</span>`, // fallback present — must still not show
        () => r.loading(),
      )}</div>`
      nv.mount(ir, container, document)
      return d
    })
    const region = container.querySelector('div') as HTMLElement

    nv.flushSync()
    if (region.childElementCount !== 0)
      findings.push(
        `expected childElementCount 0 before first settle, got ${region.childElementCount}`,
      )
    if ((region.textContent ?? '') !== '')
      findings.push(`expected empty textContent before first settle, got '${region.textContent}'`)
    if (region.querySelector('.fb') !== null)
      findings.push('fallback rendered during first-load pending')

    pend[0]!.resolve(0)
    await Promise.resolve()
    nv.flushSync()
    if (container.querySelector('.a') === null)
      findings.push('expected .a revealed after first settle')

    dispose()
    container.remove()
    return { ok: findings.length === 0, findings }
  })

  expect(result.ok, result.findings.join('\n')).toBe(true)
})

// ── Item 7a: Dependency-collection regression — when()-driving signal changes WHILE pending ──

test('7a. An independent when()-driving signal changed WHILE pending is correctly observed at settle', async ({
  page,
}) => {
  await loadNv(page)

  const result = await page.evaluate(async () => {
    const nv = window.__nv
    const findings: string[] = []
    const html = nv.createHtmlTag(document)
    const container = document.createElement('div')
    document.body.appendChild(container)

    function mkCtl(sourceFn: () => unknown) {
      const pend: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = []
      const r = nv.resource(
        sourceFn,
        () => new Promise((resolve, reject) => pend.push({ resolve, reject })),
      )
      return { r, pend }
    }

    // `toggle` is a plain signal completely UNRELATED to the resource — a
    // filter-toggle style signal a later branch's when() reads. This is the
    // direct regression test for the dependency-collection bug fixed in
    // Gate-P Ruling 3 pass 4: the original draft gated `pending()` BEFORE
    // reading any `when()`, which unsubscribes the effect from every
    // when() for the duration of a pending run — a broken implementation
    // built that way would (per this repo's own analysis in the gate doc)
    // still recover on THIS specific settle-triggered re-run because the
    // winner loop always executes fresh once `pending()` reads false
    // regardless of prior subscription state; this test locks in the
    // CORRECT behavior either way, and is the literal scenario item 7a of
    // the plan specifies.
    const src = nv.signal(0)
    const toggle = nv.signal(false)
    let r!: ReturnType<typeof mkCtl>['r']
    let pend!: ReturnType<typeof mkCtl>['pend']
    const dispose = nv.createRoot((d) => {
      const ctl = mkCtl(() => src())
      r = ctl.r
      pend = ctl.pend
      const ir = html`<div>${nv.match(
        [
          { when: () => !toggle(), body: () => html`<span class="a">A</span>` },
          { when: () => toggle(), body: () => html`<span class="b">B</span>` },
        ],
        null,
        () => r.loading(),
      )}</div>`
      nv.mount(ir, container, document)
      return d
    })

    nv.flushSync()
    pend[0]!.resolve('x') // initial settle: toggle=false → branch 'a'
    await Promise.resolve()
    nv.flushSync()
    const spanA = container.querySelector('.a')
    if (spanA === null) {
      findings.push("expected branch 'a' revealed initially")
      return { ok: false, findings }
    }

    // Enter a pending window (unrelated to `toggle`).
    src.set(1)
    nv.flushSync()
    if (!r.loading()) findings.push('expected pending window (loading true) before toggle change')
    if (container.querySelector('.a') !== spanA)
      findings.push('old subtree identity changed merely by pending')

    // Change the INDEPENDENT when()-driving signal WHILE pending is observably true.
    toggle.set(true)
    nv.flushSync()
    // Still pending — must NOT have swapped yet.
    if (container.querySelector('.a') !== spanA)
      findings.push("swapped away from 'a' while still pending — pending gate not honored")

    // Settle — the LATEST toggle state (true → branch 'b') must be what's revealed,
    // not a stale winner computed from toggle's pre-change (false) state.
    pend[1]!.resolve('x')
    await Promise.resolve()
    nv.flushSync()
    if (r.loading()) findings.push('expected loading() false after settle')
    const spanB = container.querySelector('.b')
    if (spanB === null)
      findings.push("expected branch 'b' revealed after settle (latest toggle state)")
    if (container.querySelector('.a') !== null)
      findings.push("stale branch 'a' still present after settle")
    const region7a = container.querySelector('div') as HTMLElement
    if (region7a.childElementCount !== 1)
      findings.push(`expected exactly 1 revealed element, got ${region7a.childElementCount}`)

    dispose()
    container.remove()
    return { ok: findings.length === 0, findings }
  })

  expect(result.ok, result.findings.join('\n')).toBe(true)
})

// ── Item 7b: `pending` boolean does not reliably toggle across a settle ──────

test("7b. pending()'s boolean value unchanged across a settle (loading DID flip) — swap still correct once pending() actually reads false", async ({
  page,
}) => {
  await loadNv(page)

  const result = await page.evaluate(async () => {
    const nv = window.__nv
    const findings: string[] = []
    const html = nv.createHtmlTag(document)
    const container = document.createElement('div')
    document.body.appendChild(container)

    function mkCtl(sourceFn: () => unknown) {
      const pend: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = []
      const r = nv.resource(
        sourceFn,
        () => new Promise((resolve, reject) => pend.push({ resolve, reject })),
      )
      return { r, pend }
    }

    // `pending` is sourced from a signal fully DECOUPLED from resource()'s own
    // `loading()` — proving correctness doesn't depend on `loading()` being
    // the thing that toggles, only on `pending()`'s own boolean value. Each
    // write below happens in its OWN separated flush (never combined with
    // another independent write in the same synchronous window) — nv's
    // scheduler does not auto-batch two independently-scheduled writes into
    // one atomic recompute (confirmed via a minimal repro during this task:
    // a synchronous signal write plus a later promise-continuation write to a
    // DIFFERENT signal can produce two separate glitchy recomputes instead of
    // one consistent one; this is a general core-scheduler property, not a
    // wireDeferredSwap-specific bug, and fixing it would need a `batch()` API
    // — src/core/ is G0-protected, out of scope here). This test is
    // constructed to exercise item 7b's actual intent (pending doesn't need
    // to correlate with loading()'s own transitions) without also tripping
    // that unrelated scheduling question — see the plan's Task 5 Pass 6 note.
    const src = nv.signal(0)
    const customPending = nv.signal(true)
    const branch = nv.signal(0)
    let r!: ReturnType<typeof mkCtl>['r']
    let pend!: ReturnType<typeof mkCtl>['pend']
    const dispose = nv.createRoot((d) => {
      const ctl = mkCtl(() => src())
      r = ctl.r
      pend = ctl.pend
      const ir = html`<div>${nv.match(
        [
          { when: () => branch() === 0, body: () => html`<span class="a">A</span>` },
          { when: () => branch() === 1, body: () => html`<span class="b">B</span>` },
        ],
        null,
        () => customPending(),
      )}</div>`
      nv.mount(ir, container, document)
      return d
    })
    const region = container.querySelector('div') as HTMLElement

    // Mount with customPending=true from the start: nothing reveals, even
    // though the underlying fetch hasn't even been triggered by anything
    // pending-related here.
    nv.flushSync()
    if (region.childElementCount !== 0)
      findings.push('expected nothing mounted while customPending=true')

    // Let the underlying resource fully settle — loading() flips true→false —
    // while customPending stays true throughout (its own, unrelated signal).
    pend[0]!.resolve('x')
    await Promise.resolve()
    nv.flushSync()
    if (r.loading()) findings.push('expected loading() false after settling the fetch')
    if (region.childElementCount !== 0)
      findings.push(
        `pending() should still read true (customPending unchanged, loading() flipping is irrelevant) — expected nothing revealed yet, got ${region.childElementCount} children`,
      )

    // Now actually release the gate: flip customPending false, in its OWN
    // separate flush. loading() is already false and does NOT change here —
    // proving correctness depends solely on pending() reading false, not on
    // any correlation with loading()'s own transitions.
    customPending.set(false)
    nv.flushSync()
    if (region.querySelector('.a') === null)
      findings.push("expected branch 'a' revealed once pending() actually reads false")
    if (region.childElementCount !== 1)
      findings.push(`expected exactly 1 revealed element, got ${region.childElementCount}`)

    // Sanity: the swap mechanism still works normally after this — change
    // branch while non-pending (customPending stays false); should swap immediately.
    branch.set(1)
    nv.flushSync()
    if (container.querySelector('.b') === null)
      findings.push("expected branch 'b' after branch signal change")

    dispose()
    container.remove()
    return { ok: findings.length === 0, findings }
  })

  expect(result.ok, result.findings.join('\n')).toBe(true)
})
