import { z } from "zod"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { GitHubProviderRequestError } from "../../../integrations/github/errors.ts"
import { readGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/read-github-repository-access-state/index.ts"
import { findHostedSharingIdentity } from "../../../repositories/public-sharing/find-hosted-sharing-identity/index.ts"
import { findHostedSharingPrototype } from "../../../repositories/public-sharing/find-hosted-sharing-prototype/index.ts"
import { getSharingSetting } from "../../../repositories/public-sharing/get-sharing-setting/index.ts"
import { revokeHostedCreatorLinks } from "../../../repositories/public-sharing/revoke-hosted-creator-links/index.ts"
import { updateSharingSetting } from "../../../repositories/public-sharing/update-sharing-setting/index.ts"
import { hostedPublicSharingSettingKey } from "../../../utils/public-sharing-setting-key/index.ts"
import { PublicSharingError } from "../errors.ts"
import {
  lockHostedSharingApproval,
  lockHostedSharingRevisions,
} from "../lock-hosted-sharing-approval/index.ts"
import type { HostedSharingApproval, PublicSharingService } from "../types.ts"

export async function authorizeHostedSharing(
  database: PrismaClient,
  enabled: boolean,
  input: Parameters<NonNullable<PublicSharingService["hosted"]>["authorize"]>[0],
): Promise<HostedSharingApproval> {
  const policy = enabled && (await getSharingSetting(database, hostedPublicSharingSettingKey))
  if (!policy || !policy.publicSharingEnabled) {
    throw new PublicSharingError("disabled", "Public sharing is disabled.")
  }
  const { viewer, repositoryId, prototypeId } = input
  const parsedIdentityId = z.uuid().safeParse(viewer.externalIdentityId)
  const identity =
    viewer.sessionProvider === "github" && parsedIdentityId.success
      ? await findHostedSharingIdentity(database, {
          externalIdentityId: parsedIdentityId.data,
          userId: viewer.userId,
        })
      : null
  if (!identity || !/^[1-9]\d*$/.test(identity.subject)) {
    throw new PublicSharingError("forbidden", "Sign in with GitHub to manage public share links.")
  }

  const { revision: repositoryAccessRevision } = await readGitHubRepositoryAccessState(database)
  const target = { repositoryId, prototypeId }
  const prototype = await findHostedSharingPrototype(database, target)
  if (!prototype || prototype.branchName === prototype.repository.defaultBranch) {
    throw new PublicSharingError("not_found", "Prototype not found.")
  }
  const versions = { policyRevision: policy.revision, repositoryAccessRevision }
  const permission = await input.getRepositoryPermission()
  if (permission === "none") {
    await database.$transaction(async (transaction) => {
      const current = await lockHostedSharingRevisions(transaction, versions)
      // Invalidate positive lookups that started before this loss, even if there were no links.
      await updateSharingSetting(transaction, { id: current.id, enabled: true })
      await revokeHostedCreatorLinks(transaction, {
        externalIdentityId: identity.id,
        repositoryId,
        revokedAt: new Date(),
      })
    })
    throw new PublicSharingError("not_found", "Prototype not found.")
  }
  switch (permission) {
    case "admin":
    case "maintain":
    case "write":
    case "triage":
    case "read":
      break
    default:
      throw new GitHubProviderRequestError()
  }
  return database.$transaction((transaction) =>
    lockHostedSharingApproval(
      transaction,
      { ...target, ...versions, userId: viewer.userId, identity, permission },
      target,
    ),
  )
}
