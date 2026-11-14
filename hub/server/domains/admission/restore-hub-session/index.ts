import { z } from "zod"

import type { SessionRestoreTransaction } from "../run-session-restore-transaction/types.ts"

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)

export async function restoreHubSession(
  digest: string,
  dependencies: { runTransaction: SessionRestoreTransaction },
) {
  const parsedDigest = digestSchema.parse(digest)
  return dependencies.runTransaction(async (repositories) => {
    const revocation = await repositories.getRevocation()
    const session = await repositories.findSession(parsedDigest)
    if (!session || !revocation || session.revocationRevision !== revocation.revision) {
      return null
    }
    const providerKeys = await repositories.getActiveProviderKeys(session.membershipId)
    for (const providerKey of providerKeys) {
      const provider = await repositories.lockProvider(providerKey)
      if (!provider?.enabled) return null
    }
    const lockedRevocation = await repositories.lockRevocation()
    if (!lockedRevocation || lockedRevocation.revision !== revocation.revision) return null
    const membership = await repositories.lockMembership(session.membershipId)
    if (!membership || membership.lifecycle !== "ACTIVE") return null
    const assignments = await repositories.lockActiveAssignments(session.membershipId)
    if (!assignments.length) return null
    const finalSession = await repositories.lockSession(parsedDigest)
    if (finalSession?.id !== session.id) return null
    const finalRevocation = await repositories.getRevocation()
    if (!finalRevocation || finalRevocation.revision !== revocation.revision) return null
    return {
      externalIdentityId: session.externalIdentityId,
      membershipId: membership.id,
      userId: membership.userId,
      role: assignments.some((assignment) => assignment.role === "ADMINISTRATOR")
        ? ("ADMINISTRATOR" as const)
        : ("MEMBER" as const),
    }
  })
}
