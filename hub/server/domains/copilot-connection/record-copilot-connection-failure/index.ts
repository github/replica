import type { CopilotConnectionTransactionRepositories } from "../types.ts"

export function recordCopilotConnectionFailure(
  { credentialProvider, sessionDigest }: { credentialProvider: string; sessionDigest: string },
  {
    createId,
    runTransaction,
  }: {
    createId: () => string
    runTransaction: <T>(
      operation: (repositories: CopilotConnectionTransactionRepositories) => Promise<T>,
    ) => Promise<T>
  },
) {
  return runTransaction(async (repositories) => {
    await repositories.lockState()
    const session = await repositories.lockAdministratorSession(sessionDigest)
    if (!session) return false
    await repositories.writeAudit({
      actorMembershipId: session.membershipId,
      credentialProvider,
      id: createId(),
      phase: "failed",
      reason: "status_check_failed",
      type: "copilot_connection",
    })
    return true
  })
}
