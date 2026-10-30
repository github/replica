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
  reason: "configuration_changed" | "invalid_or_expired" | "provider_failed" | "rate_limited"
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

export interface AuthenticationHandoffCreatedAudit extends SecurityAuditEvent {
  type: "authentication_handoff_created"
  externalIdentityId: string
  handoffId: string
  providerRevisionId: string
}

export interface AuthenticationHandoffConsumedAudit extends SecurityAuditEvent {
  type: "authentication_handoff_consumed"
  externalIdentityId: string
  handoffId: string
}

export interface AuthenticationHandoffDeniedAudit extends SecurityAuditEvent {
  type: "authentication_handoff_denied"
  reason: "browser_mismatch" | "expired" | "provider_revision_changed" | "replayed" | "revoked"
  handoffId?: string
}

export type CreateSecurityAuditEvent =
  | AuthenticationAttemptDeniedAudit
  | AuthenticationHandoffConsumedAudit
  | AuthenticationHandoffCreatedAudit
  | AuthenticationHandoffDeniedAudit
  | ExternalIdentityCreatedAudit
  | ExternalIdentityCreateFailedAudit
  | ProviderRevisionValidationFailedAudit
  | ProviderRevisionSelectedAudit
  | ProviderRevisionDeniedAudit
  | ProviderRevisionPersistFailedAudit
