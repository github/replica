export interface CopilotConnectionSnapshot {
  connectionId: string | null
  generation: bigint
}

export interface CopilotConnectionTransactionRepositories {
  advanceState: () => Promise<unknown>
  deleteConnection: () => Promise<boolean>
  findAdministratorSession: (sessionDigest: string) => Promise<{ membershipId: string } | null>
  getConnection: () => Promise<{ id: string } | null>
  lockState: () => Promise<{ generation: bigint } | null>
  replaceConnection: (input: {
    connectedByMembershipId: string
    id: string
    tokenDigest: string
    verifiedAt: Date
  }) => Promise<unknown>
  refuseConnection: (input: {
    id: string
    refusedAt: Date
    tokenDigest: string
  }) => Promise<boolean>
  writeAudit: (input: {
    actorMembershipId: string | null
    connectionId?: string
    id: string
    phase: "connected" | "disconnected" | "denied" | "failed"
    reason?: string
    type: "copilot_connection"
  }) => Promise<unknown>
}
