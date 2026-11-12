import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import type { WorkflowInstallationData } from "@features/workflow-installation/types"

import type { PrototypeCardData } from "@components/prototype-card/types"
import type { PrototypeListing } from "@utils/prototype-listing/types"

export interface RepositoriesShowPageData extends RepositoryWorkspaceData {
  listing: PrototypeListing
  alert: string | null
  candidateCheckFailed?: string
  clearSearchLabel: string
  emptyHeading: string
  emptyLabel: string
  buildPrototypeLabel: string
  galleryViewLabel: string
  listViewLabel: string
  prototypeColumnLabel: string
  ownerColumnLabel: string
  buildColumnLabel: string
  passingLabel: string
  notPassingLabel: string
  noBuildLabel: string
  noSearchResultsHeading: string
  noSearchResultsDescription: string
  managePrototypesLabel?: string
  managePrototypesPath?: string
  notice?: string | null
  addToHubLabel?: string
  declineBranchLabel?: string
  recentBranches?: {
    id: string
    branchName: string
    title: string
    registrationPath: string
    dismissalPath: string
  }[]
  pageTitle: string
  prototypes: PrototypeCardData[]
  prototypesCountLabel: string
  prototypesHeading: string
  searchLabel: string
  viewLabel: string
  workflowInstallation?: WorkflowInstallationData
}
