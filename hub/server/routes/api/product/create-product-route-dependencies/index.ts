import { prisma } from "../../../../integrations/prisma/index.ts"
import { findRepositoryAuthors } from "../../../../repositories/prototype-index/find-repository-authors/index.ts"
import { findRepositoryIndex } from "../../../../repositories/prototype-index/find-repository-index/index.ts"
import { listRepositories } from "../../../../repositories/prototype-index/list-repositories/index.ts"
import type { ProductRouteDependencies } from "../types.ts"

export function createProductRouteDependencies(): ProductRouteDependencies {
  return {
    listRepositories: () => listRepositories(prisma),
    findRepositoryIndex: (repositoryId, filters) =>
      findRepositoryIndex(prisma, repositoryId, filters),
    findRepositoryAuthors: (repositoryId, filters) =>
      findRepositoryAuthors(prisma, repositoryId, filters),
  }
}
