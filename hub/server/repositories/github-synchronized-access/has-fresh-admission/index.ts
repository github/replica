import type { Prisma } from "../../../generated/prisma/client.ts"

const policyId = "00000000-0000-0000-0000-000000000001"

export async function hasFreshGitHubAdmission(
  database: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<boolean> {
  const policy = await database.gitHubAuthorizationPolicy.findUnique({
    where: { id: policyId },
    select: { lastKnownGoodSeconds: true },
  })
  const cutoff = new Date(now.getTime() - (policy?.lastKnownGoodSeconds ?? 86_400) * 1_000)
  return (
    (await database.gitHubSynchronizedAccess.findFirst({
      where: {
        userId,
        status: "active",
        admissionEligible: true,
        lastConfirmedAt: { gte: cutoff },
        repositorySource: { status: "active", admissionEnabled: true },
      },
      select: { id: true },
    })) !== null
  )
}
