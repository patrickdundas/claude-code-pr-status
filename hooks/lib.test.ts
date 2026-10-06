import { describe, expect, test } from 'claude-code/testing'

import type { PrStatus } from '../types'
import { decorate, describeChange, findPrs, parseGh } from './lib'

const open: PrStatus = { state: 'OPEN', isDraft: false, title: 'Fix', mergedAt: null, reviewDecision: null }
const merged: PrStatus = { ...open, state: 'MERGED', mergedAt: '2026-10-06T12:00:00Z' }

describe('pr links', () => {
  test('finds bare, angled and markdown links once each', async () => {
    const text = 'See https://github.com/Acme/App/pull/12 and [#12](https://github.com/acme/app/pull/12/files) and <https://github.com/x/y/pull/3>'
    expect(findPrs(text).map(p => p.key)).toEqual(['acme/app#12', 'x/y#3'])
  })

  test('replaces links with icon and title, skipping code', async () => {
    const text = 'PR [#12](https://github.com/acme/app/pull/12/files) and https://github.com/Acme/App/pull/12 and `https://github.com/acme/app/pull/12`'
    expect(decorate(text, { 'acme/app#12': { ...merged, title: 'Fix [bug]' } })).toBe(
      'PR \uf419 [#12 Fix \\[bug\\]](https://github.com/acme/app/pull/12) and \uf419 [#12 Fix \\[bug\\]](https://github.com/Acme/App/pull/12) and `https://github.com/acme/app/pull/12`',
    )
  })

  test('approved open PR shows both icons', async () => {
    expect(decorate('https://github.com/a/b/pull/1', { 'a/b#1': { ...open, reviewDecision: 'APPROVED' } })).toBe(
      '\uf407 \uf42e [#1 Fix](https://github.com/a/b/pull/1)',
    )
  })

  test('leaves unknown PRs alone', async () => {
    const text = 'https://github.com/acme/app/pull/9'
    expect(decorate(text, {})).toBe(text)
  })

  test('parses gh output and describes a merge', async () => {
    const s = parseGh(JSON.stringify({ state: 'MERGED', isDraft: false, title: 'Fix', mergedAt: '2026-10-06T12:00:00Z', reviewDecision: '' }))
    expect(s).toEqual(merged)
    expect(describeChange('acme/app#12', open, merged)).toBe(
      'PR acme/app#12 ("Fix") changed state: open → merged at 2026-10-06T12:00:00Z.',
    )
    expect(describeChange('acme/app#12', open, open)).toBeNull()
  })
})
