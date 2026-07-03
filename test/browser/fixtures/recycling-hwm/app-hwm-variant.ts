// @ts-nocheck
import { createRoot, flushSync, signal } from '@neutro/view/core'
import { wireRecycledList } from '@neutro/view/renderer/internal'

export function mount(parent: Element, doc: Document, poolSize = 10000) {
  const M = poolSize
  function makeRows(count: number, offset: number) {
    const out = []
    for (let i = 0; i < count; i++) out.push({ id: offset + i, label: `row-${offset + i}` })
    return out
  }
  const allRows = signal(makeRows(M, 0))
  const windowN = signal(50)

  const wrapper = doc.createElement('div')
  wrapper.id = 'variant-root'
  parent.appendChild(wrapper)

  // Test-only introspection: wireRecycledList's debug hook hands back a live
  // reference to its real internal `pool` array (same identity it mutates
  // internally — pushes on grow, never removed). Reading pool[i].rootEl gives the
  // real mounted node for slot i, including while it is retained-but-detached
  // (shrunk-out but not disposed), without ever needing document.querySelector.
  let pool: readonly { valueSig: { (): unknown }; rootEl: Node }[] = []

  let dispose = () => {}
  createRoot((d) => {
    dispose = d
    const anchor = doc.createComment('recycle-anchor')
    wrapper.appendChild(anchor)
    wireRecycledList(
      {
        kind: 'recycled-list',
        items: () => allRows().slice(0, windowN()),
        itemTemplate: (valueSig, indexSig) => {
          return {
            id: 'hwm-row',
            shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0], [0, 0]] },
            bindings: [
              { kind: 'attr', pathIndex: 0, name: 'data-id', expr: () => valueSig().id },
              { kind: 'text', pathIndex: 1, expr: () => valueSig().label },
            ],
          }
        },
      },
      anchor,
      doc,
      (p) => {
        pool = p
      },
    )
  })

  let nextId = M
  let replaceVersion = 0
  function replaceAll() {
    replaceVersion++
    const v = replaceVersion
    // Negative-id namespace keeps replaceAll's generated ids disjoint from
    // appendRows/prependRows's positive namespace (which starts at nextId = M),
    // so interleaving these mutations can never produce a coincidental id collision.
    allRows.set(allRows().map((r, idx) => ({ id: -(v * M + idx) - 1, label: `v${v}-${idx}` })))
    flushSync()
  }
  function appendRows(count: number) {
    const added = makeRows(count, nextId)
    nextId += count
    allRows.set([...allRows(), ...added])
    flushSync()
  }
  function prependRows(count: number) {
    const added = makeRows(count, nextId)
    nextId += count
    allRows.set([...added, ...allRows()])
    flushSync()
  }

  return {
    root: wrapper,
    dispose,
    pool,
    setN: (n: number) => {
      windowN.set(n)
      flushSync()
    },
    // Mutates the *backing data source* (allRows), not the pooled valueSig directly —
    // exercises wireRecycledList's own resize/rebind effect, proving its rebind
    // loop (i < activeCount) never reads/writes an inactive row's slice of `next`.
    pokeBackingRow: (rowIndex: number, newLabel: string) => {
      const rows = allRows().slice()
      const row = rows[rowIndex]
      if (row === undefined) throw new Error(`pokeBackingRow: no row at index ${rowIndex}`)
      rows[rowIndex] = { ...row, label: newLabel }
      allRows.set(rows)
      flushSync()
    },
    replaceAll,
    appendRows,
    prependRows,
    setNNoFlush: (n: number) => {
      windowN.set(n)
    },
    flush: () => {
      flushSync()
    },
  }
}
