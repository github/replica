import type { Prisma } from "../../../generated/prisma/client.ts"

export interface CreateSecurityAuditDatabase {
  securityAudit: {
    create(input: { data: Prisma.SecurityAuditCreateInput }): Promise<unknown>
  }
}

interface SecurityAuditEvent {
  id: string
}

export interface AuthenticationAttemptDeniedAudit extends SecurityAuditEvent {
  type: "authentication_attempt_denied"
  provider: string
  reason:
    | "configuration_changed"
    | "invalid_or_expired"
    | "provider_failed"
    | "verification_state_invalid"
}

export interface BootstrapAttemptDeniedAudit extends SecurityAuditEvent {
  type: "bootstrap_attempt_denied"
  reason: "invalid_secret" | "rate_limited"
}

export interface MembershipAssignmentCreatedAudit extends SecurityAuditEvent {
  type: "membership_assignment_created"
  membershipId: string
}

export interface MembershipCreatedAudit extends SecurityAuditEvent {
  type: "membership_created"
  membershipId: string
}

export interface MembershipRestoredAudit extends SecurityAuditEvent {
  type: "membership_restored"
  membershipId: string
}

export interface MembershipAssignmentRestoredAudit extends SecurityAuditEvent {
  type: "membership_assignment_restored"
  membershipId: string
}

export interface ProviderMembershipAssignmentAudit extends SecurityAuditEvent {
  type:
    | "provider_membership_assignment_created"
    | "provider_membership_assignment_revoked"
    | "provider_membership_assignment_superseded"
  assignmentId: string
  membershipId: string
  role: "MEMBER" | "ADMINISTRATOR"
}

export interface AdministratorMembershipAssignmentAudit extends SecurityAuditEvent {
  type:
    "administrator_membership_assignment_created" | "administrator_membership_assignment_revoked"
  actorMembershipId: string
  assignmentId: string
  targetMembershipId: string
}

export interface AdministratorManagementDeniedAudit extends SecurityAuditEvent {
  type: "administrator_management_denied"
  actorMembershipId: string | null
  operation: "designate" | "revoke"
  reason:
    | "invalid_selection"
    | "invalid_target"
    | "last_administrator"
    | "not_authorized"
    | "role_changed"
}

export interface AdministratorManagementFailedAudit extends SecurityAuditEvent {
  type: "administrator_management_failed"
  actorMembershipId: string
  operation: "designate" | "revoke"
  reason: "retry_exhausted" | "transaction_error"
}

export interface AdministratorAuthorizationAudit extends SecurityAuditEvent {
  type: "administrator_authorization"
  actorMembershipId: string
  authorizationId: string
  operation:
    | "CONNECT_COPILOT"
    | "DESIGNATE_ADMINISTRATORS"
    | "DISCONNECT_COPILOT"
    | "END_ALL_HUB_SESSIONS"
    | "REVOKE_ADMINISTRATOR"
  phase: "requested" | "verified" | "completed" | "denied" | "expired" | "cancelled"
  reason?: string
  targetCount: number
}

export interface CopilotConnectionAudit extends SecurityAuditEvent {
  type: "copilot_connection"
  actorMembershipId: string | null
  connectorMembershipId?: string
  operation: "connect" | "disconnect" | "view"
  outcome: "success" | "denied" | "failure"
  reason?: string
}

export interface AllHubSessionsEndedAudit extends SecurityAuditEvent {
  type: "all_hub_sessions_ended"
  actorMembershipId: string
  cancelledAuthorizationCount: number
  endedSessionCount: number
  revision: number
}

export interface AllHubSessionsEndFailedAudit extends SecurityAuditEvent {
  type: "all_hub_sessions_end_failed"
  actorMembershipId: string
  reason: "retry_exhausted" | "transaction_error"
}

export interface SessionCreatedAudit extends SecurityAuditEvent {
  type: "session_created"
  sessionId: string
  membershipId: string
}

export interface SessionEndedAudit extends SecurityAuditEvent {
  type: "session_ended"
  sessionId: string
  membershipId: string
}

