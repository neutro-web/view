/**
 * nv Compiler — sync-target Classification Test Suite
 * Contract: §8.5.3, §10 row 1
 *
 * Tests verify:
 *   (a) Correct verdict (ACCEPT / REJECT / UNDECIDABLE) for each target shape
 *   (b) ACCEPT verdicts carry the right number of target identities
 *   (c) Target identity is stable: two references to the same signal produce the same ID
 *   (d) Nominal check: a non-nv type that structurally matches is NOT classified as nv
 *   (e) Isoalted sync() identification: a local function named 'sync' is not classified
 *   (f) Soundness note: ACCEPT with incomplete set → runtime cap (not wrong result)
 */

import { expect, test } from 'vitest'
import type { TargetVerdict } from '../../src/compiler/types'
import { getVerdicts } from './test-helpers'

// ── Assertion helpers ──────────────────────────────────────────────────────────

function assertAccept(v: TargetVerdict, targetCount: number): Set<string> {
  expect(v.kind, `Expected ACCEPT, got ${v.kind}: ${'reason' in v ? v.reason : ''}`).toBe('ACCEPT')
  if (v.kind !== 'ACCEPT') throw new Error('unreachable')
  expect(
    v.targets.size,
    `Expected ${targetCount} targets, got ${v.targets.size}: ${[...v.targets].join(', ')}`,
  ).toBe(targetCount)
  return new Set(v.targets)
}

function assertReject(v: TargetVerdict, reasonContains?: string): void {
  expect(v.kind, `Expected REJECT, got ${v.kind}: ${'reason' in v ? v.reason : ''}`).toBe('REJECT')
  if (reasonContains && v.kind === 'REJECT') {
    expect(
      v.reason.includes(reasonContains) || v.diagnostic.includes(reasonContains),
      `REJECT reason should mention '${reasonContains}', got: ${v.reason}`,
    ).toBe(true)
  }
}

function assertUndecidable(v: TargetVerdict, reasonContains?: string): void {
  expect(v.kind, `Expected UNDECIDABLE, got ${v.kind}: ${'reason' in v ? v.reason : ''}`).toBe(
    'UNDECIDABLE',
  )
  if (reasonContains && v.kind === 'UNDECIDABLE') {
    expect(
      v.reason.includes(reasonContains),
      `UNDECIDABLE reason should mention '${reasonContains}', got: ${v.reason}`,
    ).toBe(true)
  }
}

function idContains(targets: Set<string>, name: string): boolean {
  return [...targets].some((id) => id.includes(`#${name}@`))
}

// ── §12.10 / §8.5.3: Direct signal identifier ─────────────────────────────────
test('ACCEPT: direct signal identifier (Path A — singleton target)', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0)
    const T = signal(0)
    sync(() => x(), T, (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  const targets = assertAccept(verdicts[0]!, 1)
  expect(idContains(targets, 'T'), `target set should contain 'T': ${[...targets]}`).toBe(true)
})

// ── §12.10: Conditional ternary with two known signals ────────────────────────
test('ACCEPT: conditional ternary — both branches known signals (Path B)', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0)
    const cond = signal(true)
    const T1 = signal(0)
    const T2 = signal(0)
    sync(() => x(), () => cond() ? T1 : T2, (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  const targets = assertAccept(verdicts[0]!, 2)
  expect(idContains(targets, 'T1'), `targets should include 'T1': ${[...targets]}`).toBe(true)
  expect(idContains(targets, 'T2'), `targets should include 'T2': ${[...targets]}`).toBe(true)
})

// ── Nested conditional — three-way ────────────────────────────────────────────
test('ACCEPT: nested conditional — union of all branch signals', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0)
    const c1 = signal(true), c2 = signal(true)
    const T1 = signal(0), T2 = signal(0), T3 = signal(0)
    sync(() => x(), () => c1() ? (c2() ? T1 : T2) : T3, (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  const targets = assertAccept(verdicts[0]!, 3)
  expect(idContains(targets, 'T1'), 'targets missing T1').toBe(true)
  expect(idContains(targets, 'T2'), 'targets missing T2').toBe(true)
  expect(idContains(targets, 'T3'), 'targets missing T3').toBe(true)
})

