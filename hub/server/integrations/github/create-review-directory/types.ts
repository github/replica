export interface GitHubReviewPerson {
  githubId: number
  login: string
  avatarUrl: string | null
}

export interface GitHubReviewDirectory {
  canRead(
    repositoryId: bigint,
    login: string,
    githubId: number,
    signal?: AbortSignal,
  ): Promise<boolean>
  find(
    repositoryId: bigint,
    login: string,
    githubId?: number,
    signal?: AbortSignal,
  ): Promise<GitHubReviewPerson | null>
  search(repositoryId: bigint, query: string, signal?: AbortSignal): Promise<GitHubReviewPerson[]>
}
