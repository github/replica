import type { BuildState } from "@components/build-state-label/types"
import type { ReviewCommentsCopy } from "@utils/review-comment/types"

interface WorkspaceHeaderData {
  branchName: string
  branchPath: string
  prototypeName?: string
  closeLabel: string
  closePath?: string
  latestBuild?: {
    number: number
    state: BuildState
    stateLabel: string
  }
  newerBuildLabel?: string
  repositoryPath: string
  selectedBuild?: {
    number: number
    detailsLabel?: string
    detailsPath?: string
  }
  useDarkThemeLabel: string
  useLightThemeLabel: string
}

export interface PrototypeWorkspaceHeaderData extends WorkspaceHeaderData {
  browseReplica?: false
  author: {
    avatarUrl: string | null
    label: string
    url: string | null
  }
  prototypeInfoLabel?: string
  buildOptions: Array<{
    number: number
    label: string
    path: string
    state: BuildState
    stateLabel?: string
  }>
  buildSelectionLabel: string
  historyLabel: string
  historyPath: string
  moreActionsLabel: string
  shareLinksLabel?: string
  shareLinksPath?: string
}

export interface ReplicaWorkspaceHeaderData extends WorkspaceHeaderData {
  browseReplica: true
}

export interface PrototypeWorkspaceHeaderProps {
  data: PrototypeWorkspaceHeaderData | ReplicaWorkspaceHeaderData
  onShowInfo?: () => void
  editDetails?: {
    label: string
    onClick: () => void
  }
  onControlsToolbarMount?: (toolbar: HTMLSpanElement | null) => void
  fork?: {
    label: string
    onClick: () => void
  }
  reviewControls?: {
    bridgeReady: boolean
    commentCount: number
    copy: ReviewCommentsCopy
    hasUnreadComments: boolean
    selectionBlocked: boolean
    selecting: boolean
    sidebarToggleBlocked: boolean
    sidebarOpen: boolean
    onCancelSelection: () => void
    onStartAreaSelection: () => void
    onStartElementSelection: () => void
    onToggleSidebar: () => void
  }
}
