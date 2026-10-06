import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PrStatus } from '../types'
import { layout } from './layout'
import type { Run } from './layout'
import { decorate, describeChange, findPrs, parseGh, textsOf } from './lib'

const prs = atom({ plugin: 'pr-status', key: 'prs' } as const, {} as Record<string, PrStatus>)

const OPEN_POLL_MS = 60_000
const CLOSED_POLL_MS = 10 * 60_000
const TICK_MS = 10_000
const GH = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']

const urls = new Map<string, string>()
const nextPollAt = new Map<string, number>()
let isPolling = false

function track(text: string) {
  for (const { key, url } of findPrs(text)) {
    if (!urls.has(key)) urls.set(key, url)
  }
}

async function fetchStatus($: EngineInterface, url: string): Promise<PrStatus | null> {
  const fields = 'state,isDraft,title,mergedAt,reviewDecision'
  for (const gh of GH) {
    try {
      const r = await $.process.run([gh, 'pr', 'view', url, '--json', fields], { timeoutMs: 20_000 })
      return r.exitCode === 0 ? parseGh(r.stdout) : null
    } catch {
      // gh not at this path; try the next one.
    }
  }
  return null
}

async function poll($: EngineInterface) {
  if (isPolling) return
  isPolling = true
  try {
    const now = await $.clock.now()
    const known = await read($, prs)
    const due = [...urls].filter(([key]) => (nextPollAt.get(key) ?? 0) <= now)
    const results = await Promise.all(due.map(async ([key, url]) => [key, await fetchStatus($, url)] as const))

    const changed: Record<string, PrStatus> = {}
    const notes: string[] = []
    for (const [key, status] of results) {
      if (!status) {
        nextPollAt.set(key, now + OPEN_POLL_MS)
        continue
      }
      nextPollAt.set(key, now + (status.state === 'OPEN' ? OPEN_POLL_MS : CLOSED_POLL_MS))
      const before = known[key]
      if (before && JSON.stringify(before) === JSON.stringify(status)) continue
      changed[key] = status
      const note = before && describeChange(key, before, status)
      if (note) notes.push(note)
    }

    if (Object.keys(changed).length > 0) {
      await update($, prs, current => ({ ...current, ...changed }))
    }
    for (const note of notes) {
      $.ui.toast(note)
      await $.session.append({
        message: { type: 'user', content: [{ type: 'text', text: `[pr-status mod] ${note}` }] },
      })
    }
  } finally {
    isPolling = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const key of Object.keys(await read($, prs))) {
      const [repo, number] = key.split('#')
      urls.set(key, `https://github.com/${repo}/pull/${number}`)
    }
    $.clock.every(TICK_MS, () => void poll($))
    return next(e)
  })

  on('session.append', ($, e, next) => {
    for (const text of textsOf(e.message.content)) track(text)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    track(e.props.text)
    const known = await read($, prs)
    const blocks = e.props.isSummary ? null : layout(e.props.text, known)
    if (!blocks) {
      const text = decorate(e.props.text, known)
      return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
    }

    const { Box, Text, Link, Markdown } = $.ui.resolve(e)
    const run = (r: Run, i: number) => {
      const body = (
        <Text key={`t${i}`} color={r.color} bold={r.bold} italic={r.italic} underline={r.underline}>
          {r.text}
        </Text>
      )
      return r.href ? <Link key={`k${i}`} href={r.href}>{body}</Link> : body
    }
    return (
      <Box flexDirection="column">
        {blocks.map((b, i) =>
          b.kind === 'md' ? (
            <Markdown key={`m${i}`} text={b.text} />
          ) : b.kind === 'blank' ? (
            <Text key={`b${i}`}> </Text>
          ) : (
            <Text key={`l${i}`}>{b.runs.map(run)}</Text>
          ),
        )}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
