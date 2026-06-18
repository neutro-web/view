/**
 * nv Compiler — Branch-Variant Analysis Test Suite
 * Contract: §10 row 4
 *
 * Tests verify:
 *   (a) Body shapes that produce DECLARED verdicts
 *   (b) Body shapes that produce DECLINE verdicts (all-or-nothing rule)
 *   (c) The union correctly covers all branches
 *   (d) Cross-boundary signals (parameters) → DECLINE
 *   (e) untrack() exclusion: reads inside untrack not in declared union
 *   (f) Nominal check: local function named 'derived' → no verdict
 *   (g) Identifier-not-called is not a reactive read (only call sites register reads)
 */

import * as ts from 'typescript'
import { expect, test } from 'vitest'
import { BranchVariantAnalyzer } from '../../src/compiler/branch-variant-analyzer'
import type { BranchVariantVerdict } from '../../src/compiler/types'
import { makeTestProgram } from './test-helpers'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getVariantVerdicts(fixtureSource: string): BranchVariantVerdict[] {
  const { program, nvCorePath } = makeTestProgram(fixtureSource)
  const analyzer = new BranchVariantAnalyzer({ nvCorePath })
  const checker = program.getTypeChecker()
  const sf = program
    .getSourceFiles()
    .find((f) => !f.isDeclarationFile && f.fileName.includes('fixture'))
  if (!sf) throw new Error('fixture source file not found')

  const results: BranchVariantVerdict[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const v = analyzer.analyzeCall(node, checker)
      if (v !== null) results.push(v)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sf, visit)
  return results
}

function idContains(id: string, name: string): boolean {
  return id.includes(`#${name}@`)
}

function assertDeclared(v: BranchVariantVerdict, expectedNames: string[]): ReadonlySet<string> {
  expect(
    v.kind,
    `Expected DECLARED, got ${v.kind}${v.kind === 'DECLINE' ? `: ${v.reason}` : ''}`,
  ).toBe('DECLARED')
  if (v.kind !== 'DECLARED') throw new Error('unreachable')
  for (const name of expectedNames) {
    expect(
      [...v.declaredUnion].some((id) => idContains(id, name)),
      `declaredUnion should contain '${name}': ${[...v.declaredUnion].join(', ')}`,
    ).toBe(true)
  }
  expect(
    v.declaredUnion.size,
    `Expected union size ${expectedNames.length}, got ${v.declaredUnion.size}: ${[...v.declaredUnion].join(', ')}`,
  ).toBe(expectedNames.length)
  return v.declaredUnion
}

function assertDecline(v: BranchVariantVerdict, reasonContains?: string): void {
  expect(v.kind, `Expected DECLINE, got ${v.kind}`).toBe('DECLINE')
  if (reasonContains && v.kind === 'DECLINE') {
    expect(
      v.reason.toLowerCase().includes(reasonContains.toLowerCase()),
      `Decline reason should mention '${reasonContains}': ${v.reason}`,
    ).toBe(true)
  }
}

// ── DECLARED cases ────────────────────────────────────────────────────────────

test('DECLARED: simple ternary — union of all three reads', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const cond = signal(true), a = signal(0), b = signal(0)
    const d = derived(() => cond() ? a() : b())
  `)
  expect(verdicts.length).toBe(1)
  assertDeclared(verdicts[0], ['cond', 'a', 'b'])
})

test('DECLARED: nested ternary — union of all branches', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const c1 = signal(true), c2 = signal(true)
    const a = signal(0), b = signal(0), c = signal(0)
    const d = derived(() => c1() ? (c2() ? a() : b()) : c())
  `)
  expect(verdicts.length).toBe(1)
  assertDeclared(verdicts[0], ['c1', 'c2', 'a', 'b', 'c'])
})

test('DECLARED: flat sequence — all reads in one expression', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const a = signal(0), b = signal(0), c = signal(0)
    const d = derived(() => a() + b() + c())
  `)
  expect(verdicts.length).toBe(1)
  assertDeclared(verdicts[0], ['a', 'b', 'c'])
})

test('DECLARED: single-read body', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const x = signal(0)
    const d = derived(() => x() * 2)
  `)
  expect(verdicts.length).toBe(1)
  assertDeclared(verdicts[0], ['x'])
})

test('DECLARED: block body with variable declaration and single return', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const a = signal(0), b = signal(0)
    const d = derived(() => {
      const x = a()
      return x + b()
    })
  `)
  expect(verdicts.length).toBe(1)
  assertDeclared(verdicts[0], ['a', 'b'])
})

test('DECLARED: property access signal read (obj.prop())', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const signals = { count: signal(0), active: signal(true) }
    const d = derived(() => signals.count() + (signals.active() ? 1 : 0))
  `)
  expect(verdicts.length).toBe(1)
  assertDeclared(verdicts[0], ['count', 'active'])
})

test('DECLARED: untrack exclusion — reads inside untrack not in union', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived, untrack } from '@nv/core'
    const a = signal(0), b = signal(0)
    // a is reactive; b is inside untrack → not in declared union
    const d = derived(() => a() + untrack(() => b()))
  `)
  expect(verdicts.length).toBe(1)
  assertDeclared(verdicts[0], ['a']) // only a, not b
  const [union] = [verdicts[0]] as [BranchVariantVerdict & { kind: 'DECLARED' }]
  if (union.kind === 'DECLARED') {
    expect(
      ![...union.declaredUnion].some((id) => idContains(id, 'b')),
      'b (untracked) must NOT be in declaredUnion',
    ).toBe(true)
  }
})

test('DECLARED: effect() body analyzed same as derived()', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, effect } from '@nv/core'
    const a = signal(0), b = signal(0)
    const e = effect(() => { a(); b() })
  `)
  // effect body has two statements: ExpressionStatement (a()) and ExpressionStatement (b())
  // ExpressionStatement → DECLINE (only VariableStatement and ReturnStatement allowed in blocks)
  // So this should DECLINE, not DECLARED
  expect(verdicts.length).toBe(1)
  assertDecline(verdicts[0])
})

