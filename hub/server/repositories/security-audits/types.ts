export interface AuditInput {
  event: string
  actorUserId: string | null
  sessionId: string | null
  authenticationProviderRevisionId: string | null
}
