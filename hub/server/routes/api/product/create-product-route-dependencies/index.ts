import { prisma } from "../../../../integrations/prisma/index.ts"
import { findRepositoryAuthors } from "../../../../repositories/prototype-index/find-repository-authors/index.ts"
import { findRepositoryIndex } from "../../../../repositories/prototype-index/find-repository-index/index.ts"
import { findPrototypeDetail } from "../../../../repositories/prototype-index/find-prototype-detail/index.ts"
import { listRepositories } from "../../../../repositories/prototype-index/list-repositories/index.ts"
import { resolveRepositoryScope } from "../resolve-repository-scope/index.ts"
import type { ProductRouteDependencies } from "../types.ts"

export function createProductRouteDependencies(
  options: { scopeGitHubMembers: boolean } = { scopeGitHubMembers: false },
): ProductRouteDependencies {
  function scope(viewer: Parameters<typeof resolveRepositoryScope>[0]) {
    return resolveRepositoryScope(viewer, options.scopeGitHubMembers)
  }
  return {
    listRepositories: (viewer) => listRepositories(prisma, scope(viewer)),
    findRepositoryIndex: (viewer, repositoryId, filters) =>
      findRepositoryIndex(prisma, repositoryId, filters, scope(viewer)),
    findPrototypeDetail: (viewer, repositoryId, prototypeId, buildNumber) =>
      findPrototypeDetail(prisma, repositoryId, prototypeId, buildNumber, scope(viewer)),
    findRepositoryAuthors: (viewer, repositoryId, filters) =>
      findRepositoryAuthors(prisma, repositoryId, filters, scope(viewer)),
  }
}
