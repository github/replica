export interface RepositorySelectorRepository {
  id: string
  nameWithOwner: string
  path: string
}

export interface RepositorySelectorStatus {
  loading: boolean
  failed: boolean
  loadingLabel: string
  errorLabel: string
  retryLabel: string
  onRetry?: () => void
}
