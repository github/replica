export interface CopilotConnectionRouteDependencies {
  applicationOrigin: string
  authorization?: {
    cancel(input: { authorizationId: string; hubSessionId: string }): Promise<boolean>
    findSession: (sessionDigest: string) => Promise<{
      externalIdentityId: string
      id: string
      membershipId: string
      providerKey: string
    } | null>
    getAuthorization(input: { authorizationId: string; hubSessionId: string }): Promise<unknown>
    start: Partial<
      Record<
        "entra" | "github" | "local",
        {
          applicationOrigin: string
          secureCookie: boolean
          checkRateLimit(
            operation: "start" | "callback",
            subjectDigest: string,
          ): Promise<{ allowed: boolean; auditFailed: boolean }>
          start(input: {
            actorMembershipId: string
            expectedCopilotGeneration?: bigint
            externalIdentityId: string
            hubSessionId: string
            operation:
              | "CONNECT_COPILOT"
              | "DESIGNATE_ADMINISTRATORS"
              | "DISCONNECT_COPILOT"
              | "END_ALL_HUB_SESSIONS"
              | "REVOKE_ADMINISTRATOR"
            targetMembershipIds: string[]
          }): Promise<{
            authorizationId: string
            authorizationUrl: string
            browserBinding: string
            expiresAt: Date
          }>
        }
      >
    >
  }
  continueAuthorization?(input: {
    authorizationId: string
    hubSessionId: string
    operation: "CONNECT_COPILOT" | "DISCONNECT_COPILOT"
    sessionDigest: string
    signal?: AbortSignal
  }): Promise<unknown>
  findSession: (sessionDigest: string) => Promise<{ membershipId: string } | null>
  getGeneration?: () => Promise<bigint>
  status: () => Promise<{
    configured: boolean
    connected: boolean
    savedConnection: boolean
    credentialIdentity: {
      appId: string
      installationId: string
      organization: string
    } | null
    connectedBy: {
      login: string | null
      membershipId: string
      name: string | null
    } | null
    refusedAt: Date | null
    verifiedAt: Date | null
  }>
}
