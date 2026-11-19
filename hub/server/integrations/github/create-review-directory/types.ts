export interface GitHubReviewPerson {
  githubId: number
  login: string
  avatarUrl: string | null
}

export interface GitHubReviewDirectory {
  find(
    repositoryId: bigint,
    login: string,
    githubId?: number,
    signal?: AbortSignal,
  ): Promise<GitHubReviewPerson | null>
  search(repositoryId: bigint, query: string): Promise<GitHubReviewPerson[]>
}
