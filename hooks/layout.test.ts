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

  test('leaves PR links inside code fences and tables to markdown', async () => {
    expect(layout('```\nhttps://github.com/a/b/pull/1\n```\n| https://github.com/a/b/pull/1 |', prs)).toBeNull()
  })
})
