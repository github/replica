import { CopilotConnectionError } from "../errors.ts"
import type { CopilotConnectionTransactionRepositories } from "../types.ts"

export async function disconnectCopilot(
  {
    authorizationId,
    hubSessionId,
    sessionDigest,
  }: { authorizationId?: string; hubSessionId?: string; sessionDigest: string },
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
    if (!session) {
      throw new CopilotConnectionError("not_authorized", "Administrator access is required.")
    }
    const connection = await repositories.getConnection()
    if (!connection || !(await repositories.deleteConnection())) {
      throw new CopilotConnectionError("not_connected", "Copilot is not connected.")
    }
    if (
      authorizationId &&
      (!hubSessionId ||
        !repositories.continueAuthorization ||
        !(await repositories.continueAuthorization({
          actorMembershipId: session.membershipId,
          authorizationId,
          hubSessionId,
          operation: "DISCONNECT_COPILOT",
        })))
    ) {
      throw new CopilotConnectionError(
        "not_authorized",
        "The Copilot authorization is no longer available.",
      )
    }
    if (authorizationId) {
      await repositories.writeAudit({
        actorMembershipId: session.membershipId,
        authorizationId,
        id: createId(),
        operation: "DISCONNECT_COPILOT",
        phase: "completed",
        targetCount: 1,
        type: "administrator_authorization",
      })
    }
    await repositories.clearRefusal()
    await repositories.advanceState()
    await repositories.writeAudit({
      actorMembershipId: session.membershipId,
      connectionId: connection.id,
      credentialProvider: connection.credentialProvider,
      id: createId(),
      phase: "disconnected",
      type: "copilot_connection",
    })
    return { disconnected: true as const }
  })
}
