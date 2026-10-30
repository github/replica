import type { HubPrototype } from "@utils/prototype-canvas/types"

export type ShareLink = {
  id: number
  url: string
  buildNumber: number
  label: string
  expiresAt: string | null
  createdAt?: string
  createdBy?: { login: string; name: string | null }
}

export type ShareContext = {
  target: string
  hubOrigin: string
  repository: string
  branch: string
  prototype: HubPrototype
  controlSettingsIncluded?: boolean
  controlSettingsError?: string
}

export type SharePage = {
  shareLinks: ShareLink[]
  hasMore: boolean
  nextCursor: string | null
}

export type SharingState = {
  open: boolean
  context: ShareContext | null
  links: ShareLink[]
  loading: boolean
  busy: boolean
  stale: boolean
  error: string
  notice: string
  created: ShareLink | null
  authorization?: { url: string; expiresAt: string }
  sharingDisabled?: boolean
}
