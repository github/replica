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
    const session = await repositories.lockSession(parsedDigest)
    if (!session || !revocation || session.revocationRevision !== revocation.revision) {
      return null
    }
    const membership = await repositories.lockMembership(session.userId)
    if (membership?.id !== session.membershipId || membership.lifecycle !== "ACTIVE") return null
    if (!(await repositories.lockActiveAssignment(session.membershipId))) return null
    const finalRevocation = await repositories.getRevocation()
    if (!finalRevocation || finalRevocation.revision !== revocation.revision) return null
    return {
      membershipId: session.membershipId,
      role: "administrator" as const,
      sessionId: session.id,
      userId: session.userId,
    }
  })
}
