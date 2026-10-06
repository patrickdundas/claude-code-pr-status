import type { PrStatus } from '../types'
import { decorate, prKey } from './lib'

export type Run = {
  text: string
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  href?: string
}

export type Block =
  | { kind: 'md'; text: string }
  | { kind: 'blank' }
  | { kind: 'line'; runs: Run[] }

// Nerd Font Octicons, coloured as GitHub does, using Claude Code theme keys.
const OCT = { open: '', draft: '', merged: '', closed: '', check: '', diff: '' }
const TITLE_MAX = 72

const PR = (n: string) => String.raw`https://github\.com/(?<o${n}>[\w.-]+)/(?<r${n}>[\w.-]+)/pull/(?<n${n}>\d+)`
const INLINE = new RegExp(
  [
    String.raw`(?<code>\x60[^\x60\n]+\x60)`,
    String.raw`(?<prmd>\[[^\]\n]*\]\(${PR('1')}[^)\s]*\))`,
    String.raw`(?<md>\[(?<mdt>[^\]\n]*)\]\((?<mdu>[^)\s]+)\))`,
    String.raw`(?<bold>\*\*[^*\n]+\*\*)`,
    String.raw`(?<it>\*[^*\s][^*\n]*\*)`,
    String.raw`(?<prbare><?${PR('2')}(?![\w/])[^\s)>\]]*>?)`,
    String.raw`(?<url>https?://[^\s)>\]]+)`,
  ].join('|'),
  'g',
)
const PR_ANY = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g

export function iconRuns(s: PrStatus): Run[] {
  if (s.state === 'MERGED') return [{ text: OCT.merged, color: 'merged' }]
  if (s.state === 'CLOSED') return [{ text: OCT.closed, color: 'error' }]
  if (s.isDraft) return [{ text: OCT.draft, color: 'inactive' }]
  const open: Run = { text: OCT.open, color: 'success' }
  if (s.reviewDecision === 'APPROVED') return [open, { text: ' ' }, { text: OCT.check, color: 'success' }]
  if (s.reviewDecision === 'CHANGES_REQUESTED') return [open, { text: ' ' }, { text: OCT.diff, color: 'error' }]
  return [open]
}

function title(s: PrStatus): string {
  return s.title.length > TITLE_MAX ? `${s.title.slice(0, TITLE_MAX - 1).trimEnd()}…` : s.title
}

const SEP = String.raw`\s*[,:;\u2013\u2014-]?\s*`
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The badge already shows number and title, so drop a copy written right beside the link.
function echoes(number: string, s: PrStatus): { before: RegExp; after: RegExp; whole: RegExp } {
  const num = String.raw`\(?(?:PR\s*)?#${number}\b\)?`
  const ttl = s.title ? String.raw`["\u201c'*_]*${escape(s.title)}["\u201d'*_]*` : '(?!)'
  const any = String.raw`(?:${num}(?:${SEP}${ttl})?|${ttl}(?:${SEP}${num})?)`
  return {
    before: new RegExp(String.raw`(^|\s)${any}${SEP}$`, 'i'),
    after: new RegExp(String.raw`^\s*(?:\(${any}\)|${SEP}${num})(?=\W|$)`, 'i'),
    whole: new RegExp(String.raw`^\s*${any}\s*$`, 'i'),
  }
}

const ONLY_SEP = new RegExp(String.raw`^${SEP}$`)

function trimBefore(runs: Run[], e: ReturnType<typeof echoes>) {
  let end = runs.length
  for (let i = runs.length - 1; i >= 0 && i >= runs.length - 4; i--) {
    const r = runs[i] as Run
    if (r.href) return
    if (ONLY_SEP.test(r.text)) continue
    if (e.whole.test(r.text)) {
      runs.splice(i, end - i)
      end = i
      continue
    }
    const text = r.text.replace(e.before, '$1')
    if (text !== r.text) runs.splice(i, end - i, { ...r, text })
    return
  }
}

