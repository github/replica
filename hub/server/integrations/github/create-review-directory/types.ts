export interface GitHubReviewPerson {
  githubId: number
  login: string
  avatarUrl: string | null
}

export interface GitHubReviewDirectory {
  find(
    repository: string,
    login: string,
    githubId?: number,
    signal?: AbortSignal,
  ): Promise<GitHubReviewPerson | null>
  search(repository: string, query: string): Promise<GitHubReviewPerson[]>
}
