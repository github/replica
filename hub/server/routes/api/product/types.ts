import type { findRepositoryIndex } from "../../../repositories/prototype-index/find-repository-index/index.ts"
import type { listRepositories } from "../../../repositories/prototype-index/list-repositories/index.ts"

export interface ProductRouteDependencies {
  listRepositories(): ReturnType<typeof listRepositories>
  findRepositoryIndex(repositoryId: string): ReturnType<typeof findRepositoryIndex>
}
