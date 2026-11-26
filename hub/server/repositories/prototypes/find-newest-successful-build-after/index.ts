import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * The prototype's newest successful Build with a commit that started after the given time.
 * Build numbers follow the order Hub found the runs, which can differ from when they ran,
 * so this compares the workflow's creation time and falls back to the Build's own.
 */
export async function findNewestSuccessfulBuildAfter(
  transaction: Pick<Prisma.TransactionClient, "build">,
  input: { prototypeId: string; after: Date },
) {
  const builds = await transaction.build.findMany({
    where: {
      prototypeId: input.prototypeId,
      state: "successful",
      commitSha: { not: null },
      OR: [
        { workflowCreatedAt: { gt: input.after } },
        { workflowCreatedAt: null, createdAt: { gt: input.after } },
      ],
    },
    select: { id: true, commitSha: true, workflowCreatedAt: true, createdAt: true },
  })
  function started(build: (typeof builds)[number]) {
    return (build.workflowCreatedAt ?? build.createdAt).getTime()
  }
  const [newest] = builds.sort(
    (left, right) => started(right) - started(left) || right.id.localeCompare(left.id),
  )
  return newest?.commitSha ? { commitSha: newest.commitSha } : null
}
