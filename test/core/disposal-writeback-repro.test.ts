/**
 * Repro probe (Architect commission, 2026-07-09) — determine whether a
 * disposal-triggered write-back to a signal the disposing effect ALREADY
 * READ this run is dropped for re-scheduling purposes.
 *
 * Mechanism under test: `propagate()` only re-enqueues an observer when
 * `obs.state !== DIRTY` (core.ts:364); a recomputing effect's state resets
 * to CLEAN only AFTER `compute()` returns (core.ts:542/550) — so it is
 * DIRTY for the whole duration of its own compute, including any
 * synchronous disposal it triggers.
 *
 * NOT A FIX. src/core/ is untouched by this file. This only observes and
 * reports: recompute counts, whether the write lands, whether a later
 * unrelated write "rescues" the stale read. The §6/§8 ruling on whether
 * this is (a) supported / (b) forbidden / (c) undefined comes after this
 * repro, from Architect — not decided here.
 */
import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import {
  createRoot,
  effect,
  flushSync,
  getOwner,
  onCleanup,
  runWithOwner,
  signal,
} from '../../src/core/core.js'
import { mount } from '../../src/renderer/interpreter.js'
import type { ComponentBinding, ConditionalBinding, TemplateIR } from '../../src/renderer/ir.js'

// ── Probe 1: raw primitives ───────────────────────────────────────────────
//
// The exact hazard shape: an effect (a) reads a signal EARLY in a given
// compute, then (b) LATER in that SAME compute explicitly disposes a
// previously-created inner scope whose onCleanup writes that SAME signal —
// mirroring wireDeferredSwap/wireConditional's actual sequencing (read
// pending/condition, THEN dispose the old branch, all within one compute).
// This is deliberately NOT `preRunCleanup`-triggered disposal (that fires
// BEFORE the new compute's own reads, which would make the write visible to
// THIS run's read and prove nothing about the hazard) — it's an EXPLICIT
// mid-compute dispose call, the actual shape used by wireConditional/
// wireSwitch/wireDeferredSwap's own `branchDisposer()`/`revealedDisposer()`.

