import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function listDecisionWithdrawalSources(database: PrismaClient) {
  return database.repository.findMany({
    where: {
      removedAt: null,
      decisionTrainingJobs: { some: { requestedByMembershipId: { not: null } } },
    },
    select: {
      id: true,
      decisionTrainingJobs: {
        where: { requestedByMembershipId: { not: null } },
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
    },
  })
}
