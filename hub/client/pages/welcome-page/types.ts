import type { HubWorkspaceData } from "@features/hub-workspace/types"

export interface WelcomePageData {
  workspace: HubWorkspaceData
  heading: string
  description: string
  videoUrl: string | null
  videoEmbedUrl: string | null
  videoWatchUrl?: string
  videoPosterUrl: string | null
  videoLabel: string
  videoDescription: string
  videoUnavailable: string
  videoFailed: string
  readmeLabel: string
  readmeDescription: string
  readmePath: string
  setupLabel: string
  setupDescription: string
  setupPath: string
  createLabel: string
  createPath?: string | null
  createDescription: string
  createUnavailable: string
  hideLabel: string
  hideDescription: string
  hidePath: string | null
  notice: string | null
}