test('repro: mid-compute disposal write-back to a signal already read earlier in the SAME compute', () => {
  const s = signal(0)
  const trigger = signal(0)
  let runs = 0
  const readAtEachRun: number[] = []
  let disposePrev: (() => void) | null = null

  createRoot(() => {
    // Capture the OUTER owner before effect() — same fix wireDeferredSwap
    // uses (capturedOwner/runWithOwner). Mounting the inner scope under
    // currentOwner-during-the-effect's-own-compute (plain nested createRoot)
    // would make it a CHILD of the effect, and preRunCleanup auto-disposes
    // ALL of a node's children at the START of that node's OWN next
    // recompute — BEFORE the new compute's reads run at all. That would
    // make the write-back visible to THIS run's read (proven by a first,
    // wrong version of this probe: readAtEachRun came out [0, 1], not
    // [0, 0], because preRunCleanup's auto-dispose ran the onCleanup before
    // the compute body's read even executed) and would test a DIFFERENT,
    // uninteresting case. runWithOwner makes the inner scope a SIBLING of
    // the effect, so only the EXPLICIT `d()` call below disposes it — at
    // the exact point in the compute this probe needs to control.
    const outerOwner = getOwner()

    effect(() => {
      runs++
      trigger() // dependency to force re-runs independent of `s`
      readAtEachRun.push(s()) // (a) READ s EARLY in this compute

      // (b) LATER in this SAME compute: dispose the previous run's inner
      // scope (mirrors wireConditional's "dispose old branch" step, which
      // in that code runs at the START of the effect body, before reading
      // condition() again for the NEW decision — here we place it after the
      // read to test the case Architect's mechanism describes literally:
      // "a signal the same effect already read earlier in the same run").
      if (disposePrev !== null) {
        const d = disposePrev
        disposePrev = null
        d() // synchronously runs the previous scope's onCleanup, NOW, mid-compute
      }

      // Create a fresh inner scope (sibling of the effect, via
      // runWithOwner) whose onCleanup will fire on the NEXT mid-compute
      // dispose call above — not automatically via preRunCleanup.
      disposePrev = runWithOwner(outerOwner, () =>
        createRoot((dispose) => {
          onCleanup(() => {
            s.set(s() + 1) // disposal write-back to the signal read in step (a)
          })
          return dispose
        }),
      )
    })
  })

  flushSync()
  expect(runs).toBe(1)
  expect(readAtEachRun).toEqual([0]) // first run: disposePrev is null, no write-back yet

  // Trigger run #2 via `trigger` (independent of `s`).
  trigger.set(1)
  flushSync()

  // Run #2: reads s() FIRST (step a) — at this point s is still 0 (nothing
  // has written it yet this run) — THEN disposes run #1's scope (step b),
  // which writes s.set(1). This write happens AFTER run #2's own read.
  expect(runs).toBe(2)
  expect(readAtEachRun).toEqual([0, 0]) // run 2's READ saw s=0, BEFORE the disposal wrote it

  const sValueRightAfterRun2 = s()
  const runsRightAfterRun2 = runs

  // One more no-op flush: if the write-back's propagate() call failed to
  // enqueue a fresh recompute (the hypothesized hazard), this changes nothing.
  flushSync()

  const report1 = {
    sValueRightAfterRun2, // does the WRITE land on the signal itself?
    runsRightAfterRun2, // was a 3rd run scheduled for that write?
    runsAfterRedundantFlush: runs,
    readAtEachRun: [...readAtEachRun],
  }
  console.log('[repro/probe1]', JSON.stringify(report1))

  // FINDING: the write always lands on the signal's VALUE (nodeSet writes
  // synchronously regardless of propagate()'s enqueue decision).
  expect(sValueRightAfterRun2).toBe(1)

  // THE ACTUAL QUESTION: was a fresh (3rd) recompute scheduled for that
  // write, given the effect's state was still DIRTY (mid-own-compute) when
  // the write happened? If runs stayed at 2, the write was dropped for
  // scheduling purposes — the effect's last READ (readAtEachRun[1] = 0) is
  // now stale relative to s's actual value (1), with nothing having
  // corrected it.
  expect(runsRightAfterRun2).toBe(2) // CONFIRMS: no 3rd recompute scheduled
  expect(runs).toBe(2) // redundant flush changes nothing — confirms "dropped", not "deferred"

  // Now issue a write to `s` from OUTSIDE any effect (state is CLEAN by
  // then) — does this "rescue" it, proving the divergence is purely the
  // scheduling gap and not a permanent inconsistency in the signal graph?
  s.set(s() + 10) // s: 1 -> 11
  flushSync()

  console.log(
    '[repro/probe1/rescue]',
    JSON.stringify({ runs, lastRead: readAtEachRun[readAtEachRun.length - 1], sFinal: s() }),
  )

  expect(runs).toBe(3) // an external write DOES trigger a fresh recompute
  expect(readAtEachRun[2]).toBe(11) // and this run correctly observes the rescued value
  // Run #3 is the SAME effect body — it ALSO disposes run #2's still-pending
  // inner scope mid-compute (disposePrev was never consumed between runs 2
  // and 3, since nothing disposed it), adding one more write-back: 11 -> 12.
  // This isn't a new phenomenon, just the same mechanism compounding across
  // the chain of runs — s's final value is 12, not 11.
  expect(s()).toBe(12)
})

// ── Probe 2: construct-level, through the real renderer path ────────────────
//
// A ConditionalBinding whose consequent is a ComponentBinding — the
// component factory is called FRESH every time wireConditional mounts that
// branch (unlike a plain nested binding's thunk, which is captured once
// structurally), so `onCleanup` registered inside the factory body reliably
// fires exactly when THAT branch instance is disposed — the real construct-
// level analogue of wireConditional's/wireDeferredSwap's branch teardown.