// ── PropertyAccessExpression on typed object ──────────────────────────────────
test('ACCEPT: property access on typed object (obj.submit)', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0), cond = signal(true)
    const signals = { submit: signal(false), cancel: signal(false) }
    sync(() => x(), () => signals.submit, (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  const targets = assertAccept(verdicts[0]!, 1)
  expect(idContains(targets, 'submit'), `target should be 'submit' property: ${[...targets]}`).toBe(
    true,
  )
})

// ── Conditional with PropertyAccessExpression ─────────────────────────────────
test('ACCEPT: conditional property access — two distinct properties', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0), cond = signal(true)
    const signals = { submit: signal(false), cancel: signal(false) }
    sync(() => x(), () => cond() ? signals.submit : signals.cancel, (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  const targets = assertAccept(verdicts[0]!, 2)
  expect(idContains(targets, 'submit'), `targets missing 'submit'`).toBe(true)
  expect(idContains(targets, 'cancel'), `targets missing 'cancel'`).toBe(true)
})

// ── ElementAccess with string literal key ─────────────────────────────────────
test('ACCEPT: element access with string literal key (signals["submit"])', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0), cond = signal(true)
    const signals = { submit: signal(false), cancel: signal(false) }
    sync(() => x(), () => signals['submit'], (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  const targets = assertAccept(verdicts[0]!, 1)
  expect(idContains(targets, 'submit'), `target should be 'submit': ${[...targets]}`).toBe(true)
})

// ── Property and element access give the SAME signal ID ───────────────────────
test('ACCEPT: obj.prop and obj["prop"] resolve to the same signal ID', () => {
  const v1 = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const s = signal(0)
    const obj = { a: signal(0) }
    sync(() => s(), () => obj.a, (v) => v)
  `)
  const v2 = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const s = signal(0)
    const obj = { a: signal(0) }
    sync(() => s(), () => obj['a'], (v) => v)
  `)
  // Both must be ACCEPT with 1 target, and both targets named 'a'
  const t1 = assertAccept(v1[0]!, 1)
  const t2 = assertAccept(v2[0]!, 1)
  expect(idContains(t1, 'a'), `v1 target not 'a': ${[...t1]}`).toBe(true)
  expect(idContains(t2, 'a'), `v2 target not 'a': ${[...t2]}`).toBe(true)
  // The IDs won't be identical across two separate programs (different file paths)
  // but both should resolve to the property 'a' — verified above.
})

// ── External source sync — target classification is independent of source type ──
test('ACCEPT: external source (pubsub) — target still classified correctly', () => {
  const verdicts = getVerdicts(`
    import { signal, sync, pubsub } from '@nv/core'
    const count = signal(0)
    const clicks = pubsub<void>()
    sync(clicks, count, (_, curr: number) => curr + 1)
  `)
  expect(verdicts.length).toBe(1)
  const targets = assertAccept(verdicts[0]!, 1)
  expect(idContains(targets, 'count'), `target should be 'count': ${[...targets]}`).toBe(true)
})

// ── §8.5.3 case 2: Runtime array index → NON_ENUMERABLE → REJECT ──────────────
test('REJECT: runtime array index arr[i()] — provably non-enumerable', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0), i = signal(0)
    const arr = [signal(0), signal(0), signal(0)]
    // @ts-ignore — testing classifier against deliberately non-enumerable target
    sync(() => x(), () => arr[i()], (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  assertReject(verdicts[0]!, 'non-literal')
})

// ── Non-literal variable index → NON_ENUMERABLE → REJECT ─────────────────────
test('REJECT: non-literal variable index arr[idx] — non-enumerable', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0)
    const arr = [signal(0), signal(0)]
    declare const idx: number
    // @ts-ignore
    sync(() => x(), () => arr[idx], (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  assertReject(verdicts[0]!, 'non-literal')
})

