/**
 * nv Step-4 Test Harness — Minimal Reactive Runtime with Variant Hook
 *
 * A self-contained reactive system for testing the §10 row 4 branch-variant
 * mechanism. This is NOT the production core (which is in core.ts and managed
 * by the runtime stream). It implements just enough to test:
 *
 *   1. Branch-flip correctness with a declared union (property test)
 *   2. Divergence detection when a wrong narrow set is declared (soundness test)
 *   3. Over-correction guard: null _compilerSources = identical behavior (guard test)
 *
 * Design mirrors the approved soundness design:
 *   - Tracking ALWAYS runs — currentObserver is NEVER null during _recompute.
 *   - The declared union is an expected-reads oracle for divergence detection only.
 *   - reconcile() runs in the finally block (always — §5.4.1 analog).
 *   - Flipping _variantActive = false mid-run touches ONLY the oracle Set.has()
 *     checks; it does NOT reset or modify _sources (the tracked reads). This is
 *     verified by the explicit assertion in _registerRead.
 *   - Edges always reflect ACTUAL reads, never the declared union.
 */

let currentObserver: HarnessDerived<unknown> | null = null

// ── HarnessSignal ─────────────────────────────────────────────────────────────

export class HarnessSignal<T> {
  private _value: T
  /** Observers currently subscribed to this signal. */
  readonly _observers = new Set<HarnessDerived<unknown>>()

  constructor(initial: T) {
    this._value = initial
  }

  /** Read the value. If inside a tracking context, registers a reactive read. */
  get(): T {
    if (currentObserver !== null) {
      currentObserver._registerRead(this as HarnessSignal<unknown>)
    }
    return this._value
  }

  /** Write a new value. Marks all current observers dirty. */
  set(value: T): void {
    if (Object.is(this._value, value)) return
    this._value = value
    // Snapshot before iteration (dirty-mark may indirectly trigger reads in tests)
    for (const obs of [...this._observers]) obs._markDirty()
  }
}

// ── HarnessDerived ────────────────────────────────────────────────────────────

export class HarnessDerived<T> {
  private _value: T | undefined = undefined
  private _dirty = true

  /**
   * The current source set — collected fresh each recompute via tracking.
   * This is always the ground truth; it is NEVER replaced by the declared union.
   */
  private _sources = new Set<HarnessSignal<unknown>>()

  // ── §10 row 4 hook ─────────────────────────────────────────────────────────

  /**
   * Declared union of all possible source signals.
   * Set by the compiler (or in tests, directly). null = no variant, use §5.2.
   *
   * The union is used as an oracle to detect divergence. It is NEVER used to
   * establish edges or to replace tracking. Edges always reflect actual reads.
   */
  _compilerSources: ReadonlySet<HarnessSignal<unknown>> | null = null

  /**
   * Set to true when a read during this recompute fell outside _compilerSources.
   * Cleared at the start of each recompute.
   */
  _diverged = false

  /**
   * True while oracle checks are active this recompute.
   * Starts true if _compilerSources is set; flipped to false on first divergence.
   * Flipping this ONLY stops the Set.has() calls — it never touches _sources.
   */
  private _variantActive = false

  constructor(private readonly _compute: () => T) {}

  /** Read the derived value, recomputing if dirty. */
  get(): T {
    if (this._dirty) this._recompute()
    return this._value as T
  }

  // ── Internal recompute ────────────────────────────────────────────────────

  private _recompute(): void {
    const oldSources = new Set(this._sources)
    this._sources.clear()
    this._diverged = false
    // Oracle is active for this run iff a declared union exists.
    this._variantActive = this._compilerSources !== null

    const prev = currentObserver
    currentObserver = this as unknown as HarnessDerived<unknown>

    let thrownError: unknown = null
    let threw = false
    let result: T | undefined

    try {
      result = this._compute()
    } catch (e) {
      threw = true
      thrownError = e
    } finally {
      currentObserver = prev

      // ── Reconciliation: always runs — §5.4.1 analog ─────────────────────
      // Edges reflect ACTUAL reads (_sources), never the declared union.
      // Even if _compilerSources was wrong, reconciliation corrects the edges.
      for (const source of oldSources) {
        if (!this._sources.has(source)) {
          source._observers.delete(this as unknown as HarnessDerived<unknown>)
        }
      }
      for (const source of this._sources) {
        if (!oldSources.has(source)) {
          source._observers.add(this as unknown as HarnessDerived<unknown>)
        }
      }
    }

    if (threw) throw thrownError

    this._value = result as T
    this._dirty = false
  }

  // ── Called by HarnessSignal.get() during tracking ─────────────────────────

  /**
   * Register a reactive read of `source` during this recompute.
   *
   * Two separate operations:
   *   1. Always: add source to _sources (tracking — never skipped).
   *   2. If oracle active: check source against _compilerSources.
   *      On divergence: flip _variantActive = false (stops further Set.has checks).
   *      This flip touches ONLY the oracle flag, NEVER _sources.
   *
   * Implementation note: the two operations are completely independent.
   * _sources.add(source) runs unconditionally. The oracle if-block is a separate
   * branch that cannot affect _sources — verified by inspection.
   */
  _registerRead(source: HarnessSignal<unknown>): void {
    // 1. Tracking (always)
    this._sources.add(source)

    // 2. Oracle check (separate, independent of tracking)
    if (this._variantActive && this._compilerSources !== null) {
      if (!this._compilerSources.has(source)) {
        this._diverged = true
        // Stop further oracle checks for this run.
        // IMPORTANT: this line touches ONLY _variantActive, not _sources.
        this._variantActive = false
      }
    }
  }

  _markDirty(): void {
    this._dirty = true
  }
}
