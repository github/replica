import type { PrismaClient } from "../../../generated/prisma/client.ts"

export async function markLocalBuildRunning(database: PrismaClient, buildId: string) {
  const build = await database.build.findUnique({
    where: { id: buildId },
    select: { state: true },
  })
  if (build?.state === "running") return
  await database.build.update({
    where: { id: buildId, state: "queued" },
    data: { state: "running", startedAt: new Date() },
  })
}
