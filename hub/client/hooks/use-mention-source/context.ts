import { createContext } from "react"

export interface MentionCandidate {
  githubId: number
  login: string
  avatarUrl: string | null
}

export interface MentionSource {
  load: () => Promise<MentionCandidate[]>
  copy: {
    suggestions: string
    error: string
    loading: string
    empty: string
    retry: string
    limit?: string
  }
}

export const MentionSourceContext = createContext<MentionSource | null>(null)
