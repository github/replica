export interface LocalBranchHead {
  name: string
  commitSha: string
  authorName: string | null
  authorEmail: string | null
  authoredAt: Date
}

export interface LocalRepository {
  path: string
  name: string
  defaultBranch: string
  branches: LocalBranchHead[]
}

export interface LocalRepositoryDiscoveryFailure {
  path: string
  errorType: string
}

export interface LocalRepositoryDiscovery {
  repositories: LocalRepository[]
  failures: LocalRepositoryDiscoveryFailure[]
}
