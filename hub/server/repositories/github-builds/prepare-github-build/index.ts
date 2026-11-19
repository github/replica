import { type BuildState, Prisma, type PrismaClient } from "../../../generated/prisma/client.ts"
import type { PrepareGitHubBuildInput, PreparedGitHubBuild } from "./types.ts"

const transientErrorCodes = new Set(["P2002", "P2034"])

/**
 * Later events for the owning attempt keep its unfinished Build. A failed Build reopens
 * only for a newer attempt, so a repeated event cannot discard its recorded failure.
 */
function ownsExistingBuild(
  existing: {
    state: BuildState
    githubWorkflowRunId: bigint | null
    githubWorkflowRunAttempt: number | null
  },
  run: PrepareGitHubBuildInput["run"],
) {
  if (existing.state === "successful" || existing.state === "superseded") return false
  if (existing.githubWorkflowRunId === null) return true
  if (existing.githubWorkflowRunId !== run.runId) return run.runId > existing.githubWorkflowRunId
  const attempt = existing.githubWorkflowRunAttempt ?? 0
  return existing.state === "failed" ? run.runAttempt > attempt : run.runAttempt >= attempt
}

/**
 * A reused Build keeps its original run time, so the run that selected it is tracked
 * separately. Local Builds have no run time and use their creation time.
 */
function currentSelectedAt(prototype: {
  currentBuildRunCreatedAt: Date | null
  currentBuild: { createdAt: Date; workflowCreatedAt: Date | null } | null
}) {
  const { currentBuild, currentBuildRunCreatedAt } = prototype
  const buildCreatedAt = currentBuild?.workflowCreatedAt ?? currentBuild?.createdAt
  return Math.max(currentBuildRunCreatedAt?.getTime() ?? 0, buildCreatedAt?.getTime() ?? 0)
}

/**
 * Finds or creates the Build for a pushed commit on an existing, active repository. A
 * newer workflow run may take over a Build that has not succeeded; successful Builds and
 * their artifacts are never reopened. The run's Build becomes current unless a newer run
 * already selected another Build, including when a branch returns to an earlier commit.
 */
export async function prepareGitHubBuild(
  database: PrismaClient,
  input: PrepareGitHubBuildInput,
): Promise<PreparedGitHubBuild> {
  const { run } = input
  const runFields = {
    githubWorkflowRunId: run.runId,
    githubWorkflowRunAttempt: run.runAttempt,
    workflowUrl: run.workflowUrl,
    workflowCreatedAt: run.createdAt,
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.$transaction(
        async (transaction) => {
          const repository = await transaction.repository.findFirst({
            where: { githubRepositoryId: BigInt(input.githubRepositoryId), removedAt: null },
            select: { id: true },
          })
          if (!repository) return { status: "unknown-repository" as const }

          let prototype = await transaction.prototype.findFirst({
            where: {
              repositoryId: repository.id,
              branchName: input.branchName,
              branchDeletedAt: null,
            },
            select: {
              id: true,
              currentBuildId: true,
              currentBuildRunCreatedAt: true,
              currentBuild: { select: { createdAt: true, workflowCreatedAt: true } },
            },
          })
          prototype ??= {
            ...(await transaction.prototype.create({
              data: {
                repositoryId: repository.id,
                branchName: input.branchName,
                name: input.branchName,
                registeredAt: new Date(),
              },
              select: { id: true, currentBuildId: true, currentBuildRunCreatedAt: true },
            })),
            currentBuild: null,
          }

          const existing = await transaction.build.findUnique({
            where: {
              prototypeId_commitSha: { prototypeId: prototype.id, commitSha: input.commitSha },
            },
            select: {
              id: true,
              state: true,
              distDigest: true,
              githubWorkflowRunId: true,
              githubWorkflowRunAttempt: true,
            },
          })
          let build: { id: string; state: BuildState; distDigest: string | null }
          let ownsBuild = true
          if (existing) {
            ownsBuild = ownsExistingBuild(existing, run)
            build = existing
            if (ownsBuild) {
              build = await transaction.build.update({
                where: { id: existing.id },
                data: {
                  ...runFields,
                  ...(existing.state === "failed"
                    ? { state: "queued", failureSummary: null, finishedAt: null, startedAt: null }
                    : {}),
                },
                select: { id: true, state: true, distDigest: true },
              })
            }
          } else {
            const highest = await transaction.build.aggregate({
              where: { prototypeId: prototype.id },
              _max: { number: true },
            })
            build = await transaction.build.create({
              data: {
                prototypeId: prototype.id,
                number: (highest._max.number ?? 0) + 1,
                commitSha: input.commitSha,
                ...runFields,
                ...(input.author
                  ? {
                      authorProvider: "github",
                      authorIssuer: "https://github.com",
                      authorProviderUserId: input.author.providerUserId,
                      authorLogin: input.author.login,
                      authorAvatarUrl: input.author.avatarUrl,
                    }
                  : {}),
              },
              select: { id: true, state: true, distDigest: true },
            })
          }

          // A late event for an older run must not replace a newer current Build.
          const alreadyCurrent =
            prototype.currentBuildId === build.id &&
            prototype.currentBuildRunCreatedAt?.getTime() === run.createdAt.getTime()
          if (
            build.state !== "superseded" &&
            !alreadyCurrent &&
            run.createdAt.getTime() >= currentSelectedAt(prototype)
          ) {
            await transaction.prototype.update({
              where: { id: prototype.id },
              data: { currentBuildId: build.id, currentBuildRunCreatedAt: run.createdAt },
            })
          }

          await transaction.branchHeadObservation.upsert({
            where: {
              repositoryId_branchName_commitSha: {
                repositoryId: repository.id,
                branchName: input.branchName,
                commitSha: input.commitSha,
              },
            },
            create: {
              repositoryId: repository.id,
              buildId: build.id,
              branchName: input.branchName,
              commitSha: input.commitSha,
            },
            update: { lastObservedAt: new Date(), buildId: build.id },
          })
          return {
            status: "ready" as const,
            buildId: build.id,
            state: build.state,
            distDigest: build.distDigest,
            ownsBuild,
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        transientErrorCodes.has(error.code)
      ) {
        continue
      }
      throw error
    }
  }
}
