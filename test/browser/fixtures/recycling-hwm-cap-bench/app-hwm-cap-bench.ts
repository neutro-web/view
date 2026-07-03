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

  let dispose = () => {}
  createRoot((d) => {
    dispose = d
    const anchor = doc.createComment('recycle-anchor')
    parent.appendChild(anchor)
    wireRecycledList(
      {
        kind: 'recycled-list',
        items: () => allRows().slice(0, windowN()),
        itemTemplate: (valueSig, indexSig) => ({
          id: 'hwm-cap-bench-row',
          shape: { html: '<div><!--nv-0--></div>', bindingPaths: [[0], [0, 0]] },
          bindings: [
            { kind: 'attr', pathIndex: 0, name: 'data-id', expr: () => valueSig().id },
            { kind: 'text', pathIndex: 1, expr: () => valueSig().label },
          ],
        }),
      },
      anchor,
      doc,
    )
  })

  return {
    dispose,
    setN: (n: number) => {
      windowN.set(n)
      flushSync()
    },
  }
}
