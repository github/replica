import { Prisma } from "../../../generated/prisma/client.ts"
import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { createBuildPreviewPath } from "../../../utils/create-build-preview-path/index.ts"
import {
  type RepositoryScope,
  visibleRepositoryWhere,
} from "../../prototype-index/visible-repository-where/index.ts"

export function findDefaultTemplateBuild(
  database: Pick<PrismaClient, "$transaction">,
  repositoryId: string,
  scope: RepositoryScope,
  buildId?: string,
) {
  return database.$transaction(
    async (transaction) => {
      const repository = await transaction.repository.findFirst({
        where: { id: repositoryId, ...visibleRepositoryWhere(scope) },
        select: {
          id: true,
          nameWithOwner: true,
          defaultBranch: true,
          localPath: true,
          githubRepositoryId: true,
        },
      })
      if (!repository) return null

      const [selected] = await transaction.$queryRaw<{ id: string }[]>`
        SELECT b.id
        FROM builds b
        JOIN prototypes p ON p.id = b.prototype_id
        WHERE p.repository_id = ${repositoryId}::uuid
          AND p.branch_name = ${repository.defaultBranch}
          AND p.branch_deleted_at IS NULL
          AND b.state = 'successful'
          ${buildId ? Prisma.sql`AND b.id = ${buildId}::uuid` : Prisma.empty}
        ORDER BY COALESCE(b.workflow_created_at, b.created_at) DESC, b.number DESC, b.id DESC
        LIMIT 1
      `
      const build = selected
        ? await transaction.build.findUniqueOrThrow({
            where: { id: selected.id },
            select: {
              id: true,
              number: true,
              prototypeId: true,
              githubWorkflowRunId: true,
              artifacts: {
                where: {
                  OR: [
                    { kind: "manifest", path: "templates.json" },
                    { kind: "dist", path: "dist/index.html" },
                    { kind: "screenshot", path: { startsWith: "screenshots/" } },
                  ],
                },
                select: { path: true, storageKey: true, byteLength: true },
              },
            },
          })
        : null
      const { githubRepositoryId, ...publicRepository } = repository
      return {
        repository: publicRepository,
        build: build
          ? {
              id: build.id,
              number: build.number,
              prototypeId: build.prototypeId,
              artifacts: build.artifacts,
              mountPath: createBuildPreviewPath(githubRepositoryId, build.githubWorkflowRunId),
            }
          : null,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}