export interface AdmissionDeniedAudit extends SecurityAuditEvent {
  type: "admission_denied"
  externalIdentityId: string
  reason:
    | "authority_missing"
    | "attempt_mismatch"
    | "configuration_changed"
    | "identity_mismatch"
    | "membership_inactive"
    | "membership_missing"
    | "provider_evidence_missing"
    | "provider_evidence_stale"
}

export interface AdmissionFailedAudit extends SecurityAuditEvent {
  type: "admission_failed"
  externalIdentityId: string
  reason: "retry_exhausted" | "transaction_error"
}

export interface ExternalIdentityCreatedAudit extends SecurityAuditEvent {
  type: "external_identity_created"
  externalIdentityId: string
  issuer: string
  provider: string
}

export interface ExternalIdentityCreateFailedAudit extends SecurityAuditEvent {
  type: "external_identity_create_failed"
  issuer: string
  provider: string
  reason: "retry_exhausted" | "transaction_error"
}

export interface ProviderRevisionSelectedAudit extends SecurityAuditEvent {
  type: "provider_revision_selected"
  providerId: string
  providerKey: string
  revision: number
}

export interface ProviderRevisionValidationFailedAudit extends SecurityAuditEvent {
  type: "provider_revision_validation_failed"
  providerKey: string
  revision: number
}

export interface ProviderRevisionDeniedAudit extends SecurityAuditEvent {
  type: "provider_revision_denied"
  providerKey: string
  reason:
    | "invariant"
    | "reactivation_requires_revision"
    | "revision_gap"
    | "rollback"
    | "same_revision_drift"
  revision: number
}

export interface ProviderRevisionPersistFailedAudit extends SecurityAuditEvent {
  type: "provider_revision_persist_failed"
  providerKey: string
  reason: "retry_exhausted" | "transaction_error"
  revision: number
}

export interface AuthenticationProviderLifecycleAudit extends SecurityAuditEvent {
  type: "authentication_provider_disabled" | "authentication_provider_enabled"
  providerId: string
  providerKey: string
}

export interface AuthenticationProvidersReconcileFailedAudit extends SecurityAuditEvent {
  type: "authentication_providers_reconcile_failed"
  providerKeys: string[]
  reason: "retry_exhausted" | "transaction_error"
}

export interface SessionRevocationAdvancedAudit extends SecurityAuditEvent {
  type: "session_revocation_advanced"
  reason: "provider_removed"
  revision: number
}

export interface CopilotConnectionAudit extends SecurityAuditEvent {
  type: "copilot_connection"
  actorMembershipId: string | null
  connectionId?: string
  credentialProvider: string
  phase: "connected" | "disconnected" | "denied" | "failed"
  reason?: string
}

export type CreateSecurityAuditEvent =
  | AuthenticationAttemptDeniedAudit
  | BootstrapAttemptDeniedAudit
  | MembershipAssignmentCreatedAudit
  | MembershipAssignmentRestoredAudit
  | ProviderMembershipAssignmentAudit
  | MembershipCreatedAudit
  | MembershipRestoredAudit
  | SessionCreatedAudit
  | SessionEndedAudit
  | AdministratorMembershipAssignmentAudit
  | AdministratorManagementDeniedAudit
  | AdministratorManagementFailedAudit
  | AdministratorAuthorizationAudit
  | CopilotConnectionAudit
  | AllHubSessionsEndedAudit
  | AllHubSessionsEndFailedAudit
  | AdmissionDeniedAudit
  | AdmissionFailedAudit
  | ExternalIdentityCreatedAudit
  | ExternalIdentityCreateFailedAudit
  | ProviderRevisionValidationFailedAudit
  | ProviderRevisionSelectedAudit
  | ProviderRevisionDeniedAudit
  | ProviderRevisionPersistFailedAudit
  | AuthenticationProviderLifecycleAudit
  | AuthenticationProvidersReconcileFailedAudit
  | SessionRevocationAdvancedAudit
  | CopilotConnectionAudit
