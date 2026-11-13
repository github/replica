import type { Prisma } from "../../../generated/prisma/client.ts"

/** Limits a repository lookup to a membership's recorded GitHub read access. */
export type RepositoryScope = { membershipId: string } | null

export function visibleRepositoryWhere(scope: RepositoryScope): Prisma.RepositoryWhereInput {
  return {
    removedAt: null,
    ...(scope ? { accessGrants: { some: { membershipId: scope.membershipId } } } : {}),
  }
}
