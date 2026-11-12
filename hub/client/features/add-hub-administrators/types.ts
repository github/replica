export interface HubAdministratorCandidate {
  id: string
  provider: string | null
  login: string | null
  name: string | null
}

export interface HubAdministratorSearchResults {
  users: HubAdministratorCandidate[]
  more: boolean
}

export interface AddHubAdministratorsData {
  submitPath: string
  operation?: "DESIGNATE_ADMINISTRATORS"
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
