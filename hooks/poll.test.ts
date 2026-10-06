import { describe, expect, test } from 'claude-code/testing'

import type { PrStatus } from '../types'
import { CLOSED_MS, HOT_MS, RECENT_MS, WARM_MS, batchArgs, interval, isRecent, parseBatch, refOf } from './poll'

const open: PrStatus = { state: 'OPEN', isDraft: false, title: 'Fix', mergedAt: null, reviewDecision: null }

describe('poll schedule', () => {
  test('recent by row count or by time', async () => {
    expect(isRecent({ row: 10, at: 0 }, 30, RECENT_MS + 1)).toBe(true)
    expect(isRecent({ row: 10, at: 0 }, 31, RECENT_MS)).toBe(true)
    expect(isRecent({ row: 10, at: 0 }, 31, RECENT_MS + 1)).toBe(false)
    expect(isRecent(undefined, 0, 0)).toBe(false)
  })

  test('intervals by state and recency', async () => {
    expect(interval(open, true)).toBe(HOT_MS)
    expect(interval(open, false)).toBe(WARM_MS)
    expect(interval(undefined, false)).toBe(WARM_MS)
    expect(interval({ ...open, state: 'CLOSED' }, true)).toBe(CLOSED_MS)
    expect(interval({ ...open, state: 'MERGED' }, true)).toBe(Infinity)
  })
})

describe('batch query', () => {
  const refs = [refOf('a/b#1'), refOf('c/d#2')].filter(r => r !== null)

  test('passes owner, repo and number as variables', async () => {
    const args = batchArgs(refs)
    expect(args.slice(0, 2)).toEqual(['api', 'graphql'])
    expect(args).toContain('o1=c')
    expect(args).toContain('n1=2')
    expect(args[3]).toContain('p1:repository(owner:$o1,name:$r1){pullRequest(number:$n1)')
  })

  test('keeps found PRs and skips missing ones', async () => {
    const stdout = JSON.stringify({
      data: { p0: { pullRequest: { state: 'MERGED', isDraft: false, title: 'x\u001by', mergedAt: 't', reviewDecision: '' } }, p1: { pullRequest: null } },
      errors: [{ type: 'NOT_FOUND' }],
    })
    const out = parseBatch(stdout, refs)
    expect([...out.keys()]).toEqual(['a/b#1'])
    expect(out.get('a/b#1')).toEqual({ state: 'MERGED', isDraft: false, title: 'x y', mergedAt: 't', reviewDecision: null })
  })
})
