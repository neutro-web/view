/**
 * nv Compiler — Equality-Policy Inference Test Suite
 * Contract: §7, §7.1, §10 row 2
 *
 * Tests verify:
 *   (a) Correct policy per type category (OBJECT_IS / FALSE / DECLINE)
 *   (b) Soundness: DECLINE leaves Object.is → always correct
 *   (c) Correctness-critical: no type that can be mutated in place is marked OBJECT_IS
 *   (d) ADVERSARIAL: user-defined class named 'Map' → DECLINE (not FALSE)
 *   (e) ADVERSARIAL: ReadonlyArray<T> → DECLINE (TypeScript readonly is not runtime guarantee)
 *   (f) readonly tuple → DECLINE (same reasoning)
 *   (g) Nominal check: local function named 'signal'/'derived' → no verdict
 *   (h) derived() → same type categorization as signal() for equivalent value types
 *   (i) Union of all primitives → OBJECT_IS; union with non-primitive → DECLINE
 *   (j) Explicit T annotation wins over argument type (via return-type extraction)
 */

import assert from 'node:assert/strict'
import * as ts from 'typescript'
import { EqualityPolicyInferencer } from '../src/equalityPolicyInference'
import type { EqualityPolicy, EqualityPolicyVerdict } from '../src/types'
import { makeTestProgram, summarize, test } from './testHelpers'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getEqualityVerdicts(fixtureSource: string): EqualityPolicyVerdict[] {
  const { program, nvCorePath } = makeTestProgram(fixtureSource)
  const inferencer = new EqualityPolicyInferencer({ nvCorePath })
  const checker = program.getTypeChecker()
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  const sf = program
    .getSourceFiles()
    .find((f) => !f.isDeclarationFile && f.fileName.includes('fixture'))!

  const results: EqualityPolicyVerdict[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const v = inferencer.inferCall(node, checker)
      if (v !== null) results.push(v)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sf, visit)
  return results
}

function assertPolicy(
  fixtureSource: string,
  expected: EqualityPolicy,
  callCount = 1,
): EqualityPolicyVerdict[] {
  const verdicts = getEqualityVerdicts(fixtureSource)
  assert.equal(
    verdicts.length,
    callCount,
    `Expected ${callCount} verdict(s), got ${verdicts.length}: ${verdicts.map((v) => `${v.policy}/${v.valueTypeString}`).join(', ')}`,
  )
  for (const v of verdicts) {
    assert.equal(
      v.policy,
      expected,
      `Expected ${expected}, got ${v.policy} for type '${v.valueTypeString}'`,
    )
  }
  return verdicts
}

// ── Primitive types → OBJECT_IS ───────────────────────────────────────────────

test('OBJECT_IS: number', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(0)
  `,
    'OBJECT_IS',
  )
})

test('OBJECT_IS: string', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal('hello')
  `,
    'OBJECT_IS',
  )
})

test('OBJECT_IS: boolean', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(true)
  `,
    'OBJECT_IS',
  )
})

test('OBJECT_IS: bigint', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(42n)
  `,
    'OBJECT_IS',
  )
})

test('OBJECT_IS: symbol (primitive)', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(Symbol('id'))
  `,
    'OBJECT_IS',
  )
})

test('OBJECT_IS: null', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<null>(null)
  `,
    'OBJECT_IS',
  )
})

test('OBJECT_IS: undefined', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<undefined>(undefined)
  `,
    'OBJECT_IS',
  )
})

test('OBJECT_IS: numeric literal type (42 → number literal)', () => {
  // 42 infers as numeric literal; isPrimitiveType covers TypeFlags.NumberLiteral
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(42 as 42)
  `,
    'OBJECT_IS',
  )
})

test('OBJECT_IS: string literal type', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<'hello'>('hello')
  `,
    'OBJECT_IS',
  )
})

test('OBJECT_IS: union of primitives (string | number)', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<string | number>('a')
  `,
    'OBJECT_IS',
  )
})

test('OBJECT_IS: boolean | null (all primitive union)', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<boolean | null>(null)
  `,
    'OBJECT_IS',
  )
})

// ── Mutable containers → FALSE ────────────────────────────────────────────────

test('FALSE: Array<T> — mutable array (the §7 footgun case)', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<number[]>([])
  `,
    'FALSE',
  )
})

