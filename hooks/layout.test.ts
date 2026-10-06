import { describe, expect, test } from 'claude-code/testing'

import type { PrStatus } from '../types'
import { layout } from './layout'

const merged: PrStatus = { state: 'MERGED', isDraft: false, title: 'Fix', mergedAt: null, reviewDecision: null }
const prs = { 'a/b#1': merged }

describe('layout', () => {
  test('returns null when no line holds a known PR', async () => {
    expect(layout('hello https://github.com/a/b/pull/2', prs)).toBeNull()
  })

  test('owns only the PR line, keeping markdown around it', async () => {
    const blocks = layout('Intro **bold**\n\n- see https://github.com/a/b/pull/1 now\n\nOutro', prs)
    expect(blocks?.map(b => b.kind)).toEqual(['md', 'blank', 'line', 'blank', 'md'])
    const line = blocks?.[2]
    expect(line?.kind === 'line' && line.runs).toEqual([
      { text: '- ' },
      { text: 'see ' },
      { text: '', color: 'merged' },
      { text: ' ' },
      { text: '#1', color: 'merged', bold: true, href: 'https://github.com/a/b/pull/1' },
      { text: ' ' },
      { text: 'Fix', underline: true, href: 'https://github.com/a/b/pull/1' },
      { text: ' now' },
    ])
  })

  test('only web links become clickable', async () => {
    const blocks = layout('https://github.com/a/b/pull/1 [x](file:///etc/passwd) [y](https://e.com)', prs)
    const runs = blocks?.[0]?.kind === 'line' ? blocks[0].runs : []
    expect(runs.filter(r => r.href).map(r => r.href)).toEqual([
      'https://github.com/a/b/pull/1',
      'https://github.com/a/b/pull/1',
      'https://e.com',
    ])
    expect(runs.some(r => r.text === '[x](file:///etc/passwd)' && !r.href)).toBe(true)
  })

  test('drops a number or title echoed beside the badge', async () => {
    const t = { 'a/b#803': { ...merged, title: 'Events: trim bounds' } }
    const text = (line: string) => {
      const b = layout(line, t)?.[0]
      return b?.kind === 'line' ? b.runs.map(r => r.text).join('') : null
    }
    const badge = '\uf419 #803 Events: trim bounds'
    expect(text('It\'s PR #803, "Events: trim bounds": https://github.com/a/b/pull/803')).toBe(`It's ${badge}`)
    expect(text('See #803 https://github.com/a/b/pull/803 (#803) now')).toBe(`See ${badge} now`)
    expect(text('**Events: trim bounds** — https://github.com/a/b/pull/803')).toBe(badge)
    expect(text('PR https://github.com/a/b/pull/803 is merged')).toBe(`PR ${badge} is merged`)
    expect(text('Issue #80 relates to https://github.com/a/b/pull/803')).toBe(`Issue #80 relates to ${badge}`)
  })

  test('leaves PR links inside code fences and tables to markdown', async () => {
    expect(layout('```\nhttps://github.com/a/b/pull/1\n```\n| https://github.com/a/b/pull/1 |', prs)).toBeNull()
  })
})
