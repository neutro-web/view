/**
 * §12.24 — Owner-context capture / redirection (getOwner / runWithOwner).
 * Contract: nv-reactive-core-contract.md v0.4.2 §6.1, §12 item 24.
 *
 * DOM-free core conformance for the owner-context utilities added in v0.4.2.
 * Pins, directly in the core suite, the two guarantees §6.1 asserts (previously
 * covered only transitively by the renderer ListBinding TC-10 suite):
 *   (a) ownership redirection — a scope created under a captured owner survives
 *       the creating effect's re-run, and is disposed with the captured owner;
 *   (b) observation-neutrality — a tracked read inside runWithOwner still binds
 *       to the CURRENT observer, not the redirected owner;
 *   (c) the runWithOwner(null) detach affordance.
 *
 * Probe: observerCount(s) on a signal the innermost scope reads. The owner tree
 * is not directly inspectable through the public surface, so ownership is proven
 * behaviorally via what disposal does (and does not) sever.
 */

import { expect, test } from 'vitest'
import {
  __test,
  createRoot,
  effect,
  flushSync,
  getOwner,
  runWithOwner,
  signal,
} from '../../src/core/core.js'

// ── 24a: ownership redirection (the ListBinding trap, distilled to the core) ──

test('§12.24a  runWithOwner redirects ownership: scope under a captured owner survives the creating effect re-running', () => {
  const s = signal(0) // inner scope reads this; observerCount(s) is the probe
  const trigger = signal(0) // re-runs the outer effect

  let capturedOwner: ReturnType<typeof getOwner> = null
  let innerCreated = false

  const disposeRoot = createRoot((dispose) => {
    capturedOwner = getOwner() // the root scope

    effect(() => {
      trigger() // subscribe so the effect re-runs on trigger change
      if (!innerCreated) {
        innerCreated = true
        // Create the inner scope under the CAPTURED owner (the root),
        // not under this effect.
        runWithOwner(capturedOwner, () =>
          createRoot((d) => {
            effect(() => {
              s() // inner effect subscribes to s
            })
            return d
          }),
        )
      }
    })
    return dispose
  })

  flushSync()
  expect(__test.observerCount(s), 'inner effect subscribed to s').toBe(1)

  // Re-run the outer effect. If the inner scope were owned by the outer effect,
  // preRunCleanup would dispose it here and observerCount(s) would drop to 0.
  trigger.set(1)
  flushSync()
  expect(
    __test.observerCount(s),
    'inner scope survived outer effect re-run (owned by root, not the effect)',
  ).toBe(1)

  // Disposing the captured root disposes the inner scope → proves the root owns it.
  disposeRoot()
  expect(
    __test.observerCount(s),
    'inner scope disposed when its true owner (the root) is disposed',
  ).toBe(0)
})

// ── 24a-control: WITHOUT runWithOwner, the scope is destroyed on re-run (the bug) ──

test('§12.24a-control  without runWithOwner: scope created directly in an effect is destroyed on the effect re-running', () => {
  const s = signal(0)
  const trigger = signal(0)
  let innerCreated = false

  const disposeRoot = createRoot((dispose) => {
    effect(() => {
      trigger()
      if (!innerCreated) {
        innerCreated = true
        // No runWithOwner: inner scope is parented to THIS effect.
        createRoot((d) => {
          effect(() => {
            s()
          })
          return d
        })
      }
    })
    return dispose
  })

  flushSync()
  expect(__test.observerCount(s), 'inner effect subscribed').toBe(1)

  trigger.set(1)
  flushSync()
  // preRunCleanup(outer effect) disposed the inner scope before this re-run —
  // the exact full-rebuild trap runWithOwner avoids in the ListBinding reconciler.
  expect(__test.observerCount(s), 'inner scope destroyed by outer effect re-run (the trap)').toBe(0)

  disposeRoot()
})

// ── 24b: observation-neutrality ────────────────────────────────────────────

test('§12.24b  runWithOwner is observation-neutral: a tracked read inside it binds to the current observer, not the redirected owner', () => {
  const s = signal(0)
  let runs = 0

  let otherOwner: ReturnType<typeof getOwner> = null
  const disposeOther = createRoot((d) => {
    otherOwner = getOwner() // a standalone owner to redirect to
    return d
  })

  const disposeMain = createRoot((dispose) => {
    effect(() => {
      runs++
      // Read s through runWithOwner(otherOwner, ...). runWithOwner swaps the OWNER
      // context only; currentObserver stays this effect, so the read must subscribe
      // THIS effect to s — the direct proof the owner swap leaves tracking untouched.
      runWithOwner(otherOwner, () => {
        s()
      })
    })
    return dispose
  })

  flushSync()
  expect(runs, 'effect ran once').toBe(1)
  expect(
    __test.observerCount(s),
    's observed by the effect (read registered against current observer despite owner swap)',
  ).toBe(1)

  // The behavioral proof: writing s re-runs the effect. If runWithOwner had
  // diverted or suppressed tracking, the effect would not be subscribed.
  s.set(1)
  flushSync()
  expect(runs, 'effect re-ran on s change → tracking preserved through runWithOwner').toBe(2)

  // And the subscription belongs to the effect, not otherOwner: disposing
  // otherOwner does not touch the edge (ownership ⊥ observation).
  disposeOther()
  expect(
    __test.observerCount(s),
    'disposing the redirected owner does not sever the effect subscription',
  ).toBe(1)

  disposeMain()
  expect(__test.observerCount(s), 'disposing the effect owner severs the edge').toBe(0)
})

// ── 24c: detach affordance (runWithOwner(null)) ──────────────────────────────

test('§12.24c  runWithOwner(null) detaches: scope is unowned, survives surrounding disposal, disposed manually', () => {
  const s = signal(0)
  let detachedDispose: (() => void) | null = null

  const disposeRoot = createRoot((dispose) => {
    detachedDispose = runWithOwner(null, () =>
      createRoot((d) => {
        effect(() => {
          s()
        })
        return d
      }),
    )
    return dispose
  })

  flushSync()
  expect(__test.observerCount(s), 'detached effect subscribed').toBe(1)

  // Disposing the surrounding root does NOT dispose the detached scope — it was
  // never added as a child (currentOwner was null at creation).
  disposeRoot()
  expect(
    __test.observerCount(s),
    'detached scope survives surrounding owner disposal (it is unowned)',
  ).toBe(1)

  // It must be disposed manually.
  // biome-ignore lint/style/noNonNullAssertion: assigned synchronously in createRoot above
  detachedDispose!()
  expect(__test.observerCount(s), 'manual disposal severs the detached scope').toBe(0)
})
