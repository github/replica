import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { claimGitHubWebhookDelivery } from "../../../repositories/github-webhook-deliveries/claim-github-webhook-delivery/index.ts"
import type { GitHubWebhookDelivery } from "../../../repositories/github-webhook-deliveries/types.ts"
import { retireGitHubBranch } from "../../../repositories/prototypes/retire-github-branch/index.ts"

/** Records the receipt and branch retirement together without deleting its history. */
export function recordGitHubBranchDeletion(
  database: PrismaClient,
  input: {
    githubRepositoryId: number
    branchName: string
    delivery: GitHubWebhookDelivery
  },
) {
  return database.$transaction(async (transaction) => {
    if (!(await claimGitHubWebhookDelivery(transaction, input.delivery))) return
    await retireGitHubBranch(transaction, input)
  })
}
