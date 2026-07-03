import type { Page } from '@playwright/test'

export type MutationScenario = {
  key:
    | 'grow'
    | 'shrink'
    | 'replace'
    | 'append'
    | 'prepend'
    | 'grow-medium'
    | 'shrink-medium'
    | 'grow-large-spike'
    | 'shrink-large-spike'
  label: string
  stepButtonIds: string[]
  mode: 'failable' | 'advisory'
}

// Note: 'grow' and 'shrink' are the same N-oscillation (50↔100) with the click
// order reversed, not independently-designed mutations — both directions of the
// documented "window grow/shrink" requirement are covered this way without a
// separate windowN size to add.
//
// grow/shrink were advisory because the pre-collapse wireRecycledList (a separate,
// non-retaining implementation, deleted in Follow-up B' Phase 2) had no free-list
// retention across a resize. Post-collapse, wireRecycledList IS the HWM-pooling
// implementation and grow/shrink are now genuinely zero-churn — see
// docs/superpowers/handoffs/2026-07-03-followup-b-prime-phase2-landing.md.
// Left as `mode: 'advisory'` deliberately: tightening to 'failable' is a distinct
// decision (whether to make this a build-blocking gate), not decided by this task.
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
  {
    key: 'grow-medium',
    label: 'window grow (N=500→1000)',
    stepButtonIds: ['#set-n-500', '#set-n-1000'],
    mode: 'advisory',
  },
  {
    key: 'shrink-medium',
    label: 'window shrink (N=1000→500)',
    stepButtonIds: ['#set-n-1000', '#set-n-500'],
    mode: 'advisory',
  },
  {
    key: 'grow-large-spike',
    label: 'window grow-spike (N=100→5000)',
    stepButtonIds: ['#set-n-100', '#set-n-5000'],
    mode: 'advisory',
  },
  {
    key: 'shrink-large-spike',
    label: 'window shrink-spike (N=5000→100)',
    stepButtonIds: ['#set-n-5000', '#set-n-100'],
    mode: 'advisory',
  },
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
