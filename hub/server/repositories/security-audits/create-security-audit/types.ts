import type { Prisma } from "../../../generated/prisma/client.ts"

export interface CreateSecurityAuditDatabase {
  securityAudit: {
    create(input: { data: Prisma.SecurityAuditCreateInput }): Promise<unknown>
  }
}

interface SecurityAuditEvent {
  id: string
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
  | ExternalIdentityCreatedAudit
  | ExternalIdentityCreateFailedAudit
  | ProviderRevisionSelectedAudit
  | ProviderRevisionDeniedAudit
  | ProviderRevisionPersistFailedAudit
