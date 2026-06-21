import { describe, it } from 'vitest'
import type { ComponentBinding, PropEntry, SlotEntry } from '../../src/renderer/ir.js'

describe('ComponentBinding types', () => {
  it('is assignable from a well-formed object', () => {
    const b: ComponentBinding = {
      kind: 'component',
      pathIndex: 0,
      component: (_props, _slots) => ({
        id: 'c',
        shape: { html: '', bindingPaths: [] },
        bindings: [],
      }),
      props: [{ name: 'count', expr: () => 42 }] satisfies PropEntry[],
      propNames: ['count'],
      slots: [
        {
          name: 'default',
          content: { id: 's', shape: { html: '', bindingPaths: [] }, bindings: [] },
        },
      ] satisfies SlotEntry[],
    }
    // TypeScript will error at compile time if types are wrong.
    void b
  })
})
