import type { Prisma } from "../../../../generated/prisma/client.ts"
import type { RepositoryScope } from "../../../../repositories/prototype-index/visible-repository-where/index.ts"
import { resolvePersistedRepositoryScope } from "../resolve-persisted-repository-scope/index.ts"
import type { resolveRepositoryScope } from "../resolve-repository-scope/index.ts"

export async function readWithPersistedRepositoryScope<Result>(
  database: Pick<Prisma.TransactionClient, "gitHubRepositoryAccessState">,
  viewer: Parameters<typeof resolveRepositoryScope>[0],
  githubConfigured: boolean,
  read: (scope: RepositoryScope) => Promise<Result>,
): Promise<Result> {
  const scope = await resolvePersistedRepositoryScope(database, viewer, githubConfigured)
  const result = await read(scope)
  if (scope !== null) return result
  // Activation is permanent; repeat an unscoped read if another process activated it.
  const current = await resolvePersistedRepositoryScope(database, viewer, githubConfigured)
  return current === null ? result : read(current)
}
