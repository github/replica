import type { BuildState } from "@components/build-state-label/types"
import type { PrototypeWorkspaceData } from "@features/prototype-workspace"

export interface BuildsIndexPageData extends PrototypeWorkspaceData {
  builds: Array<{
    author: {
      avatarUrl: string | null
      label: string
      url: string | null
    }
    commitLabel: string
    commitSha: string
    createdAt: string
    createdLabel: string
    number: number
    numberLabel: string
    path: string
    shortCommitSha: string
    state: BuildState
    stateLabel: string
  }>
  buildsHeading: string
  emptyLabel: string
  pageTitle: string
  nextPageLabel: string
  nextPagePath: string | null
  newestPageLabel: string
  newestPagePath: string | null
}
