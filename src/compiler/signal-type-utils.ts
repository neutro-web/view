/**
 * nv Compiler — TypeScript Type Utilities
 * Stream: (2) Compiler specialization layer
 */

import * as path from 'node:path'
import * as ts from 'typescript'
import type { SignalId } from './types.js'

// ── Path normalization ─────────────────────────────────────────────────────────

export function normPath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/')
}

/**
 * Walk the TypeScript alias chain and check whether a symbol's canonical
 * declaration originates in the nv core file.
 *
 * Shared between SyncTargetClassifier (for isSyncCall) and WriteGraphCycleChecker
 * (for isUntrackCall). Both passes need to nominally confirm nv core origin.
 */
export function symbolIsFromNvCore(
  sym: ts.Symbol,
  checker: ts.TypeChecker,
  nvCorePath: string,
): boolean {
  let resolved = sym
  for (let i = 0; i < 20; i++) {
    if (!(resolved.flags & ts.SymbolFlags.Alias)) break
    const next = checker.getAliasedSymbol(resolved)
    if (next === resolved) break
    resolved = next
  }
  const decl = resolved.declarations?.[0]
  if (!decl) return false
  return normPath(decl.getSourceFile().fileName) === normPath(nvCorePath)
}

// ── Nominal nv signal detection ────────────────────────────────────────────────

/**
 * Nominal isNvSignal check (structural pre-filter + nominal confirmation).
 *
 * Two-layer design (arch ruling 2026-06-15 — nominal required, not deferred):
 *   1. Structural pre-filter: type has call signatures AND a '.set' property.
 *   2. Nominal confirmation: the '.set' property declaration originates in the
 *      nv core source file (identified by nvCorePath).
 *
 * The nominal layer is required because the verdict gates the write-graph cycle
 * checker. A structural false match — a non-nv type that coincidentally has the
 * same shape — would add a wrong node to the write-graph and potentially produce
 * spurious or missing cycle errors. Re-exports of the nv SignalAccessor type
 * still pass because TypeScript resolves property declarations to their origin.
 *
 * @param type     The TypeScript type to check.
 * @param checker  The TypeChecker for the program.
 * @param nvCorePath  Normalized absolute path to the nv core .ts file.
 */
export function isNvSignalType(
  type: ts.Type,
  checker: ts.TypeChecker,
  nvCorePath: string,
): boolean {
  // 1. Structural pre-filter (cheap short-circuit for the common case)
  if (type.getCallSignatures().length === 0) return false
  const setProp = type.getProperty('set')
  if (!setProp) return false

  // 2. Nominal: '.set' must be declared in the nv core source file
  const nvNorm = normPath(nvCorePath)
  return (setProp.declarations ?? []).some((d) => normPath(d.getSourceFile().fileName) === nvNorm)
}

/**
 * If `type` is a conditional-target thunk `() => SignalAccessor<T>` (or the
 * practical variant `() => SignalAccessor<T> | undefined` produced by typed
 * containers like `Map.get()`), returns the signal member of the return type.
 * Otherwise returns null.
 *
 * Distinguishing rule: a `SignalAccessor<T>` has `.set`; a plain thunk
 * returning one does not. We confirm nominally via isNvSignalType.
 *
 * Union handling: `Map<K, SignalAccessor<T>>.get(k)` returns
 * `SignalAccessor<T> | undefined`. We detect the signal member of the union
 * so the enumerator can proceed and classify the body (e.g., a call expression
 * becomes NON_ENUMERABLE → REJECT, which is the correct verdict).
 */
export function getThunkReturnSignalType(
  type: ts.Type,
  checker: ts.TypeChecker,
  nvCorePath: string,
): ts.Type | null {
  // If this type itself has .set, it IS a SignalAccessor (Path A), not a thunk
  if (type.getProperty('set')) return null
  const callSigs = type.getCallSignatures()
  if (callSigs.length === 0) return null
  // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess in-bounds guarantee
  const ret = checker.getReturnTypeOfSignature(callSigs[0]!)

  // Direct: () => SignalAccessor<T>
  if (isNvSignalType(ret, checker, nvCorePath)) return ret

  // Union member: () => SignalAccessor<T> | undefined  (Map.get, optional chaining, etc.)
  if (ret.isUnion()) {
    const signalMember = ret.types.find((t) => isNvSignalType(t, checker, nvCorePath))
    if (signalMember) return signalMember
  }

  return null
}

// ── Symbol identity ────────────────────────────────────────────────────────────

/**
 * Compute a stable write-graph identity for a TypeScript symbol.
 *
 * Walks the alias chain (import bindings, re-exports) to the canonical
 * declaration. The identity is suitable for use in the global write-graph
 * cycle check (§8.5.2): two references to the same signal declaration will
 * produce the same ID even when accessed via different import paths.
 */
export function signalSymbolId(sym: ts.Symbol, checker: ts.TypeChecker): SignalId {
  let resolved = sym
  // Walk alias chain (cap at 20 to avoid pathological loops)
  for (let i = 0; i < 20; i++) {
    if (!(resolved.flags & ts.SymbolFlags.Alias)) break
    const next = checker.getAliasedSymbol(resolved)
    if (next === resolved) break
    resolved = next
  }
  const decl = resolved.declarations?.[0]
  if (!decl) return `<unresolved:${resolved.name}>`
  const file = normPath(decl.getSourceFile().fileName)
  return `${file}#${resolved.name}@${decl.getStart()}`
}

// ── Type flag helpers ──────────────────────────────────────────────────────────

export function isAnyType(type: ts.Type): boolean {
  return !!(type.flags & ts.TypeFlags.Any)
}

/**
 * Is this expression a compile-time literal key (string or numeric)?
 * Used to distinguish enumerable from non-enumerable element access.
 */
export function isLiteralKeyExpr(
  expr: ts.Expression,
): expr is ts.StringLiteral | ts.NumericLiteral {
  return ts.isStringLiteral(expr) || ts.isNumericLiteral(expr)
}
