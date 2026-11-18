import type { PrismaClient } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { advanceGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/advance-github-repository-access-state/index.ts"
import { claimGitHubWebhookDelivery } from "../../../repositories/github-webhook-deliveries/claim-github-webhook-delivery/index.ts"
import type { GitHubWebhookDelivery } from "../../../repositories/github-webhook-deliveries/types.ts"
import { markRepositoriesDisconnected } from "../../../repositories/repository-access/mark-repositories-disconnected/index.ts"
import { removeRepositoryAccessGrants } from "../../../repositories/repository-access/remove-repository-access-grants/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import { githubAccessTransactionOptions } from "../github-access-transaction-options/index.ts"
import { AdmissionTransactionConflictError } from "../errors.ts"
import { requireCurrentGitHubInstallation } from "../require-current-github-installation/index.ts"
import { revokeEmptyGitHubRepositoryAccess } from "../revoke-empty-github-repository-access/index.ts"

export async function revokeGitHubRepositoryAccess(
  database: Pick<PrismaClient, "$transaction">,
  input: {
    disconnect: boolean
    githubRepositoryIds: number[] | "all"
    githubUserId?: number
    delivery?: GitHubWebhookDelivery
  },
  provider: { configurationDigest: string; revision: number },
) {
  await runWithBoundedRetries(
    () =>
      database.$transaction(async (transaction) => {
        await requireCurrentGitHubInstallation(transaction, provider)
        if (input.delivery && !(await claimGitHubWebhookDelivery(transaction, input.delivery))) {
          return
        }
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
      }, githubAccessTransactionOptions),
    (error) =>
      error instanceof AdmissionTransactionConflictError ||
      classifyPrismaTransactionError(error) === "retryable",
  )
}
