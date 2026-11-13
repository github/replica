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

/** The signed-in viewer whose repository access limits product reads. */
export interface ProductViewer {
  membershipId: string
  provider: string
  role: "MEMBER" | "ADMINISTRATOR"
}

export interface ProductRouteDependencies {
  listRepositories(viewer: ProductViewer): ReturnType<typeof listRepositories>
  findRepositoryIndex(
    viewer: ProductViewer,
    repositoryId: string,
    filters: RepositoryIndexFilters,
  ): ReturnType<typeof findRepositoryIndex>
  findPrototypeDetail(
    viewer: ProductViewer,
    repositoryId: string,
    prototypeId: string,
    buildNumber?: number,
  ): ReturnType<typeof findPrototypeDetail>
  findRepositoryAuthors(
    viewer: ProductViewer,
    repositoryId: string,
    filters: RepositoryAuthorsFilters,
  ): ReturnType<typeof findRepositoryAuthors>
}
