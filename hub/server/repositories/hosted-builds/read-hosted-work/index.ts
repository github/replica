import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

export async function readSavedUnfinishedRuns(
  database: PrismaClient,
  repositoryId: string,
  seenRunIds: bigint[],
) {
  return database.build.findMany({
    where: {
      prototype: { repositoryId },
      state: { in: ["queued", "running", "failed"] },
      githubWorkflowCompletedAt: null,
      githubWorkflowRunId: { not: null, notIn: seenRunIds },
    },
    select: { id: true, githubWorkflowRunId: true, githubWorkflowRunAttempt: true },
    orderBy: [{ workflowCreatedAt: "desc" }, { id: "desc" }],
    take: 100,
  })
}

export async function readPendingHostedImports(database: PrismaClient, repositoryId: string) {
  const now = new Date()
  return database.build.findMany({
    where: {
      prototype: { repositoryId },
      state: "running",
      githubWorkflowCompletedAt: { not: null },
      OR: [{ hostedImportLeaseId: null }, { hostedImportLeaseExpiresAt: { lte: now } }],
    },
    select: {
      id: true,
      prototypeId: true,
      prototype: { select: { branchName: true } },
      commitSha: true,
      githubWorkflowRunId: true,
      githubWorkflowRunAttempt: true,
      githubArtifactId: true,
    },
    orderBy: [{ workflowCreatedAt: "desc" }, { id: "desc" }],
    take: 100,
  })
}

export async function failMissingHostedRun(
  database: Prisma.TransactionClient,
  input: {
    id: string
    githubWorkflowRunId: bigint | null
    githubWorkflowRunAttempt: number | null
  },
) {
  return database.build.updateMany({
    where: { ...input, state: { in: ["queued", "running"] }, githubWorkflowCompletedAt: null },
    data: {
      state: "failed",
      failureSummary: "GitHub no longer provides this Build's workflow run.",
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  })
}
