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
  reason: "invariant" | "revision_gap" | "rollback" | "same_revision_drift"
  revision: number
}

export interface ProviderRevisionPersistFailedAudit extends SecurityAuditEvent {
  type: "provider_revision_persist_failed"
  providerKey: string
  reason: "retry_exhausted" | "transaction_error"
  revision: number
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
  | AdmissionDeniedAudit
  | AdmissionFailedAudit
  | ExternalIdentityCreatedAudit
  | ExternalIdentityCreateFailedAudit
  | ProviderRevisionValidationFailedAudit
  | ProviderRevisionSelectedAudit
  | ProviderRevisionDeniedAudit
  | ProviderRevisionPersistFailedAudit