export function inlineRuns(line: string, prs: Record<string, PrStatus>): Run[] {
  const runs: Run[] = []
  let at = 0
  let echo: ReturnType<typeof echoes> | null = null
  const plain = (text: string) => {
    if (echo) text = text.replace(echo.after, '')
    echo = null
    if (text) runs.push({ text })
  }
  for (const m of line.matchAll(INLINE)) {
    const g = m.groups ?? {}
    if (m.index > at) plain(line.slice(at, m.index))
    else echo = null
    at = m.index + m[0].length
    const owner = g.o1 ?? g.o2
    const repo = g.r1 ?? g.r2
    const number = g.n1 ?? g.n2
    if (owner && repo && number) {
      const href = `https://github.com/${owner}/${repo}/pull/${number}`
      const s = prs[prKey(owner, repo, number)]
      if (s) {
        echo = echoes(number, s)
        trimBefore(runs, echo)
        const icons = iconRuns(s)
        runs.push(...icons, { text: ' ' }, { text: `#${number}`, color: icons[0]?.color, bold: true, href })
        runs.push({ text: ' ' }, { text: title(s), underline: true, href })
        continue
      }
      else runs.push({ text: href, href })
    } else if (g.code) runs.push({ text: g.code.slice(1, -1), color: 'permission' })
    else if (g.md) runs.push(isWeb(g.mdu) ? { text: g.mdt || (g.mdu as string), href: g.mdu } : { text: g.md })
    else if (g.bold) runs.push({ text: g.bold.slice(2, -2), bold: true })
    else if (g.it) runs.push({ text: g.it.slice(1, -1), italic: true })
    else if (g.url) runs.push({ text: g.url, href: g.url })
  }
  if (at < line.length) plain(line.slice(at))
  return runs
}

function isWeb(url: string | undefined): boolean {
  return /^https?:\/\//i.test(url ?? '')
}

function hasKnownPr(line: string, prs: Record<string, PrStatus>): boolean {
  for (const m of line.matchAll(PR_ANY)) {
    if (prs[prKey(m[1] as string, m[2] as string, m[3] as string)]) return true
  }
  return false
}

// Lines holding a known PR (outside fences and tables) are drawn by the mod so
// their icons can be coloured; everything else stays engine-drawn markdown.
export function layout(text: string, prs: Record<string, PrStatus>): Block[] | null {
  const blocks: Block[] = []
  let md: string[] = []
  let inFence = false
  let owned = false

  const flush = () => {
    while (md.length && !md[0]?.trim()) md.shift()
    let trailingBlank = false
    while (md.length && !md[md.length - 1]?.trim()) {
      md.pop()
      trailingBlank = true
    }
    if (md.length) blocks.push({ kind: 'md', text: decorate(md.join('\n'), prs) })
    if (trailingBlank) blocks.push({ kind: 'blank' })
    md = []
  }

  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const isTable = /^\s*\|/.test(line)
    if (inFence || isTable || !hasKnownPr(line, prs)) {
      if (!md.length && !line.trim() && blocks.length && blocks[blocks.length - 1]?.kind !== 'blank') {
        blocks.push({ kind: 'blank' })
        continue
      }
      md.push(line)
      continue
    }
    flush()
    owned = true
    const lead = /^(\s*)([-*+]|\d+\.)\s+/.exec(line)
    const heading = /^#{1,6}\s+/.exec(line)
    const quote = /^>\s?/.exec(line)
    const runs: Run[] = []
    let body = line
    if (lead) {
      const marker = /\d/.test(lead[2] as string) ? (lead[2] as string) : '-'
      runs.push({ text: `${lead[1]}${marker} ` })
      body = line.slice(lead[0].length)
    } else if (quote) {
      runs.push({ text: '▎ ', color: 'inactive' })
      body = line.slice(quote[0].length)
    } else if (heading) {
      body = line.slice(heading[0].length)
    }
    const inline = inlineRuns(body, prs)
    runs.push(...(heading ? inline.map(r => ({ ...r, bold: true })) : inline))
    blocks.push({ kind: 'line', runs })
  }
  flush()
  while (blocks[blocks.length - 1]?.kind === 'blank') blocks.pop()
  return owned ? blocks : null
}
