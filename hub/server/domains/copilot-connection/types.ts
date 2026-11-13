export interface CopilotConnectionSnapshot {
  connectionId: string | null
  generation: bigint
}

export interface CopilotConnectionTransactionRepositories {
  advanceState: () => Promise<unknown>
  clearRefusal: () => Promise<unknown>
  continueAuthorization?: (input: {
    actorMembershipId: string
    authorizationId: string
    hubSessionId: string
    operation: "CONNECT_COPILOT" | "DISCONNECT_COPILOT"
  }) => Promise<boolean>
  deleteConnection: () => Promise<boolean>
  lockAdministratorSession: (sessionDigest: string) => Promise<{ membershipId: string } | null>
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
  writeAudit: (input: CreateSecurityAuditEvent) => Promise<unknown>
}
import type { CreateSecurityAuditEvent } from "../../repositories/security-audits/create-security-audit/types.ts"
