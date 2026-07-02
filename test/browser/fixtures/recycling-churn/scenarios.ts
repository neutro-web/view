import type { Page } from '@playwright/test'

export type MutationScenario = {
  key: 'grow' | 'shrink' | 'replace' | 'append' | 'prepend'
  label: string
  stepButtonIds: string[]
}

// Note: 'grow' and 'shrink' are the same N-oscillation (50↔100) with the click
// order reversed, not independently-designed mutations — both directions of the
// documented "window grow/shrink" requirement are covered this way without a
// separate windowN size to add.
export const SCENARIOS: MutationScenario[] = [
  { key: 'grow', label: 'window grow (N=50→100)', stepButtonIds: ['#set-n-50', '#set-n-100'] },
  { key: 'shrink', label: 'window shrink (N=100→50)', stepButtonIds: ['#set-n-100', '#set-n-50'] },
  { key: 'replace', label: 'full replace', stepButtonIds: ['#replace-all'] },
  { key: 'append', label: 'append tail', stepButtonIds: ['#append-rows'] },
  { key: 'prepend', label: 'prepend head', stepButtonIds: ['#prepend-rows'] },
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
