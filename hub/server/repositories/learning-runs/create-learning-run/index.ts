import { randomUUID } from "node:crypto"
import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createLearningRun(
  database: Pick<Prisma.TransactionClient, "learningRun">,
  input: {
    repositoryId: string
    requestedById: string
    requestedByMembershipId: string
    snapshotDigest: string
  },
) {
  const id = randomUUID()
  const created = await database.learningRun.createMany({
    data: { id, ...input },
    skipDuplicates: true,
  })
  const run = await database.learningRun.findFirst({
    where:
      created.count === 1
        ? { id }
        : {
            repositoryId: input.repositoryId,
            state: { in: ["QUEUED", "RUNNING"] },
          },
  })
  if (!run) throw new Error("The active learning run could not be found.")
  return { run, created: created.count === 1 }
}
