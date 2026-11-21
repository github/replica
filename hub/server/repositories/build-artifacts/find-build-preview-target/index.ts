import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { createBuildPreviewPath } from "../../../utils/create-build-preview-path/index.ts"

const targetPaths = {
  preview: "dist/index.html",
  desktop: "screenshots/desktop.png",
  narrow: "screenshots/narrow.png",
} as const

export type BuildPreviewTarget = keyof typeof targetPaths

export async function findBuildPreviewTarget(
  database: PrismaClient,
  input: {
    repositoryId: string
    prototypeId: string
    buildNumber: number
    target: BuildPreviewTarget
  },
) {
  const artifact = await database.buildArtifact.findFirst({
    where: {
      path: targetPaths[input.target],
      build: {
        state: "successful",
        number: input.buildNumber,
        prototypeId: input.prototypeId,
        prototype: {
          repositoryId: input.repositoryId,
          replica: false,
          branchDeletedAt: null,
          branchName: { not: "replica/install-workflow" },
          repository: { removedAt: null },
        },
      },
    },
    select: {
      buildId: true,
      build: {
        select: {
          githubWorkflowRunId: true,
          prototype: {
            select: {
              startPage: true,
              branchName: true,
              branchDeletedAt: true,
              repositoryId: true,
              replica: true,
              repository: {
                select: {
                  defaultBranch: true,
                  removedAt: true,
                  localPath: true,
                  githubRepositoryId: true,
                },
              },
            },
          },
        },
      },
    },
  })
  const prototype = artifact?.build.prototype
  if (!artifact || !prototype || prototype.repository.removedAt) return null
  if (prototype.branchName === prototype.repository.defaultBranch) return null

  return {
    buildId: artifact.buildId,
    startPage: prototype.startPage || "/",
    artifactPath: targetPaths[input.target],
    mountPath: createBuildPreviewPath(
      prototype.repository.githubRepositoryId,
      artifact.build.githubWorkflowRunId,
    ),
  }
}
