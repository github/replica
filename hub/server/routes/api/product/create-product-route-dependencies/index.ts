import { prisma } from "../../../../integrations/prisma/index.ts"
import { findRepositoryIndex } from "../../../../repositories/prototype-index/find-repository-index/index.ts"
import { listRepositories } from "../../../../repositories/prototype-index/list-repositories/index.ts"
import type { ProductRouteDependencies } from "../types.ts"

export function createProductRouteDependencies(): ProductRouteDependencies {
  return {
    listRepositories: () => listRepositories(prisma),
    findRepositoryIndex: (repositoryId) => findRepositoryIndex(prisma, repositoryId),
  }
}