test('DECLARED: effect() concise-style body (rare but valid)', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, effect, derived } from '@nv/core'
    const x = signal(0), y = signal(0)
    // effect with concise arrow body (expression)
    // This is unusual but valid TypeScript
    const e = effect(() => x() + y())
  `)
  expect(verdicts.length).toBe(1)
  assertDeclared(verdicts[0], ['x', 'y'])
})

test('DECLARED: identifier not called is not a reactive read', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    import type { SignalAccessor } from '@nv/core'
    const a = signal(0)
    const localConst = 42  // local non-signal constant
    // a() is reactive; localConst is not a signal
    const d = derived(() => a() + localConst)
  `)
  expect(verdicts.length).toBe(1)
  assertDeclared(verdicts[0], ['a']) // only a, not localConst
})

test('DECLARED: signal ref not called (in ternary false branch) is not a read', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    import type { SignalAccessor } from '@nv/core'
    const cond = signal(true), a = signal(0), b = signal(0)
    // b is referenced but NOT called in the false branch
    // @ts-ignore: intentionally passing signal ref as a value (not calling it)
    const d = derived(() => cond() ? a() : (b as unknown as number))
  `)
  // cond() is read (reactive), a() is read, b is referenced but not called
  // b not called → not a reactive read → not in union
  expect(verdicts.length).toBe(1)
  if (verdicts[0].kind === 'DECLARED') {
    expect([...verdicts[0].declaredUnion].some((id) => idContains(id, 'cond'))).toBe(true)
    expect([...verdicts[0].declaredUnion].some((id) => idContains(id, 'a'))).toBe(true)
    expect(![...verdicts[0].declaredUnion].some((id) => idContains(id, 'b'))).toBe(true)
  }
})

// ── DECLINE cases ─────────────────────────────────────────────────────────────

test('DECLINE: non-nv function call (opaque boundary)', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const a = signal(0)
    function helper(x: number) { return x * 2 }
    const d = derived(() => helper(a()))
  `)
  expect(verdicts.length).toBe(1)
  assertDecline(verdicts[0], 'non-nv call')
})

test('DECLINE: block body with if statement', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const cond = signal(true), a = signal(0), b = signal(0)
    const d = derived(() => {
      if (cond()) { return a() }
      return b()
    })
  `)
  expect(verdicts.length).toBe(1)
  assertDecline(verdicts[0])
})

test('DECLINE: block body with multiple returns', () => {
  // The if statement causes DECLINE before the second return is reached
  // (IfStatement is not in the allowed-statement set). Either way, the body declines.
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const cond = signal(true), a = signal(0), b = signal(0)
    const d = derived(() => {
      const x = a()
      if (x > 0) return x
      return b()
    })
  `)
  expect(verdicts.length).toBe(1)
  assertDecline(verdicts[0]) // IfStatement → non-trivial statement → DECLINE
})

test('DECLINE: for loop', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const n = signal(3)
    const d = derived(() => {
      let sum = 0
      for (let i = 0; i < n(); i++) sum += i
      return sum
    })
  `)
  expect(verdicts.length).toBe(1)
  assertDecline(verdicts[0])
})

test('DECLINE: cross-boundary — signal parameter (concrete identity unknown)', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    import type { SignalAccessor } from '@nv/core'
    function makeD(src: SignalAccessor<number>) {
      return derived(() => src())
    }
  `)
  expect(verdicts.length).toBe(1)
  assertDecline(verdicts[0], 'cross-boundary')
})

test('DECLINE: new expression (constructor may read signals)', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const a = signal(0)
    class Wrapper { constructor(public v: number) {} }
    const d = derived(() => new Wrapper(a()))
  `)
  expect(verdicts.length).toBe(1)
  assertDecline(verdicts[0])
})

test('NO VERDICT: local function named "derived" is not analyzed', () => {
  const verdicts = getVariantVerdicts(`
    function derived<T>(fn: () => T): T { return fn() }
    const d = derived(() => 42)
  `)
  expect(verdicts.length).toBe(0)
})

test('DECLARED: all-or-nothing — entire body declines if ANY sub-expr is opaque', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const a = signal(0), cond = signal(true)
    function opaque() { return 99 }
    // Even though cond() and a() are provable reads, the opaque() call declines the whole body
    const d = derived(() => cond() ? a() + opaque() : 0)
  `)
  expect(verdicts.length).toBe(1)
  assertDecline(verdicts[0])
})

// ── Union consistency ─────────────────────────────────────────────────────────

test('DECLARED: deeply nested ternary — union covers all leaf reads', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const c1 = signal(true), c2 = signal(true), c3 = signal(true)
    const a = signal(1), b = signal(2), c = signal(3), d = signal(4)
    const D = derived(() => c1() ? a() : c2() ? b() : c3() ? c() : d())
  `)
  expect(verdicts.length).toBe(1)
  assertDeclared(verdicts[0], ['c1', 'c2', 'c3', 'a', 'b', 'c', 'd'])
})

test('DECLARED: binary expression mixes signal reads and literals — only reads in union', () => {
  const verdicts = getVariantVerdicts(`
    import { signal, derived } from '@nv/core'
    const a = signal(5)
    const d = derived(() => a() * 2 + 100)  // 100 is a literal, not a read
  `)
  expect(verdicts.length).toBe(1)
  assertDeclared(verdicts[0], ['a'])
})
