import { Prisma } from "../../../generated/prisma/client.ts"

export async function createLearningRun(
  database: Pick<Prisma.TransactionClient, "learningRun">,
  input: {
    repositoryId: string
    requestedById: string
    requestedByMembershipId: string
    snapshotDigest: string
  },
) {
  try {
    return { run: await database.learningRun.create({ data: input }), created: true }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error
    }
    const active = await database.learningRun.findFirst({
      where: {
        repositoryId: input.repositoryId,
        state: { in: ["QUEUED", "RUNNING"] },
      },
    })
    if (active) return { run: active, created: false }
    throw error
  }
}
