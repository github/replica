import type { Prisma } from "../../../generated/prisma/client.ts"

/** Limits visibility to identified repositories and, optionally, a membership's GitHub grants. */
export type RepositoryScope = { membershipId?: string } | null

export function visibleRepositoryWhere(scope: RepositoryScope): Prisma.RepositoryWhereInput {
  return {
    removedAt: null,
    ...(scope ? { githubRepositoryId: { not: null } } : {}),
    ...(scope?.membershipId
      ? { accessGrants: { some: { membershipId: scope.membershipId } } }
      : {}),
  }
}
