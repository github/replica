import type { Prisma } from "../../../../generated/prisma/client.ts"
import { readGitHubRepositoryAccessState } from "../../../../repositories/github-repository-access-states/read-github-repository-access-state/index.ts"
import { resolveRepositoryScope } from "../resolve-repository-scope/index.ts"

export async function resolvePersistedRepositoryScope(
  database: Pick<Prisma.TransactionClient, "gitHubRepositoryAccessState">,
  viewer: Parameters<typeof resolveRepositoryScope>[0],
  githubConfigured: boolean,
) {
  const active =
    githubConfigured ||
    (await readGitHubRepositoryAccessState(database)).scopingActivatedAt !== null
  return resolveRepositoryScope(viewer, active)
}
