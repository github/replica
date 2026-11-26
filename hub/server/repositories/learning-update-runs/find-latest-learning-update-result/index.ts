import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** What the newest finished check of one learning found, such as too little evidence. */
export async function findLatestLearningUpdateResult(
  database: Pick<PrismaClient, "learningUpdateRun">,
  input: { repositoryId: string; memoryId: string },
) {
  const run = await database.learningUpdateRun.findFirst({
    where: { ...input, state: "SUCCEEDED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { result: true },
  })
  return run?.result ?? null
}
