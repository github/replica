import type {
  CopilotConnectionSnapshot,
  CopilotConnectionTransactionRepositories,
} from "../types.ts"

export function recordCopilotConnectionRefusal(
  input: {
    appId?: string
    at: Date
    billedOrganization?: string
    credentialDigest: string
    credentialProvider: string
    reason?: "credential_permission_denied" | "credential_refused" | "credential_revoked"
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
    const session = await repositories.lockAdministratorSession(input.sessionDigest)
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
      ...(input.appId ? { appId: input.appId } : {}),
      ...(input.billedOrganization ? { billedOrganization: input.billedOrganization } : {}),
      connectionId:
        connection?.credentialProvider === input.credentialProvider &&
        connection.credentialDigest === input.credentialDigest
          ? connection.id
          : undefined,
      credentialProvider: input.credentialProvider,
      id: createId(),
      phase: "denied",
      reason: input.reason ?? "credential_refused",
      type: "copilot_connection",
    })
    return "recorded" as const
  })
}
