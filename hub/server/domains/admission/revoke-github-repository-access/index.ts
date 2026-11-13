import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { advanceGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/advance-github-repository-access-state/index.ts"
import { markRepositoriesDisconnected } from "../../../repositories/repository-access/mark-repositories-disconnected/index.ts"
import { removeRepositoryAccessGrants } from "../../../repositories/repository-access/remove-repository-access-grants/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import { AdmissionTransactionConflictError } from "../errors.ts"
import { requireCurrentGitHubInstallation } from "../require-current-github-installation/index.ts"
import { revokeEmptyGitHubRepositoryAccess } from "../revoke-empty-github-repository-access/index.ts"

export async function revokeGitHubRepositoryAccess(
  database: Pick<PrismaClient, "$transaction">,
  input: {
    disconnect: boolean
    githubRepositoryIds: number[] | "all"
    githubUserId?: number
  },
  provider: { configurationDigest: string; revision: number },
) {
  await runWithBoundedRetries(
    () =>
      database.$transaction(
        async (transaction) => {
          await requireCurrentGitHubInstallation(transaction, provider)
          const { changedAt } = await advanceGitHubRepositoryAccessState(transaction)
          if (input.disconnect) {
            await markRepositoriesDisconnected(
              transaction,
              input.githubRepositoryIds === "all"
                ? { exceptGithubRepositoryIds: [] }
                : { githubRepositoryIds: input.githubRepositoryIds },
            )
          }
          const { emptiedMembershipIds } = await removeRepositoryAccessGrants(transaction, input)
          await revokeEmptyGitHubRepositoryAccess(transaction, {
            changedAt,
            membershipIds: emptiedMembershipIds,
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    (error) =>
      error instanceof AdmissionTransactionConflictError ||
      classifyPrismaTransactionError(error) === "retryable",
  )
}
