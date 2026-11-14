import type { PrototypeMetadataChanges } from "../../../domains/prototypes/edit-prototype-metadata/index.ts"
import type {
  findRepositoryAuthors,
  RepositoryAuthorsFilters,
} from "../../../repositories/prototype-index/find-repository-authors/index.ts"
import type {
  findRepositoryIndex,
  RepositoryIndexFilters,
} from "../../../repositories/prototype-index/find-repository-index/index.ts"
import type { findPrototypeDetail } from "../../../repositories/prototype-index/find-prototype-detail/index.ts"
import type { listRepositories } from "../../../repositories/prototype-index/list-repositories/index.ts"

export interface ProductRouteDependencies {
  listRepositories(): ReturnType<typeof listRepositories>
  findRepositoryIndex(
    repositoryId: string,
    filters: RepositoryIndexFilters,
  ): ReturnType<typeof findRepositoryIndex>
  findPrototypeDetail(
    repositoryId: string,
    prototypeId: string,
    buildNumber?: number,
  ): ReturnType<typeof findPrototypeDetail>
  findRepositoryAuthors(
    repositoryId: string,
    filters: RepositoryAuthorsFilters,
  ): ReturnType<typeof findRepositoryAuthors>
  editPrototypeMetadata(input: {
    changes: PrototypeMetadataChanges
    prototypeId: string
    repositoryId: string
    sessionDigest: string
  }): Promise<NonNullable<Awaited<ReturnType<typeof findPrototypeDetail>>>>
}