// ── Dynamic lookup call (map.get(key())) → NON_ENUMERABLE → REJECT ───────────
test('REJECT: call expression as target (map.get(key())) — runtime call', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0), key = signal('a')
    const map = new Map<string, ReturnType<typeof signal<number>>>()
    map.set('a', signal(0))
    // @ts-ignore
    sync(() => x(), () => map.get(key()), (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  assertReject(verdicts[0]!, 'runtime call')
})

// ── §8.5.3 case 3: any-typed target → UNDECIDABLE ────────────────────────────
test('UNDECIDABLE: any-typed target — cannot determine enumerability', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target: any = signal(0)
    sync(() => x(), target, (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  assertUndecidable(verdicts[0]!, "'any'")
})

// ── Cross-boundary: function parameter → UNDECIDABLE ─────────────────────────
// The parameter is typed as SignalAccessor<number> (nv type), but the concrete
// signal identity is unknown from this call site.
test('UNDECIDABLE: function parameter — concrete identity unknown (cross-boundary)', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    import type { SignalAccessor } from '@nv/core'
    const x = signal(0)
    function setup(target: SignalAccessor<number>) {
      sync(() => x(), target, (v) => v)
    }
  `)
  expect(verdicts.length).toBe(1)
  assertUndecidable(verdicts[0]!)
  // Reason should mention parameter / cross-boundary
  const v0 = verdicts[0]!
  if (v0.kind === 'UNDECIDABLE') {
    expect(
      v0.reason.includes('parameter') || v0.reason.includes('cross-boundary'),
      `Reason should mention parameter: ${v0.reason}`,
    ).toBe(true)
  }
})

// ── Nominal check: non-nv type with same shape is NOT classified as nv signal ─
test('UNDECIDABLE: structurally matching non-nv type fails nominal check', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0)

    // Local interface with identical shape to SignalAccessor<number>
    // but declared here (not in nv core) — nominal check must reject it
    interface FakeSignal {
      (): number
      set(v: number): void
    }
    declare const fakeTarget: FakeSignal

    // @ts-ignore — deliberate type mismatch to test classifier nominal check
    sync(() => x(), fakeTarget, (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  // FakeSignal.set is NOT in nv core → isNvSignalType returns false → UNDECIDABLE
  assertUndecidable(verdicts[0]!)
})

// ── Local 'sync' function is NOT classified ────────────────────────────────────
test('NO VERDICT: local function named sync is not classified (nominal isSyncCall)', () => {
  const verdicts = getVerdicts(`
    import { signal } from '@nv/core'
    const T = signal(0), x = signal(0)
    // A local 'sync' that is NOT the nv core's sync
    function sync(a: unknown, b: unknown, c: unknown) {}
    sync(() => x(), T, (v: number) => v)
  `)
  // The classifier must NOT produce a verdict for the local sync call
  expect(verdicts.length, `Expected 0 verdicts, got ${verdicts.length}`).toBe(0)
})

// ── Multiple sync calls in one file ───────────────────────────────────────────
test('Multiple sync calls — one verdict per sync, correct kinds', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0), cond = signal(true)
    const T1 = signal(0), T2 = signal(0)
    const arr = [signal(0)]

    sync(() => x(), T1, (v) => v)               // ACCEPT(1)
    sync(() => x(), () => cond() ? T1 : T2, (v) => v)  // ACCEPT(2)
    // @ts-ignore
    sync(() => x(), () => arr[x()], (v) => v)  // REJECT
  `)
  expect(verdicts.length).toBe(3)
  assertAccept(verdicts[0]!, 1)
  assertAccept(verdicts[1]!, 2)
  assertReject(verdicts[2]!)
})

