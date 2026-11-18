import type { PrismaClient } from "../../../generated/prisma/client.ts"

const targetPaths = {
  preview: "dist/index.html",
  desktop: "screenshots/desktop.png",
  narrow: "screenshots/narrow.png",
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
              replica: true,
              repository: { select: { defaultBranch: true, removedAt: true } },
            },
          },
        },
      },
    },
  })
  const prototype = artifact?.build.prototype
  return artifact &&
    prototype &&
    !prototype.replica &&
    !prototype.repository.removedAt &&
    prototype.branchName !== prototype.repository.defaultBranch &&
    prototype.branchName !== "replica/install-workflow"
    ? {
        buildId: artifact.buildId,
        startPage: prototype.startPage || "/",
        artifactPath: targetPaths[input.target],
      }
    : null
}