test('FALSE: generic array via inferred type', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal([1, 2, 3])
  `,
    'FALSE',
  )
})

test('FALSE: Map<K,V>', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(new Map<string, number>())
  `,
    'FALSE',
  )
})

test('FALSE: Set<T>', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(new Set<string>())
  `,
    'FALSE',
  )
})

test('FALSE: WeakMap<K,V>', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(new WeakMap<object, number>())
  `,
    'FALSE',
  )
})

test('FALSE: WeakSet<T>', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(new WeakSet<object>())
  `,
    'FALSE',
  )
})

test('FALSE: mutable tuple [number, string]', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<[number, string]>([1, 'a'])
  `,
    'FALSE',
  )
})

// ── DECLINE: ReadonlyArray and readonly tuples ────────────────────────────────
// TypeScript's readonly is type-level only; it is erasable at the call site
// (arr as T[]) and cannot be asserted as a runtime immutability guarantee.
// Claiming OBJECT_IS would suppress updates if the caller mutates in place.

test('DECLINE: ReadonlyArray<T> — TypeScript readonly is not runtime guarantee', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<ReadonlyArray<number>>([])
  `,
    'DECLINE',
  )
})

test('DECLINE: readonly T[] (readonly array syntax)', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<readonly number[]>([])
  `,
    'DECLINE',
  )
})

test('DECLINE: readonly tuple — [readonly [number, string]]', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<readonly [number, string]>([1, 'a'] as const)
  `,
    'DECLINE',
  )
})

// ── ADVERSARIAL: user-defined class named 'Map' → DECLINE ────────────────────
// The lib-file check (isStandardLibDeclaration) must use normPath prefix matching,
// not a filename regex. A user class named 'Map' declared outside TypeScript's
// lib directory must NOT be treated as the standard mutable Map.

test('ADVERSARIAL: user-defined class named "Map" → DECLINE, not FALSE', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    // A user class that happens to share the name 'Map' with the standard library
    class Map<K, V> {
      private data = new globalThis.Map<K, V>()
      get(key: K): V | undefined { return this.data.get(key) }
      set(key: K, val: V): this { this.data.set(key, val); return this }
    }
    const s = signal(new Map<string, number>())
  `,
    'DECLINE',
  )
})

// ── ADVERSARIAL: ReadonlyArray explicit — must DECLINE ────────────────────────
// Explicit adversarial case cited by the architect: the correctness bug would be
// OBJECT_IS for ReadonlyArray (claiming immutability that TypeScript can't guarantee).

test('ADVERSARIAL: ReadonlyArray<T> explicit — must be DECLINE not OBJECT_IS', () => {
  const verdicts = assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<ReadonlyArray<string>>(['a', 'b'])
  `,
    'DECLINE',
  )
  // Double-check: it must specifically NOT be OBJECT_IS (that would be the correctness bug)
  assert.notEqual(
    verdicts[0].policy,
    'OBJECT_IS',
    'ReadonlyArray<T> must never be OBJECT_IS — TypeScript readonly does not guarantee runtime immutability',
  )
})

// ── DECLINE: other cases ──────────────────────────────────────────────────────

test('DECLINE: user-defined object type', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    interface Point { x: number; y: number }
    const s = signal<Point>({ x: 0, y: 0 })
  `,
    'DECLINE',
  )
})

test('DECLINE: class instance', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    class Foo { val = 0 }
    const s = signal(new Foo())
  `,
    'DECLINE',
  )
})

test('DECLINE: union with non-primitive member (string | string[])', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<string | string[]>('a')
  `,
    'DECLINE',
  )
})

test('DECLINE: any', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = signal<any>(0)
  `,
    'DECLINE',
  )
})

test('DECLINE: unknown', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<unknown>(0)
  `,
    'DECLINE',
  )
})

test('DECLINE: generic type parameter', () => {
  assertPolicy(
    `
    import { signal } from '@nv/core'
    function makeSignal<T>(v: T) {
      return signal<T>(v)
    }
    makeSignal({ x: 0 })
  `,
    'DECLINE',
  )
})

