export interface CopilotConnectionSnapshot {
  connectionId: string | null
  generation: bigint
}

export interface CopilotConnectionTransactionRepositories {
  advanceState: () => Promise<unknown>
  clearRefusal: () => Promise<unknown>
  deleteConnection: () => Promise<boolean>
  findAdministratorSession: (sessionDigest: string) => Promise<{ membershipId: string } | null>
  getConnection: () => Promise<{
    credentialDigest: string
    credentialProvider: string
    id: string
  } | null>
  lockState: () => Promise<{ generation: bigint } | null>
  replaceConnection: (input: {
    connectedByMembershipId: string
    credentialDigest: string
    credentialProvider: string
    id: string
    verifiedAt: Date
  }) => Promise<unknown>
  recordRefusal: (input: {
    credentialDigest: string
    credentialProvider: string
    refusedAt: Date
  }) => Promise<boolean>
  writeAudit: (input: {
    actorMembershipId: string | null
    connectionId?: string
    credentialProvider: string
    id: string
    phase: "connected" | "disconnected" | "denied" | "failed"
    reason?: string
    type: "copilot_connection"
  }) => Promise<unknown>
}
