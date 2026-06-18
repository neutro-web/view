/**
 * nv Reactive Core — Runtime Implementation
 * Contract: nv-reactive-core-contract.md v0.4
 * Workstream: (1) Runtime — correctness phase, no perf tuning
 *
 * Key design points:
 *  §2       Single ReactiveNode struct, kind-distinguished (not class hierarchy)
 *  §9       Intrusive doubly-linked list edges; no Array/Set/Map in hot path
 *  §5       Iterative updateIfNecessary via _walkParent/_walkCursor temp fields
 *  §4       Iterative BFS propagate via _markNext temp field
 *  §8.7     Syncs drain before effects; up-walk handles intra-sync ordering
 *  §8.5.4   Cascade cap covers both sync and effect phases
 *  §10      Compiler hooks are inert stub fields in this phase
 */
export interface SignalAccessor<T> {
    (): T;
    set(v: T): void;
}
export declare function signal<T>(initial: T, opts?: {
    equals?: ((a: T, b: T) => boolean) | false;
}): SignalAccessor<T>;
export interface DerivedAccessor<T> {
    (): T;
}
export declare function derived<T>(compute: () => T, opts?: {
    equals?: ((a: T, b: T) => boolean) | false;
}): DerivedAccessor<T>;
export declare function effect(compute: () => void): () => void;
export interface ExternalSource {
    subscribe(cb: (v: unknown) => void): () => void;
}
export declare function sync<S = unknown, T = unknown>(source: (() => S) | ExternalSource, target: SignalAccessor<T> | (() => SignalAccessor<T>), compute: ((incoming: S) => T) | ((incoming: S, current: T) => T)): () => void;
export interface PubSub<T = unknown> extends ExternalSource {
    subscribe(cb: (v: T) => void): () => void;
    publish(v: T): void;
    clear(): void;
}
export declare function pubsub<T = unknown>(): PubSub<T>;
export declare function batch(fn: () => void): void;
export declare function untrack<T>(fn: () => T): T;
export declare function createRoot<T>(fn: (dispose: () => void) => T): T;
export declare function onCleanup(fn: () => void): void;
export declare function errorBoundary(handler: (e: unknown) => void, fn: () => void): void;
/** Force a synchronous flush. For tests and batch() internals only. */
export declare function flushSync(): void;
/**
 * Test-only instrumentation surface. Exposes recompute counts and edge-list
 * walks for property-based fuzz testing (§B1). Not part of the public API;
 * intended to be tree-shaken or stripped in production builds.
 */
export declare const __test: {
    readonly recomputeCount: number;
    resetCounts(): void;
    /** Turn on per-node counting and start a fresh measurement window. */
    enablePerNode(): void;
    disablePerNode(): void;
    /** Recomputes for a node this window; 0 if never recomputed, -1 if unknown fn. */
    recomputesOf(fn: object): number;
    /** Walk source list; returns -1 if fn is not a known reactive node. */
    sourceCount(fn: object): number;
    /** Walk observer list; returns -1 if fn is not a known reactive node. */
    observerCount(fn: object): number;
};
//# sourceMappingURL=core.d.ts.map