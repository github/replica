import type { RepositorySelectorRepository } from "@components/repository-selector/types"
import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import type { PrototypeMetadataManagementData } from "@features/prototype-metadata-management/types"

export interface PageSectionState {
  loading: boolean
  failed: boolean
  retry: () => void
}

export interface PrototypeManagementPageData extends RepositoryWorkspaceData {
  alert: string | null
  backLabel: string
  management: PrototypeMetadataManagementData
  pageTitle: string
  sectionLoadId: string
  repositoryChoices: {
    repositories: RepositorySelectorRepository[]
    path: string
    loadingLabel: string
    errorLabel: string
    retryLabel: string
    failed: boolean
  }
}
