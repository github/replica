import { Prisma } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { advanceGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/advance-github-repository-access-state/index.ts"
import { lockGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/lock-github-repository-access-state/index.ts"
import { readGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/read-github-repository-access-state/index.ts"
import { listConnectedGitHubRepositories } from "../../../repositories/repository-access/list-connected-github-repositories/index.ts"
import { listDisconnectedGitHubRepositoriesWithGrants } from "../../../repositories/repository-access/list-disconnected-github-repositories-with-grants/index.ts"
import { markRepositoriesDisconnected } from "../../../repositories/repository-access/mark-repositories-disconnected/index.ts"
import { removeRepositoryAccessGrants } from "../../../repositories/repository-access/remove-repository-access-grants/index.ts"
import { upsertConnectedRepositories } from "../../../repositories/repository-access/upsert-connected-repositories/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import { AdmissionTransactionConflictError } from "../errors.ts"
import { requireCurrentGitHubInstallation } from "../require-current-github-installation/index.ts"
import { revokeEmptyGitHubRepositoryAccess } from "../revoke-empty-github-repository-access/index.ts"
import type { ConnectedRepositoryEvidence } from "../../../repositories/repository-access/types.ts"
import type { AdmissionDatabaseClient } from "../run-admission-transaction/types.ts"

export async function syncGitHubInstallationRepositories<T extends ConnectedRepositoryEvidence>(
  database: AdmissionDatabaseClient & Parameters<typeof readGitHubRepositoryAccessState>[0],
  fetchRepositories: () => Promise<T[]>,
  provider: { configurationDigest: string; revision: number },
): Promise<T[]> {
  return runWithBoundedRetries(
    async () => {
      const { revision } = await readGitHubRepositoryAccessState(database)
      const repositories = await fetchRepositories()
      const incomingIds = new Set(
        repositories.map((repository) => BigInt(repository.githubRepositoryId)),
      )
      if (incomingIds.size !== repositories.length) {
        throw new Error("The GitHub installation repository list contains duplicate IDs.")
      }
      await database.$transaction(
        async (transaction) => {
          await requireCurrentGitHubInstallation(transaction, provider)
          const currentState = await lockGitHubRepositoryAccessState(transaction, "write")
          if (currentState.revision !== revision) throw new AdmissionTransactionConflictError()
          const connected = await listConnectedGitHubRepositories(transaction)
          const disconnectedWithGrants =
            await listDisconnectedGitHubRepositoriesWithGrants(transaction)
          const currentById = new Map(
            connected.map((repository) => [repository.githubRepositoryId, repository]),
          )
          const changed =
            connected.length !== repositories.length ||
            disconnectedWithGrants.length > 0 ||
            repositories.some((repository) => {
              const current = currentById.get(BigInt(repository.githubRepositoryId))
              return (
                !current ||
                current.nameWithOwner !== repository.nameWithOwner ||
                current.defaultBranch !== repository.defaultBranch
              )
            })
          if (!changed) return
          const { changedAt } = await advanceGitHubRepositoryAccessState(transaction)
          await upsertConnectedRepositories(transaction, repositories, { allowReconnect: true })
          const removedIds = connected
            .map((repository) => repository.githubRepositoryId)
            .filter((id): id is bigint => id !== null && !incomingIds.has(id))
          const staleGrantIds = disconnectedWithGrants
            .map((repository) => repository.githubRepositoryId)
            .filter((id): id is bigint => id !== null)
          const grantIdsToRemove = [...new Set([...removedIds, ...staleGrantIds])]
          if (!grantIdsToRemove.length) return
          if (removedIds.length) {
            await markRepositoriesDisconnected(transaction, { githubRepositoryIds: removedIds })
          }
          const { emptiedMembershipIds } = await removeRepositoryAccessGrants(transaction, {
            githubRepositoryIds: grantIdsToRemove,
          })
          await revokeEmptyGitHubRepositoryAccess(transaction, {
            changedAt,
            membershipIds: emptiedMembershipIds,
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      return repositories
    },
    (error) =>
      error instanceof AdmissionTransactionConflictError ||
      classifyPrismaTransactionError(error) === "retryable",
  )
}
