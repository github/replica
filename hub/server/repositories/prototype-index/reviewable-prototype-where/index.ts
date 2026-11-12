import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Shares one eligibility rule between the index and its user choices, so the
 * user filter never offers someone whose prototypes the index would hide.
 */
export function reviewablePrototypeWhere(repository: {
  id: string
  defaultBranch: string
}): Prisma.PrototypeWhereInput {
  return {
    repositoryId: repository.id,
    registeredAt: { not: null },
    branchDeletedAt: null,
    replica: false,
    branchName: { notIn: [repository.defaultBranch, "replica/install-workflow"] },
  }
}
