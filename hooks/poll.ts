import type { PrStatus } from '../types'
import { cleanTitle } from './lib'

export const RECENT_ROWS = 20
export const RECENT_MS = 30 * 60_000
export const IDLE_MS = 30 * 60_000
export const HOT_MS = 15_000
export const WARM_MS = 5 * 60_000
export const CLOSED_MS = 10 * 60_000
export const BATCH_MAX = 50

export type Seen = { row: number; at: number }
export type PrRef = { key: string; owner: string; repo: string; number: number }

export function isRecent(seen: Seen | undefined, row: number, now: number): boolean {
  return !!seen && (row - seen.row <= RECENT_ROWS || now - seen.at <= RECENT_MS)
}

// Merged PRs never change again; a PR not yet fetched is checked at the fast rate.
export function interval(status: PrStatus | undefined, recent: boolean): number {
  if (status?.state === 'MERGED') return Infinity
  if (status?.state === 'CLOSED') return CLOSED_MS
  return recent ? HOT_MS : WARM_MS
}

export function refOf(key: string): PrRef | null {
  const m = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(key)
  return m ? { key, owner: m[1] as string, repo: m[2] as string, number: Number(m[3]) } : null
}

// One GraphQL request for every PR, values passed as variables, never spliced into the query.
export function batchArgs(refs: PrRef[]): string[] {
  const vars = refs.map((_, i) => `$o${i}:String!,$r${i}:String!,$n${i}:Int!`).join(',')
  const fields = 'state isDraft title mergedAt reviewDecision'
  const body = refs
    .map((_, i) => `p${i}:repository(owner:$o${i},name:$r${i}){pullRequest(number:$n${i}){${fields}}}`)
    .join(' ')
  const args = ['api', 'graphql', '-f', `query=query(${vars}){${body}}`]
  refs.forEach((r, i) => args.push('-f', `o${i}=${r.owner}`, '-f', `r${i}=${r.repo}`, '-F', `n${i}=${r.number}`))
  return args
}

export function parseBatch(stdout: string, refs: PrRef[]): Map<string, PrStatus> {
  const out = new Map<string, PrStatus>()
  let data: Record<string, { pullRequest?: Record<string, unknown> | null } | null> = {}
  try {
    data = JSON.parse(stdout).data ?? {}
  } catch {
    return out
  }
  refs.forEach((r, i) => {
    const pr = data[`p${i}`]?.pullRequest
    if (!pr || (pr.state !== 'OPEN' && pr.state !== 'MERGED' && pr.state !== 'CLOSED')) return
    out.set(r.key, {
      state: pr.state,
      isDraft: Boolean(pr.isDraft),
      title: cleanTitle(pr.title),
      mergedAt: typeof pr.mergedAt === 'string' ? pr.mergedAt : null,
      reviewDecision: typeof pr.reviewDecision === 'string' && pr.reviewDecision ? pr.reviewDecision : null,
    })
  })
  return out
}
