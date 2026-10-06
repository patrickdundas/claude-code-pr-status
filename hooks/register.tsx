import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PrStatus } from '../types'
import { layout } from './layout'
import type { Run } from './layout'
import { decorate, describeChange, findPrs, textsOf } from './lib'
import { BATCH_MAX, IDLE_MS, batchArgs, interval, isRecent, parseBatch, refOf } from './poll'
import type { Seen } from './poll'

const prs = atom({ plugin: 'pr-status', key: 'prs' } as const, {} as Record<string, PrStatus>)
const isGuided = atom({ plugin: 'pr-status', key: 'isGuided' } as const, false)

const TICK_MS = 5_000
const DRAWN_ON = new Set(['terminal', 'desktop'])

const GUIDE = `# GitHub pull request links
This interface replaces every GitHub PR URL in your replies with the PR's live status icon, its number and its title, as one clickable link. Write PR references so that replacement reads cleanly:
- Write the bare URL (https://github.com/<owner>/<repo>/pull/<number>) where the PR belongs in the sentence, as if it were the PR's name: "I opened https://github.com/o/r/pull/12 for this."
- Never add the PR's title, its #number, or its open/draft/merged/closed state beside the URL. The replacement already shows them, so they would appear twice.
- Never wrap the URL in markdown link syntax or backticks, and never put it in a table. Those stop the replacement or its colors.
- For several PRs, use a list with one URL per item, plus any note about what you did with each.
Wrong: It's PR #803, "Fix login": https://github.com/o/r/pull/803
Right: It's https://github.com/o/r/pull/803.`
const GH = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']

const known = new Set<string>()
const seen = new Map<string, Seen>()
const checkedAt = new Map<string, number>()
let row = 0
let activeAt = 0
let isPolling = false

// Only conversation rows mark a PR recent; redrawing an old message must not.
function track(text: string, now?: number) {
  for (const { key } of findPrs(text)) {
    known.add(key)
    if (now !== undefined) seen.set(key, { row, at: now })
  }
}

async function runGh($: EngineInterface, args: string[]): Promise<string | null> {
  for (const gh of GH) {
    try {
      // gh exits non-zero when one PR in the batch is missing, but still prints the rest.
      return (await $.process.run([gh, ...args], { timeoutMs: 15_000 })).stdout
    } catch {
      // gh not at this path; try the next one.
    }
  }
  return null
}

async function poll($: EngineInterface, force = false) {
  if (isPolling) return
  isPolling = true
  try {
    const now = await $.clock.now()
    if (!force && now - activeAt > IDLE_MS) return
    const stored = await read($, prs)
    const due = [...known]
      .filter(key => {
        const wait = interval(stored[key], isRecent(seen.get(key), row, now))
        if (force) return wait !== Infinity
        return now - (checkedAt.get(key) ?? -Infinity) >= wait
      })
      .map(refOf)
      .filter(r => r !== null)
      .slice(0, BATCH_MAX)
    if (!due.length) return

    const stdout = await runGh($, batchArgs(due))
    const results = stdout ? parseBatch(stdout, due) : new Map<string, PrStatus>()
    const changed: Record<string, PrStatus> = {}
    const notes: string[] = []
    for (const { key } of due) {
      checkedAt.set(key, now)
      const status = results.get(key)
      const before = stored[key]
      if (!status || (before && JSON.stringify(before) === JSON.stringify(status))) continue
      changed[key] = status
      const note = before && describeChange(key, before, status)
      if (note) notes.push(note)
    }

    if (Object.keys(changed).length > 0) await update($, prs, current => ({ ...current, ...changed }))
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
    for (const key of Object.keys(await read($, prs))) known.add(key)
    activeAt = await $.clock.now()
    $.clock.every(TICK_MS, () => void poll($))
    return next(e)
  })

  // A session renders its system prompt once, so the guide rides the first prompt instead.
  on('prompt.submit', async ($, e, next) => {
    activeAt = await $.clock.now()
    await poll($, true)
    const surfaces = await $.session.surfaces()
    const isDrawn = !surfaces.length || surfaces.some(s => DRAWN_ON.has(s))
    if (!isDrawn || (await read($, isGuided))) return next(e)
    await update($, isGuided, () => true)
    return next({ ...e, context: [...(e.context ?? []), GUIDE] })
  }).catch(($, e, next) => next(e))

  // Compaction can drop the guide from the conversation, so send it again afterwards.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (!('skip' in result)) await update($, isGuided, () => false)
    return result
  }).catch(($, e, next) => next(e))

  on('session.append', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      activeAt = now
      row += 1
      for (const text of textsOf(e.message.content)) track(text, now)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    track(e.props.text)
    const stored = await read($, prs)
    const blocks = e.props.isSummary ? null : layout(e.props.text, stored)
    if (!blocks) {
      const text = decorate(e.props.text, stored)
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
