import { randomUUID } from "node:crypto"
import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createLearningRun(
  database: Pick<Prisma.TransactionClient, "learningRun">,
  input:
    | {
        repositoryId: string
        requestedById: string
        requestedByMembershipId: string
        scheduled?: false
        snapshotDigest: string
        reviewActivitySnapshot: Prisma.InputJsonValue
      }
    | {
        repositoryId: string
        requestedById?: never
        requestedByMembershipId?: never
        scheduled: true
        snapshotDigest: string
        reviewActivitySnapshot: Prisma.InputJsonValue
      },
) {
  const id = randomUUID()
  const created = await database.learningRun.createMany({
    data: { id, ...input },
    skipDuplicates: true,
  })
  let run = await database.learningRun.findFirst({
    where:
      created.count === 1
        ? { id }
        : {
            repositoryId: input.repositoryId,
            state: { in: ["QUEUED", "RUNNING"] },
          },
  })
  if (!run) throw new Error("The active learning run could not be found.")
  let promoted = false
  if (created.count === 0 && !input.scheduled && run.scheduled && run.state === "QUEUED") {
    const promotion = await database.learningRun.updateMany({
      where: { id: run.id, scheduled: true, state: "QUEUED" },
      data: {
        requestedById: input.requestedById,
        requestedByMembershipId: input.requestedByMembershipId,
        scheduled: false,
        snapshotDigest: input.snapshotDigest,
        reviewActivitySnapshot: input.reviewActivitySnapshot,
      },
    })
    if (promotion.count === 1) {
      run = await database.learningRun.findUniqueOrThrow({ where: { id: run.id } })
      promoted = true
    }
  }
  return { run, created: created.count === 1, promoted }
}
