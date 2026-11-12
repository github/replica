import type {
  CopilotConnectionSnapshot,
  CopilotConnectionTransactionRepositories,
} from "../types.ts"

export function recordCopilotConnectionRefusal(
  input: {
    at: Date
    credentialDigest: string
    credentialProvider: string
    sessionDigest: string
    snapshot: CopilotConnectionSnapshot
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
    if (
      !(await repositories.recordRefusal({
        credentialDigest: input.credentialDigest,
        credentialProvider: input.credentialProvider,
        refusedAt: input.at,
      }))
    ) {
      return "connection_changed" as const
    }
    await repositories.advanceState()
    await repositories.writeAudit({
      actorMembershipId: session.membershipId,
      connectionId:
        connection?.credentialProvider === input.credentialProvider &&
        connection.credentialDigest === input.credentialDigest
          ? connection.id
          : undefined,
      credentialProvider: input.credentialProvider,
      id: createId(),
      phase: "denied",
      reason: "credential_refused",
      type: "copilot_connection",
    })
    return "recorded" as const
  })
}
