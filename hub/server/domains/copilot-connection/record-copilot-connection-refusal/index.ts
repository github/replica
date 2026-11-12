import type {
  CopilotConnectionSnapshot,
  CopilotConnectionTransactionRepositories,
} from "../types.ts"

export function recordCopilotConnectionRefusal(
  input: {
    at: Date
    sessionDigest: string
    snapshot: CopilotConnectionSnapshot
    tokenDigest: string
  },
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
    const state = await repositories.lockState()
    const session = await repositories.findAdministratorSession(input.sessionDigest)
    if (!session) return "not_authorized" as const
    const connection = await repositories.getConnection()
    if (
      !state ||
      state.generation !== input.snapshot.generation ||
      (connection?.id ?? null) !== input.snapshot.connectionId
    ) {
      return "connection_changed" as const
    }
    if (connection) {
      if (
        !(await repositories.refuseConnection({
          id: connection.id,
          refusedAt: input.at,
          tokenDigest: input.tokenDigest,
        }))
      ) {
        return "connection_changed" as const
      }
    }
    await repositories.advanceState()
    await repositories.writeAudit({
      actorMembershipId: session.membershipId,
      connectionId: connection?.id,
      id: createId(),
      phase: "denied",
      reason: "token_refused",
      type: "copilot_connection",
    })
    return "recorded" as const
  })
}
