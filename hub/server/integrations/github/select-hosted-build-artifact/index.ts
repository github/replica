import { z } from "zod"

import {
  InvalidGitHubInstallationEvidence,
  type GitHubInstallationClient,
} from "../create-installation-client/index.ts"
import { githubId, githubRepositoryPath, replicaArtifactName } from "../hosted-build-evidence.ts"
import type { GitHubRepositoryEvidence } from "../types.ts"

const artifactPage = z.object({
  total_count: z.number().int().nonnegative().max(1_000),
  artifacts: z
    .array(
      z.object({
        id: githubId,
        name: z.string(),
        expired: z.boolean(),
        created_at: z.iso.datetime({ offset: true }),
        workflow_run: z
          .object({
            id: githubId,
            repository_id: githubId,
            head_repository_id: githubId,
            head_branch: z.string(),
            head_sha: z.string(),
          })
          .nullish(),
      }),
    )
    .max(100),
})

export async function selectHostedBuildArtifact(
  client: GitHubInstallationClient,
  repository: GitHubRepositoryEvidence,
  run: { id: bigint; branchName: string; commitSha: string },
  { startedAt, finishedAt }: { startedAt: Date; finishedAt: Date },
) {
  const url = `${githubRepositoryPath(repository.nameWithOwner)}/actions/runs/${run.id}/artifacts`
  const seen = new Set<number>()
  let total: number | undefined
  const matches: z.infer<typeof artifactPage>["artifacts"] = []

  for (let page = 1; ; page += 1) {
    const result = await client.get(
      `${url}?name=${replicaArtifactName}&per_page=100&page=${page}`,
      artifactPage,
    )
    if (total !== undefined && result.total_count !== total)
      throw new InvalidGitHubInstallationEvidence()
    total = result.total_count
    for (const artifact of result.artifacts) {
      const evidence = artifact.workflow_run
      if (
        seen.has(artifact.id) ||
        (evidence &&
          (BigInt(evidence.id) !== run.id ||
            evidence.repository_id !== repository.githubRepositoryId ||
            evidence.head_repository_id !== repository.githubRepositoryId ||
            evidence.head_branch !== run.branchName ||
            evidence.head_sha !== run.commitSha))
      ) {
        throw new InvalidGitHubInstallationEvidence()
      }
      seen.add(artifact.id)
      const createdAt = new Date(artifact.created_at)
      if (artifact.name === replicaArtifactName && createdAt > startedAt && createdAt <= finishedAt)
        matches.push(artifact)
    }
    if (seen.size === total) break
    if (seen.size > total || result.artifacts.length < 100 || page >= 10)
      throw new InvalidGitHubInstallationEvidence()
  }

  const [artifact] = matches
  if (!artifact) return { status: "missing" } as const
  if (matches.length !== 1) return { status: "duplicate" } as const
  if (artifact.expired) return { status: "expired" } as const
  return { status: "found", id: BigInt(artifact.id) } as const
}