test('DECLINE: Date (mutable but not in known-container list → user must opt in)', () => {
  // Date can be mutated in place (date.setFullYear()) but is not in the known
  // mutable container list. DECLINE is correct: user must set equals: false explicitly.
  // This is not a bug — it matches today's behavior without the compiler.
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(new Date())
  `,
    'DECLINE',
  )
})

// ── derived() — same type categorization ─────────────────────────────────────

test('derived: primitive return type → OBJECT_IS', () => {
  assertPolicy(
    `
    import { signal, derived } from '@nv/core'
    const x = signal(0)
    const d = derived(() => x() * 2)
  `,
    'OBJECT_IS',
    2,
  ) // signal(0) + derived(...)  — both get verdicts
  // The derived one specifically
  const verdicts = getEqualityVerdicts(`
    import { derived, signal } from '@nv/core'
    const x = signal(1)
    const d = derived(() => x() + 1)
  `)
  const derivedVerdict = verdicts.find((v) => v.valueTypeString === 'number')
  assert.ok(derivedVerdict, 'derived returning number should have a verdict')
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  assert.equal(derivedVerdict!.policy, 'OBJECT_IS')
})

test('derived: array return type → FALSE', () => {
  const verdicts = getEqualityVerdicts(`
    import { signal, derived } from '@nv/core'
    const x = signal(0)
    const d = derived(() => [x(), x() + 1])
  `)
  // Find the derived verdict (the one that returns an array)
  const arrayVerdict = verdicts.find((v) => v.policy === 'FALSE')
  assert.ok(arrayVerdict, 'derived returning array should be FALSE')
})

test('derived: object return type → DECLINE', () => {
  const verdicts = getEqualityVerdicts(`
    import { signal, derived } from '@nv/core'
    const x = signal(0)
    const d = derived(() => ({ value: x() }))
  `)
  const objectVerdict = verdicts.find((v) => v.policy === 'DECLINE')
  assert.ok(objectVerdict, 'derived returning object should be DECLINE')
})

// ── Nominal check: local signal/derived → no verdict ─────────────────────────

test('NO VERDICT: local function named "signal" is not classified', () => {
  // A local function named 'signal' with no import from @nv/core.
  // symbolIsFromNvCore returns false → no verdict produced.
  const verdicts = getEqualityVerdicts(`
    function signal<T>(v: T): T { return v }
    const s = signal(42)
  `)
  assert.equal(verdicts.length, 0, 'local signal() must not produce a verdict')
})

test('NO VERDICT: local function named "derived" is not classified', () => {
  const verdicts = getEqualityVerdicts(`
    import { signal } from '@nv/core'
    function derived<T>(fn: () => T) { return fn() }  // local non-nv derived
    const x = signal(0)
    const d = derived(() => x() * 2)  // NOT nv's derived
  `)
  // Only signal(0) gets a verdict; local derived() does not
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0].policy, 'OBJECT_IS') // signal(0) = number
})

// ── Return-type extraction wins over argument type ────────────────────────────

test('Explicit T annotation wins over argument type (return-type extraction)', () => {
  // signal<number[]>([]) — argument is `[]` (never[]), but T is number[]
  // We extract T from SignalAccessor<T> return type, not from the argument
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<number[]>([])
  `,
    'FALSE',
  )
  // If we used the argument type (never[]), we'd still get FALSE (never[] is an array),
  // but with an obscure type string. The explicit annotation gives us 'number[]'.
  const verdicts = getEqualityVerdicts(`
    import { signal } from '@nv/core'
    const s = signal<number[]>([])
  `)
  assert.equal(
    verdicts[0].valueTypeString,
    'number[]',
    'Type string should reflect explicit annotation',
  )
})

// ── Soundness: DECLINE always correct ────────────────────────────────────────

test('SOUNDNESS: DECLINE is always safe — no OBJECT_IS for mutable types', () => {
  // Verify the adversarially important property: nothing that can be mutated in
  // place should ever receive OBJECT_IS. Our conservative design ensures this:
  // only TypeScript primitives (incapable of in-place mutation) get OBJECT_IS.
  // User-defined objects, readonly containers, generics, any/unknown → DECLINE.
  const shouldBeDecline = [
    `import { signal } from '@nv/core'; const s = signal<{ x: number }>({ x: 0 })`,
    `import { signal } from '@nv/core'; const s = signal<ReadonlyArray<number>>([])`,
    `import { signal } from '@nv/core'; const s = signal<readonly [number, string]>([1, 'a'] as const)`,
    `import { signal } from '@nv/core'; const s = signal<unknown>(0)`,
    `import { signal } from '@nv/core'; const s = signal<any>(0)`,
    `import { signal } from '@nv/core'; const s = signal(new Date())`,
  ]
  for (const src of shouldBeDecline) {
    const verdicts = getEqualityVerdicts(src)
    for (const v of verdicts) {
      assert.notEqual(
        v.policy,
        'OBJECT_IS',
        `${v.valueTypeString} must not be OBJECT_IS — could be mutated in place`,
      )
    }
  }
})

