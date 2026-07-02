import type { Page } from '@playwright/test'

export type MutationScenario = {
  key: 'grow' | 'shrink' | 'replace' | 'append' | 'prepend'
  label: string
  stepButtonIds: string[]
  mode: 'failable' | 'advisory'
}

// Note: 'grow' and 'shrink' are the same N-oscillation (50↔100) with the click
// order reversed, not independently-designed mutations — both directions of the
// documented "window grow/shrink" requirement are covered this way without a
// separate windowN size to add.
//
// grow/shrink are 'advisory', not 'failable': <recycle>'s pool
// (wireRecycledList, src/renderer/interpreter.ts:777-849) sizes to exactly the
// current list length on every run with no free-list retention across a
// resize — shrinking disposes the excess pool entries, growing allocates
// fresh ones. There is no zero-churn guarantee across a windowN change (only
// the fixed-size sliding-window scroll, 8da893a's original claim, is
// zero-churn). Discovered during Task 3 implementation — see plan's
// "Deviation discovered during execution" section. Logged for a future
// commission to decide whether high-water-mark pooling is worth building.
export const SCENARIOS: MutationScenario[] = [
  {
    key: 'grow',
    label: 'window grow (N=50→100)',
    stepButtonIds: ['#set-n-50', '#set-n-100'],
    mode: 'advisory',
  },
  {
    key: 'shrink',
    label: 'window shrink (N=100→50)',
    stepButtonIds: ['#set-n-100', '#set-n-50'],
    mode: 'advisory',
  },
  { key: 'replace', label: 'full replace', stepButtonIds: ['#replace-all'], mode: 'failable' },
  { key: 'append', label: 'append tail', stepButtonIds: ['#append-rows'], mode: 'failable' },
  { key: 'prepend', label: 'prepend head', stepButtonIds: ['#prepend-rows'], mode: 'failable' },
]

export async function mutationStep(
  page: Page,
  scenario: MutationScenario,
  flush: () => Promise<void>,
): Promise<void> {
  for (const id of scenario.stepButtonIds) {
    await page.locator(id).click()
    await flush()
  }
}
