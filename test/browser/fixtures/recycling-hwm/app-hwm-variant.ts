// @ts-nocheck
import { createRoot, flushSync, signal } from '@neutro/view/core'
import { wireRecycledListHWM } from '@neutro/view/renderer/internal'

export function mount(parent: Element, doc: Document) {
  const M = 10000
  function makeRows(count: number, offset: number) {
    const out = []
    for (let i = 0; i < count; i++)
      out.push({ id: offset + i, label: `row-${offset + i}`, marker: '' })
    return out
  }
  const allRows = signal(makeRows(M, 0))
  const windowN = signal(50)

  // Test-only introspection: capture each row's valueSig in pool-index order as it is
  // allocated (itemTemplate is only invoked on the grow path, exactly like the pool's
  // push order), plus a cache of the mounted DOM node per row index — the latter is
  // populated opportunistically whenever a row is attached, so it remains readable
  // (even for attribute reads) after the row is later detached (shrunk-out but not
  // disposed).
  const capturedSigs: Array<{ set(v: unknown): void }> = []
  const nodeCache = new Map<number, Element>()

  const wrapper = doc.createElement('div')
  wrapper.id = 'variant-root'
  parent.appendChild(wrapper)

  let dispose = () => {}
  createRoot((d) => {
    dispose = d
    const anchor = doc.createComment('recycle-anchor')
    wrapper.appendChild(anchor)
    wireRecycledListHWM(
      {
        kind: 'recycled-list',
        items: () => allRows().slice(0, windowN()),
        itemTemplate: (valueSig, indexSig) => {
          capturedSigs.push(valueSig)
          return {
            id: 'hwm-row',
            shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0], [0, 0]] },
            bindings: [
              { kind: 'attr', pathIndex: 0, name: 'data-id', expr: () => valueSig().id },
              { kind: 'attr', pathIndex: 0, name: 'data-marker', expr: () => valueSig().marker },
              { kind: 'text', pathIndex: 1, expr: () => valueSig().label },
            ],
          }
        },
      },
      anchor,
      doc,
    )
  })

  function refreshNodeCache() {
    for (const el of Array.from(wrapper.querySelectorAll('[data-id]'))) {
      const id = Number(el.getAttribute('data-id'))
      nodeCache.set(id, el as Element)
    }
  }
  refreshNodeCache()

  // Test-only pool view: pool[i].valueSig is the same signal wireRecycledListHWM's
  // internal pool holds at slot i (capture order mirrors pool push order — see
  // itemTemplate above); pool[i].rootEl is the last-known mounted node for that slot,
  // readable (including its attributes/text) even while detached.
  const pool = new Proxy(
    {},
    {
      get(_t, prop) {
        const i = Number(prop)
        if (Number.isNaN(i)) return undefined
        const valueSig = capturedSigs[i]
        if (valueSig === undefined) return undefined
        return { valueSig, rootEl: nodeCache.get(i) ?? null }
      },
    },
  )

  return {
    root: wrapper,
    dispose,
    pool,
    setN: (n: number) => {
      windowN.set(n)
      flushSync()
      refreshNodeCache()
    },
    // Mutates the *backing data source* (allRows), not the pooled valueSig directly —
    // exercises wireRecycledListHWM's own resize/rebind effect, proving its rebind
    // loop (i < activeCount) never reads/writes an inactive row's slice of `next`.
    pokeBackingRow: (rowIndex: number, newLabel: string) => {
      const rows = allRows().slice()
      const row = rows[rowIndex]
      if (row === undefined) throw new Error(`pokeBackingRow: no row at index ${rowIndex}`)
      rows[rowIndex] = { ...row, label: newLabel }
      allRows.set(rows)
      flushSync()
      refreshNodeCache()
    },
  }
}
