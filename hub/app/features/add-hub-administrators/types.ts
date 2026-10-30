export interface HubAdministratorCandidate {
  id: number
  login: string
  name: string | null
}

export interface HubAdministratorSearchResults {
  users: HubAdministratorCandidate[]
  more: boolean
}

export interface AddHubAdministratorsData {
  submitPath: string
  searchPath: string
  heading: string
  description: string
  searchLabel: string
  searchPlaceholder: string
  loadingLabel: string
  emptyLabel: string
  moreLabel: string
  selectedLabel: string
  confirmLabel: string
  submitLabel: string
  searchFailedLabel: string
  retryLabel: string
  cancelLabel: string
}
