import type { PrStatus } from '../types'

const PR_URL = String.raw`https://github\.com/([\w.-]+)/([\w.-]+)/pull/(\d+)`

// A markdown link wrapping a PR URL, or a bare (optionally <angled>) PR URL.
const LINK = new RegExp(String.raw`\[[^\]\n]*\]\(${PR_URL}[^)\s]*\)|<?${PR_URL}(?![\w/])[^\s)>\]]*>?`, 'g')

export type PrRef = { key: string; url: string }

export function prKey(owner: string, repo: string, number: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`
}

export function findPrs(text: string): PrRef[] {
  const found = new Map<string, PrRef>()
  for (const m of text.matchAll(LINK)) {
    const [owner = '', repo = '', number = ''] = m[1] ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]]
    const key = prKey(owner, repo, number)
    found.set(key, { key, url: `https://github.com/${owner}/${repo}/pull/${number}` })
  }
  return [...found.values()]
}

// Every string inside a row's content blocks, tool results included.
export function textsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(textsOf)
  if (value && typeof value === 'object') {
    const v = value as { text?: unknown; content?: unknown }
    return [...textsOf(v.text), ...textsOf(v.content)]
  }
  return []
}

// Nerd Font Octicons: git-pull-request, -draft, git-merge, -closed, check, file-diff.
const ICON = { open: '\uf407', draft: '\uf4dd', merged: '\uf419', closed: '\uf4dc', approved: '\uf42e', changes: '\uf4d2' }
const TITLE_MAX = 72

export function stateWord(s: PrStatus): string {
  if (s.state === 'MERGED') return 'merged'
  if (s.state === 'CLOSED') return 'closed'
  if (s.isDraft) return 'draft'
  if (s.reviewDecision === 'APPROVED') return 'open, approved'
  if (s.reviewDecision === 'CHANGES_REQUESTED') return 'open, changes requested'
  return 'open'
}

export function icon(s: PrStatus): string {
  if (s.state === 'MERGED') return ICON.merged
  if (s.state === 'CLOSED') return ICON.closed
  if (s.isDraft) return ICON.draft
  if (s.reviewDecision === 'APPROVED') return `${ICON.open} ${ICON.approved}`
  if (s.reviewDecision === 'CHANGES_REQUESTED') return `${ICON.open} ${ICON.changes}`
  return ICON.open
}

function linkText(title: string, number: string): string {
  const t = title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1).trimEnd()}…` : title
  return `#${number} ${t}`.replace(/[\\[\]]/g, m => `\\${m}`)
}

// Code spans and fences are left alone so a link inside code stays literal.
export function decorate(text: string, prs: Record<string, PrStatus>): string {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(LINK, (match, o1, r1, n1, o2, r2, n2) => {
            const [owner, repo, number] = o1 ? [o1, r1, n1] : [o2, r2, n2]
            const s = prs[prKey(owner, repo, number)]
            if (!s) return match
            const url = `https://github.com/${owner}/${repo}/pull/${number}`
            return `${icon(s)} [${linkText(s.title, number)}](${url})`
          }),
    )
    .join('')
}

// Titles come from strangers on public repos: drop control and bidi-override characters.
export function cleanTitle(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseGh(stdout: string): PrStatus | null {
  try {
    const j = JSON.parse(stdout)
    if (j.state !== 'OPEN' && j.state !== 'MERGED' && j.state !== 'CLOSED') return null
    return {
      state: j.state,
      isDraft: Boolean(j.isDraft),
      title: cleanTitle(j.title),
      mergedAt: j.mergedAt || null,
      reviewDecision: j.reviewDecision || null,
    }
  } catch {
    return null
  }
}

export function describeChange(key: string, before: PrStatus, after: PrStatus): string | null {
  const was = stateWord(before)
  const now = stateWord(after)
  if (was === now) return null
  const when = after.state === 'MERGED' && after.mergedAt ? ` at ${after.mergedAt}` : ''
  // No title here: this note reaches the model, and a title is untrusted text.
  return `PR ${key} changed state: ${was} → ${now}${when}.`
}
