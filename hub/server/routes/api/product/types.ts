import type { PrototypeMetadataChanges } from "../../../domains/prototypes/edit-prototype-metadata/index.ts"
import type { readPrototypeWithIntroduction } from "../../../domains/prototypes/read-prototype-with-introduction/index.ts"
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
import type {
  BuildPreviewTarget,
  findBuildPreviewTarget,
} from "../../../repositories/build-artifacts/find-build-preview-target/index.ts"
import type {
  ReviewCommentService,
  ReviewRouteActor,
} from "../../../domains/review-comments/types.ts"
import type { RepositoryReviewAccess } from "../../../domains/review-comments/authorize-repository-review/index.ts"

export interface ReviewAccessActor extends ReviewRouteActor {
  provider: string
}

export interface ReviewRouteDependencies {
  reviewComments: ReviewCommentService
  authorizeReviewAccess(
    repositoryId: string,
    actor: ReviewAccessActor,
  ): Promise<RepositoryReviewAccess>
}

/** The signed-in viewer whose repository access limits product reads. */
export interface ProductViewer {
  membershipId: string
  sessionProvider: string | null
  role: "MEMBER" | "ADMINISTRATOR"
}

export interface ProductRouteDependencies {
  reviewComments?: ReviewCommentService
  isRepositoryVisible(viewer: ProductViewer, repositoryId: string): Promise<boolean>
  authorizeReviewAccess?(
    repositoryId: string,
    actor: ReviewAccessActor,
  ): Promise<RepositoryReviewAccess>
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
    buildPage?: Parameters<typeof findPrototypeDetail>[4],
  ): ReturnType<typeof findPrototypeDetail>
  readPrototypeWithIntroduction(
    input: Parameters<typeof readPrototypeWithIntroduction>[0],
    prepare: Parameters<typeof readPrototypeWithIntroduction>[1]["prepare"],
  ): ReturnType<typeof readPrototypeWithIntroduction>
  findRepositoryAuthors(
    viewer: ProductViewer,
    repositoryId: string,
    filters: RepositoryAuthorsFilters,
  ): ReturnType<typeof findRepositoryAuthors>
  editPrototypeMetadata(input: {
    changes: PrototypeMetadataChanges
    prototypeId: string
    repositoryId: string
    sessionDigest: string
  }): Promise<NonNullable<Awaited<ReturnType<typeof findPrototypeDetail>>>>
  findBuildPreviewTarget(
    repositoryId: string,
    prototypeId: string,
    buildNumber: number,
    target: BuildPreviewTarget,
  ): ReturnType<typeof findBuildPreviewTarget>
}
