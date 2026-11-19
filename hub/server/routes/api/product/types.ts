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
import type { findLocalPrototypeManagement } from "../../../repositories/prototype-index/find-local-prototype-management/index.ts"
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
import type { RepositoryPermission } from "../../../integrations/github/read-repository-permission/types.ts"
import type { findDefaultTemplateBuild } from "../../../repositories/build-artifacts/find-default-template-build/index.ts"
import type { AnalyticsRouteDependencies } from "../repositories/analytics/types.ts"
import type { createReviewInbox } from "../../../domains/review-comments/create-review-inbox/index.ts"
import type { createReviewMentionDirectory } from "../../../domains/review-comments/create-review-mention-directory/index.ts"

export interface ReviewAccessActor extends ReviewRouteActor, ProductViewer {
  provider: string
  sessionDigest?: string
}

export interface ReviewRouteDependencies {
  reviewComments: ReviewCommentService
  searchReviewMentions?: ReturnType<typeof createReviewMentionDirectory>["search"]
  isPrototypeReviewable?: (repositoryId: string, prototypeId: string) => Promise<boolean>
  authorizeReviewAccess(
    repositoryId: string,
    actor: ReviewAccessActor,
  ): Promise<RepositoryReviewAccess>
}

/** The signed-in viewer whose repository access limits product reads. */
export interface ProductViewer {
  externalIdentityId?: string | null
  membershipId: string
  sessionProvider: string | null
  role: "MEMBER" | "ADMINISTRATOR"
}

export interface ProductRouteDependencies {
  analytics?: AnalyticsRouteDependencies
  /** Fresh, installation-bound permission. An unavailable or inaccessible grant can return none. */
  getRepositoryPermission?(
    viewer: ProductViewer,
    repositoryId: string,
  ): Promise<RepositoryPermission>
  /** Unlike the capability result, null is inconclusive and cannot revoke existing shares. */
  getVerifiedRepositoryPermission?(
    viewer: ProductViewer,
    repositoryId: string,
  ): Promise<RepositoryPermission | null>
  reviewComments?: ReviewCommentService
  searchReviewMentions?: ReviewRouteDependencies["searchReviewMentions"]
  isPrototypeReviewable?: ReviewRouteDependencies["isPrototypeReviewable"]
  reviewInbox?: ReturnType<typeof createReviewInbox>
  authorizeReviewAccess?(
    repositoryId: string,
    actor: ReviewAccessActor,
    signal?: AbortSignal,
  ): Promise<RepositoryReviewAccess>
  isRepositoryVisible(viewer: ProductViewer, repositoryId: string): Promise<boolean>
  listRepositories(viewer: ProductViewer): ReturnType<typeof listRepositories>
  findLocalPrototypeManagement?(
    this: void,
    viewer: ProductViewer,
    repositoryId: string,
  ): ReturnType<typeof findLocalPrototypeManagement>
  findPrototypeManagement?(
    this: void,
    viewer: ProductViewer,
    repositoryId: string,
  ): ReturnType<typeof findLocalPrototypeManagement>
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

export interface WorkspaceProductRouteDependencies extends ProductRouteDependencies {
  templates?: {
    findBuild(
      viewer: ProductViewer,
      repositoryId: string,
      buildId?: string,
    ): ReturnType<typeof findDefaultTemplateBuild>
  }
  welcome?: {
    isHidden(userId: string): Promise<boolean>
    hide(sessionDigest: string, userId: string): Promise<boolean>
  }
}