test('repro (renderer path): a wireConditional branch onCleanup writing back to its own condition signal', () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>')
  const doc = dom.window.document
  const container = doc.createElement('div')
  doc.body.appendChild(container)

  const cond = signal(false)
  let mountCount = 0

  const OnFactory = (): TemplateIR => {
    mountCount++
    // Fires when THIS branch instance is disposed — i.e. when
    // wireConditional's own effect re-runs and calls branchDisposer() at
    // the TOP of its body, BEFORE re-reading condition(). This mirrors the
    // real code shape exactly (dispose-old happens before the next read).
    onCleanup(() => {
      cond.set(!cond())
    })
    return {
      id: 'on-branch',
      shape: { html: '<span class="on">on</span>', bindingPaths: [] },
      bindings: [],
    }
  }

  const consequent: TemplateIR = {
    id: 'consequent-wrapper',
    shape: { html: '<!--nv-comp-0-->', bindingPaths: [[0]] },
    bindings: [
      {
        kind: 'component',
        pathIndex: 0,
        component: OnFactory as ComponentBinding['component'],
        props: [],
        propNames: [],
        slots: [],
      } satisfies ComponentBinding,
    ],
  }

  const alternate: TemplateIR = {
    id: 'off-branch',
    shape: { html: '<span class="off">off</span>', bindingPaths: [] },
    bindings: [],
  }

  const ir: TemplateIR = {
    id: 'root',
    shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0, 0]] },
    bindings: [
      {
        kind: 'conditional',
        pathIndex: 0,
        condition: () => cond(),
        consequent,
        alternate,
      } satisfies ConditionalBinding,
    ],
  }

  const dispose = mount(ir, container, doc)
  flushSync()
  expect(container.querySelector('.off')).not.toBeNull()
  expect(mountCount).toBe(0)

  // Flip cond true -> mounts the 'on' branch (mountCount: 1). condition() is
  // read AFTER wireConditional's dispose-old-branch step, but there is no
  // previous 'on' branch yet on this transition, so nothing writes back here.
  cond.set(true)
  flushSync()
  expect(container.querySelector('.on')).not.toBeNull()
  expect(mountCount).toBe(1)

  // Flip cond false -> wireConditional's effect reruns: FIRST it disposes
  // the 'on' branch (branchDisposer(), the top of its own compute) — that
  // disposal's onCleanup fires cond.set(!cond()) = cond.set(true), a WRITE
  // to the very signal condition() is about to read NEXT in this SAME
  // compute (a beat later, same run). THEN it reads condition() (now true
  // again, if the write landed in time) to decide what to mount.
  cond.set(false)
  flushSync()

  const stateAfterFlip = {
    condValue: cond(),
    hasOn: container.querySelector('.on') !== null,
    hasOff: container.querySelector('.off') !== null,
    mountCount,
  }
  console.log('[repro/probe2]', JSON.stringify(stateAfterFlip))

  dispose()

  // FINDING (renderer path): wireConditional does NOT reproduce the divergent
  // outcome probe 1 showed at the raw-primitive level — because it disposes
  // the OLD branch FIRST, then reads condition() SECOND, within the SAME
  // compute. The write-back (from the disposed branch's onCleanup) therefore
  // happens BEFORE, not after, this run's own read of the driving signal —
  // so this run correctly observes the fresh value and re-mounts 'on'
  // (mountCount: 2, not stuck at 1). wireConditional's specific ordering
  // (dispose-then-read) happens to make it IMMUNE to this hazard for its OWN
  // driving signal, precisely because of that ordering — not because the
  // underlying mechanism (propagate()'s DIRTY-guard) doesn't apply to it.
  // wireDeferredSwap reads (pending/when) BEFORE it disposes (the old
  // branch), which is why probe 1's ordering — not wireConditional's — is
  // the one that actually matches wireDeferredSwap's real shape and produces
  // the divergence.
  expect(stateAfterFlip.condValue).toBe(true) // the write-back lands on the signal
  expect(stateAfterFlip.hasOn).toBe(true) // and IS observed by this same run (dispose-before-read ordering)
  expect(stateAfterFlip.hasOff).toBe(false)
  expect(stateAfterFlip.mountCount).toBe(2) // re-mounted 'on' — no divergence for THIS construct's own signal
})