// ── Pinning tests: union asymmetry and explicit-equals deference ──────────────
// These pin the correctness-critical asymmetry: a union of all primitives is safe
// to compare with Object.is; a union that spans a mutable container is not.
// Explicit-equals deference is the user's escape hatch — compiler must not override.

test('PIN: union of primitives → OBJECT_IS (all members incapable of in-place mutation)', () => {
  // string | number | boolean: every member is a primitive.
  // Object.is is correct for all of them simultaneously.
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<string | number | boolean>('a')
  `,
    'OBJECT_IS',
  )
})

test('PIN: union spanning mutable container → DECLINE (asymmetry in action)', () => {
  // string | string[]: the string[] member can be mutated in place.
  // We cannot emit OBJECT_IS (would suppress updates for the array branch).
  // We cannot emit FALSE (would over-propagate for the string branch).
  // DECLINE is the only safe choice — this is the §7 asymmetry at the union level.
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal<string | string[]>('a')
  `,
    'DECLINE',
  )
})

test('PIN: explicit { equals: false } → DECLINE (user choice respected, not overridden)', () => {
  // User explicitly opted into always-propagate. Compiler must defer.
  // If we emitted OBJECT_IS here (type is number), we'd silently override their intent.
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(0, { equals: false })
  `,
    'DECLINE',
  )
})

test('PIN: explicit { equals: predicate } → DECLINE (custom predicate deferred to)', () => {
  // User has a custom equality predicate (e.g., epsilon comparison for floats).
  // Emitting OBJECT_IS would override it even though the type is number.
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const s = signal(0, { equals: (a: number, b: number) => Math.abs(a - b) < 0.001 })
  `,
    'DECLINE',
  )
})

test('PIN: options as variable reference WITH equals → DECLINE (type-based fallback)', () => {
  // Common real-world pattern: extract options to a variable.
  // The options arg is not a direct ObjectLiteralExpression — AST check won't see it.
  // The type-based fallback must detect the 'equals' property on the type.
  // Without this fix this emitted FALSE, overriding the user's predicate.
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const opts = { equals: (a: number[], b: number[]) => a.length === b.length }
    const s = signal([] as number[], opts)
  `,
    'DECLINE',
  )
})

test('PIN: options as variable reference WITHOUT equals → infers normally (type check is property-specific)', () => {
  // Critical: the type-based fallback must check specifically for 'equals',
  // not decline for any non-literal options object. A variable with no 'equals'
  // property must still receive the inferred policy.
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const opts = { label: 'cart-items' }
    const s = signal([] as number[], opts)
  `,
    'FALSE',
  ) // number[] → FALSE, and opts has no equals → infer normally
})
test('PIN: shorthand { equals } → DECLINE (ShorthandPropertyAssignment form)', () => {
  // Common idiomatic TypeScript: pass equals as a shorthand property.
  // ts.isShorthandPropertyAssignment — different node kind from PropertyAssignment.
  // Without the shorthand check this would emit FALSE (type is number[]), overriding
  // the user's predicate — the exact wrong-result failure hasExplicitEquals targets.
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const equals = (a: number[], b: number[]) => a.length === b.length
    const s = signal([] as number[], { equals })
  `,
    'DECLINE',
  )
})

test('PIN: spread { ...opts } → DECLINE (conservative: cannot prove spread lacks equals)', () => {
  // A spread in the options object might carry equals from the spread source.
  // Resolving this would require type-checking the spread expression — not cheap.
  // Conservative rule: any SpreadAssignment in the options object → DECLINE.
  // Same "don't claim what you can't prove" discipline as the readonly-container case.
  assertPolicy(
    `
    import { signal } from '@nv/core'
    const opts = { equals: false } as const
    const s = signal([] as number[], { ...opts })
  `,
    'DECLINE',
  )
})

// ── Summary ───────────────────────────────────────────────────────────────────
summarize()
