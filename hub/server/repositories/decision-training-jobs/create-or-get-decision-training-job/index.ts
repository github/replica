import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createOrGetDecisionTrainingJob(
  database: Pick<Prisma.TransactionClient, "decisionTrainingJob">,
  input: {
    repositoryId: string
    requestedByMembershipId: string | null
    idempotencyKey: string
    configurationGeneration: number
    backend: string
    maxUpdates: number
    maxSeconds: number
    budgetCredits: string
    consentGrantId: string
    trainingExportId: string
    evidenceDigest: string
    exportDigest: string
    repeatableReviewSnapshotDigest: string
    questionDigest: string
    buildSetDigest: string
    tasksetDigest: string
  },
) {
  const existing = await database.decisionTrainingJob.findUnique({
    where: {
      repositoryId_idempotencyKey: {
        repositoryId: input.repositoryId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  })
  if (existing) return { created: false, job: existing }
  try {
    const job = await database.decisionTrainingJob.create({ data: input })
    return { created: true, job }
  } catch (error) {
    const raced = await database.decisionTrainingJob.findUnique({
      where: {
        repositoryId_idempotencyKey: {
          repositoryId: input.repositoryId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    })
    if (raced) return { created: false, job: raced }
    throw error
  }
}
