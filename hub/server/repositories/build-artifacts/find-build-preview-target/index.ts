import type { PrismaClient } from "../../../generated/prisma/client.ts"

const targetPaths = {
  preview: "dist/index.html",
  desktop: "screenshots/desktop.png",
  narrow: "screenshots/narrow.png",
  template: "dist/index.html",
} as const

export type BuildPreviewTarget = keyof typeof targetPaths

export async function findBuildPreviewTarget(
  database: PrismaClient,
  input:
    | {
        repositoryId: string
        prototypeId: string
        buildNumber: number
        target: BuildPreviewTarget
      }
    | { buildId: string; target: BuildPreviewTarget },
) {
  const artifact = await database.buildArtifact.findFirst({
    where: {
      path: targetPaths[input.target],
      build: {
        state: "successful",
        ...("buildId" in input
          ? { id: input.buildId }
          : {
              number: input.buildNumber,
              prototypeId: input.prototypeId,
              prototype: {
                repositoryId: input.repositoryId,
                replica: false,
                branchName: { not: "replica/install-workflow" },
                repository: { removedAt: null },
              },
            }),
      },
    },
    select: {
      buildId: true,
      build: {
        select: {
          prototype: {
            select: {
              startPage: true,
              branchName: true,
              branchDeletedAt: true,
              repositoryId: true,
              replica: true,
              repository: { select: { defaultBranch: true, removedAt: true, localPath: true } },
            },
          },
        },
      },
    },
  })
  const prototype = artifact?.build.prototype
  if (!artifact || !prototype || prototype.repository.removedAt) return null
  if (input.target === "template") {
    if (
      !("buildId" in input) ||
      prototype.branchDeletedAt ||
      prototype.branchName !== prototype.repository.defaultBranch
    )
      return null
  } else if (
    prototype.replica ||
    prototype.branchName === prototype.repository.defaultBranch ||
    prototype.branchName === "replica/install-workflow"
  )
    return null

  return {
    buildId: artifact.buildId,
    startPage: input.target === "template" ? "/" : prototype.startPage || "/",
    artifactPath: targetPaths[input.target],
    ...(input.target === "template"
      ? {
          templateRepository: {
            id: prototype.repositoryId,
            local: Boolean(prototype.repository.localPath),
          },
        }
      : {}),
  }
}
