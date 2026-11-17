import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts"

import type { PrepareLocalBuildInput, PreparedLocalBuild } from "./types.ts"

export async function prepareLocalBuild(
  database: PrismaClient,
  input: PrepareLocalBuildInput,
): Promise<PreparedLocalBuild> {
  const nameWithOwner = `local/${input.repositoryName}`.slice(0, 255)
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.$transaction(
        async (transaction) => {
          const repository = await transaction.repository.upsert({
            where: { localPath: input.repositoryPath },
            create: {
              nameWithOwner,
              defaultBranch: input.defaultBranch,
              localPath: input.repositoryPath,
            },
            update: {
              nameWithOwner,
              defaultBranch: input.defaultBranch,
              removedAt: null,
            },
            select: { id: true },
          })
          let prototype = await transaction.prototype.findFirst({
            where: {
              repositoryId: repository.id,
              branchName: input.branchName,
              branchDeletedAt: null,
            },
            select: { id: true },
          })
          prototype ??= await transaction.prototype.create({
            data: {
              repositoryId: repository.id,
              authorId: input.localUserId,
              branchName: input.branchName,
              name: input.branchName,
              registeredAt: new Date(),
            },
            select: { id: true },
          })
          const existingBuild = await transaction.build.findUnique({
            where: {
              prototypeId_commitSha: {
                prototypeId: prototype.id,
                commitSha: input.commitSha,
              },
            },
            select: {
              id: true,
              state: true,
              number: true,
              prototypeId: true,
              localLeaseId: true,
              localLeaseExpiresAt: true,
            },
          })
          if (existingBuild) {
            const staleRunning =
              existingBuild.state === "running" &&
              existingBuild.localLeaseExpiresAt &&
              existingBuild.localLeaseExpiresAt < new Date()
            if (staleRunning) {
              await transaction.build.update({
                where: {
                  id: existingBuild.id,
                  state: "running",
                  localLeaseId: existingBuild.localLeaseId,
                },
                data: {
                  state: "queued",
                  startedAt: null,
                  localLeaseId: null,
                  localLeaseExpiresAt: null,
                },
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
                buildId: existingBuild.id,
                branchName: input.branchName,
                commitSha: input.commitSha,
              },
              update: { lastObservedAt: new Date(), buildId: existingBuild.id },
            })
            await transaction.prototype.update({
              where: { id: prototype.id },
              data: { currentBuildId: existingBuild.id },
            })
            return existingBuild.state === "queued" || staleRunning
              ? {
                  status: "queued" as const,
                  repositoryId: repository.id,
                  prototypeId: existingBuild.prototypeId,
                  buildId: existingBuild.id,
                  buildNumber: existingBuild.number,
                }
              : {
                  status: "unchanged" as const,
                  buildId: existingBuild.id,
                  buildState: existingBuild.state,
                }
          }
          const highestBuild = await transaction.build.aggregate({
            where: { prototypeId: prototype.id },
            _max: { number: true },
          })
          const build = await transaction.build.create({
            data: {
              prototypeId: prototype.id,
              number: (highestBuild._max.number ?? 0) + 1,
              commitSha: input.commitSha,
              authorProvider: "local",
              authorIssuer: "local",
              authorProviderUserId: "local-developer",
              authorLogin: input.authorEmail,
              authorName: input.authorName,
            },
            select: { id: true, number: true },
          })
          await transaction.prototype.update({
            where: { id: prototype.id },
            data: { currentBuildId: build.id },
          })
          await transaction.branchHeadObservation.create({
            data: {
              repositoryId: repository.id,
              buildId: build.id,
              branchName: input.branchName,
              commitSha: input.commitSha,
            },
          })
          return {
            status: "queued" as const,
            repositoryId: repository.id,
            prototypeId: prototype.id,
            buildId: build.id,
            buildNumber: build.number,
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034")
      ) {
        continue
      }
      throw error
    }
  }
}
