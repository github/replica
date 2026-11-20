import type { Prisma } from "../../../generated/prisma/client.ts"
import { lockGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/lock-github-repository-access-state/index.ts"
import { findHostedSharingPrototype } from "../../../repositories/public-sharing/find-hosted-sharing-prototype/index.ts"
import { lockSharingSetting } from "../../../repositories/public-sharing/lock-sharing-setting/index.ts"
import { hostedPublicSharingSettingKey } from "../../../utils/public-sharing-setting-key/index.ts"
import { PublicSharingError } from "../errors.ts"
import type { HostedSharingApproval, HostedSharingTarget } from "../types.ts"

export async function lockHostedSharingRevisions(
  transaction: Prisma.TransactionClient,
  input: Pick<HostedSharingApproval, "policyRevision" | "repositoryAccessRevision">,
) {
  const access = await lockGitHubRepositoryAccessState(transaction)
  const policy = await lockSharingSetting(transaction, hostedPublicSharingSettingKey)
  if (!policy?.publicSharingEnabled) {
    throw new PublicSharingError("disabled", "Public sharing is disabled.")
  }
  if (
    access.revision !== input.repositoryAccessRevision ||
    policy.revision !== input.policyRevision
  ) {
    throw new PublicSharingError("policy_changed", "Sharing access changed. Refresh and try again.")
  }
  return policy
}

export async function lockHostedSharingApproval(
  transaction: Prisma.TransactionClient,
  approval: HostedSharingApproval | undefined,
  target: Pick<HostedSharingTarget, "prototypeId"> &
    Partial<Pick<HostedSharingTarget, "repositoryId">>,
) {
  if (
    !approval ||
    (target.repositoryId !== undefined && approval.repositoryId !== target.repositoryId) ||
    approval.prototypeId !== target.prototypeId
  ) {
    throw new PublicSharingError("forbidden", "Current GitHub sharing permission is required.")
  }
  await lockHostedSharingRevisions(transaction, approval)
  const prototype = await findHostedSharingPrototype(
    transaction,
    approval,
    approval.permission === "admin" ? undefined : { ...approval.identity, userId: approval.userId },
  )
  if (!prototype || prototype.branchName === prototype.repository.defaultBranch) {
    throw new PublicSharingError("forbidden", "You cannot manage share links for this prototype.")
  }
  return approval
}
