import { CopilotConnectionError } from "../errors.ts"
import type { CopilotConnectionTransactionRepositories } from "../types.ts"

export async function disconnectCopilot(
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
    if (!session) {
      throw new CopilotConnectionError("not_authorized", "Administrator access is required.")
    }
    const connection = await repositories.getConnection()
    if (!connection || !(await repositories.deleteConnection())) {
      throw new CopilotConnectionError("not_connected", "Copilot is not connected.")
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
