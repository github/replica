import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function listDecisionWithdrawalSources(database: PrismaClient) {
  return database.repository.findMany({
    where: {
      removedAt: null,
      decisionTrainingJobs: { some: {} },
    },
    select: {
      id: true,
      decisionTrainingJobs: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          consentGrantId: true,
          trainingExportId: true,
          evidenceDigest: true,
          tasksetDigest: true,
          requestedByMembershipId: true,
          requestedByMembership: {
            select: { user: { select: { profile: { select: { login: true } } } } },
          },
        },
      },
      accessGrants: {
        where: { accessLevel: "ADMIN", membership: { lifecycle: "ACTIVE" } },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        select: {
          membershipId: true,
          membership: {
            select: { user: { select: { profile: { select: { login: true } } } } },
          },
        },
      },
    },
  })
}
