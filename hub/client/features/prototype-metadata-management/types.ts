export interface PrototypeMetadataEntry {
  id: string
  branchName: string
  name: string
  description: string | null
  startPage: string | null
  startPageImportError?: string | null
  path: string
  readOnly?: boolean
}

export interface PrototypeMetadataManagementData {
  heading: string
  unlistedHeading: string
  unlistedDescription: string
  registeredHeading: string
  registeredEmptyLabel: string
  emptyLabel: string
  nameLabel: string
  descriptionLabel: string
  startPageLabel: string
  startPageHint: string
  addLabel: string
  editLabel: string
  saveLabel: string
  cancelLabel: string
  addDialogHeading: string
  editDialogHeading: string
  closeDialogLabel: string
  nameMaximumLength: number
  descriptionMaximumLength: number
  candidateCheckFailed: boolean
  candidateCheckFailedLabel: string
  candidateLoadingLabel: string
  candidateRetryLabel: string
  candidateDataPath: string
  candidatePage: number
  candidatePageCount: number
  candidatePagePath: string
  paginationLabel: string
  previousPageLabel: string
  previousPageAriaLabel: string
  nextPageLabel: string
  nextPageAriaLabel: string
  unlisted: PrototypeMetadataEntry[]
  registered: PrototypeMetadataEntry[]
}
