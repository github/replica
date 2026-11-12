import type { CopilotConnectionTransactionRepositories } from "../types.ts"

export function recordCopilotConnectionFailure(
  { sessionDigest }: { sessionDigest: string },
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
    const session = await repositories.findAdministratorSession(sessionDigest)
    if (!session) return false
    await repositories.writeAudit({
      actorMembershipId: session.membershipId,
      id: createId(),
      phase: "failed",
      reason: "status_check_failed",
      type: "copilot_connection",
    })
    return true
  })
}
