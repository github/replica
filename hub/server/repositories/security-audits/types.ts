export interface AuditInput {
  event: string
  outcome?: "succeeded" | "denied" | "failed"
  actorUserId: string | null
  sessionId: string | null
  authenticationProviderRevisionId: string | null
  targetMembershipId?: string | null
  invitationId?: string | null
  workspaceId?: string | null
  prototypeId?: string | null
  prototypeVersionId?: string | null
  workloadPublisherId?: string | null
  targetUserId?: string | null
  githubRepositorySourceId?: string | null
  context?: Record<string, string>
}

export interface SecurityAuditRecord {
  id: string
  event: string
  outcome: string
  actorUserId: string | null
  sessionId: string | null
  authenticationProviderRevisionId: string | null
  targetMembershipId: string | null
  invitationId: string | null
  workspaceId: string | null
  prototypeId: string | null
  prototypeVersionId: string | null
  workloadPublisherId: string | null
  targetUserId: string | null
  githubRepositorySourceId: string | null
  context: unknown
  createdAt: Date
}
