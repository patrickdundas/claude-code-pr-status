import type { PromptSubmitInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

// The kit fills in the rest of a typed prompt's input.
const typed = (text: string) => ({ text }) as unknown as PromptSubmitInput
const isGuide = (c: string) => c.startsWith('# GitHub pull request links')

describe('PR link guide', () => {
  test('rides the first prompt only', async ($, on) => {
    mock.clock(on)
    on('session.surfaces', () => ({ value: ['terminal' as const] }))
    const seen: (readonly string[] | undefined)[] = []
    on('prompt.submit', ($, e) => {
      seen.push(e.context)
      return { text: e.text, context: e.context }
    })
    await $.prompt.submit(typed('one'))
    await $.prompt.submit(typed('two'))
    expect(seen.length).toBe(2)
    expect(seen[0]?.some(isGuide)).toBe(true)
    expect(seen[1]?.some(isGuide) ?? false).toBe(false)
  })

  test('left out where badges are not drawn', async ($, on) => {
    mock.clock(on)
    on('session.surfaces', () => ({ value: ['vscode' as const] }))
    const seen: (readonly string[] | undefined)[] = []
    on('prompt.submit', ($, e) => {
      seen.push(e.context)
      return { text: e.text, context: e.context }
    })
    await $.prompt.submit(typed('one'))
    expect(seen[0]?.some(isGuide) ?? false).toBe(false)
  })
})
