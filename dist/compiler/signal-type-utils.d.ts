/**
 * nv Compiler — TypeScript Type Utilities
 * Stream: (2) Compiler specialization layer
 */
import * as ts from 'typescript';
import type { SignalId } from './types';
export declare function normPath(p: string): string;
/**
 * Walk the TypeScript alias chain and check whether a symbol's canonical
 * declaration originates in the nv core file.
 *
 * Shared between SyncTargetClassifier (for isSyncCall) and WriteGraphCycleChecker
 * (for isUntrackCall). Both passes need to nominally confirm nv core origin.
 */
export declare function symbolIsFromNvCore(sym: ts.Symbol, checker: ts.TypeChecker, nvCorePath: string): boolean;
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
export declare function isNvSignalType(type: ts.Type, checker: ts.TypeChecker, nvCorePath: string): boolean;
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
export declare function getThunkReturnSignalType(type: ts.Type, checker: ts.TypeChecker, nvCorePath: string): ts.Type | null;
/**
 * Compute a stable write-graph identity for a TypeScript symbol.
 *
 * Walks the alias chain (import bindings, re-exports) to the canonical
 * declaration. The identity is suitable for use in the global write-graph
 * cycle check (§8.5.2): two references to the same signal declaration will
 * produce the same ID even when accessed via different import paths.
 */
export declare function signalSymbolId(sym: ts.Symbol, checker: ts.TypeChecker): SignalId;
export declare function isAnyType(type: ts.Type): boolean;
/**
 * Is this expression a compile-time literal key (string or numeric)?
 * Used to distinguish enumerable from non-enumerable element access.
 */
export declare function isLiteralKeyExpr(expr: ts.Expression): expr is ts.StringLiteral | ts.NumericLiteral;
//# sourceMappingURL=signal-type-utils.d.ts.map