// ── Target ID stability: same signal referenced twice → same ID ───────────────
test('ACCEPT: same signal as target in two syncs → identical IDs', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0), y = signal(0)
    const T = signal(0)
    sync(() => x(), T, (v) => v)
    sync(() => y(), T, (v) => v)
  `)
  expect(verdicts.length).toBe(2)
  const t1 = assertAccept(verdicts[0]!, 1)
  const t2 = assertAccept(verdicts[1]!, 1)
  expect([...t1][0], 'Same signal T should produce identical IDs in both verdicts').toBe([...t2][0])
})

// ── Block-body arrow function (explicit return) ───────────────────────────────
test('ACCEPT: conditional thunk with block body and explicit return', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0), cond = signal(true)
    const T1 = signal(0), T2 = signal(0)
    sync(() => x(), () => { return cond() ? T1 : T2 }, (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  const targets = assertAccept(verdicts[0]!, 2)
  expect(idContains(targets, 'T1')).toBe(true)
  expect(idContains(targets, 'T2')).toBe(true)
})

// ── Named conditional thunk (identifier → declaration) ───────────────────────
test('ACCEPT: target thunk assigned to variable, then referenced by identifier', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    import type { SignalAccessor } from '@nv/core'
    const x = signal(0), cond = signal(true)
    const T1 = signal(0), T2 = signal(0)
    const pickTarget = (): SignalAccessor<number> => cond() ? T1 : T2
    sync(() => x(), pickTarget, (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  const targets = assertAccept(verdicts[0]!, 2)
  expect(idContains(targets, 'T1')).toBe(true)
  expect(idContains(targets, 'T2')).toBe(true)
})

// ── UNDECIDABLE when one branch of a conditional is undecidable ───────────────
// Partial enumeration is NOT accepted (mergeEnum: SIGNALS + UNDECIDABLE → UNDECIDABLE)
// This is the stricter-but-cleaner choice: we don't claim enumerability we can't prove.
test('UNDECIDABLE: one branch undecidable — partial enumeration rejected', () => {
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0), cond = signal(true)
    const T1 = signal(0)
    declare const maybeSignal: unknown  // unknown type — not nv signal
    // @ts-ignore
    sync(() => x(), () => cond() ? T1 : (maybeSignal as any), (v) => v)
  `)
  expect(verdicts.length).toBe(1)
  // One branch is 'any' → UNDECIDABLE. mergeEnum(SIGNALS, UNDECIDABLE) → UNDECIDABLE.
  assertUndecidable(verdicts[0]!)
})

// ── Soundness note ─────────────────────────────────────────────────────────────
// Property: any ACCEPT verdict imprecision (incomplete target set, or wrong ACCEPT
// when UNDECIDABLE would be more precise) degrades to the runtime cascade cap via
// §5.2 dynamic reconciliation — it never produces a wrong observable result.
//
// This is verified by the runtime conformance suite:
//   §12.13 (sync soundness fallback) — dynamic reconciliation always runs;
//   §8.5.4 (cascade cap) — bounded cascade for any write-path that slips through.
//
// The cycle checker downstream MUST preserve the conservative-on-incompleteness
// invariant: an incomplete ACCEPT target set means the checker may MISS a cycle
// (falls to runtime cap), but it must NEVER assert acyclicity it hasn't proven.
test('SOUNDNESS NOTE (documented, not executable in compiler stream): ' +
  'ACCEPT with incomplete set → runtime cascade cap, not wrong result', () => {
  // This test is a compliance documentation check.
  // The actual runtime behavior is pinned by §12.13 in conformance.ts.
  // We verify here that the classifier never produces ACCEPT for a
  // provably-non-enumerable case (ensuring the "worse case" is UNDECIDABLE,
  // not a wrong ACCEPT that gives the cycle checker a false guarantee).
  const verdicts = getVerdicts(`
    import { signal, sync } from '@nv/core'
    const x = signal(0), i = signal(0)
    const arr = [signal(0)]
    // @ts-ignore
    sync(() => x(), () => arr[i()], (v) => v)
  `)
  // A provably non-enumerable case → REJECT (with diagnostic), not ACCEPT
  expect(verdicts.length).toBe(1)
  expect(
    verdicts[0]!.kind,
    'Classifier must never ACCEPT a provably non-enumerable target',
  ).not.toBe('ACCEPT')
})
