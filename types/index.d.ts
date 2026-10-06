export type PrState = 'OPEN' | 'MERGED' | 'CLOSED'

export type PrStatus = {
  state: PrState
  isDraft: boolean
  title: string
  mergedAt: string | null
  reviewDecision: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'pr-status': { prs: Record<string, PrStatus>; isGuided: boolean }
  }
}
