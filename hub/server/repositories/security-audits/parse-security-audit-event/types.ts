import type { ProviderKey } from "../../../utils/parse-provider-key/types.ts"
import type {
  AuthenticationAttemptDeniedAudit,
  AdmissionDeniedAudit,
  BootstrapAttemptDeniedAudit,
  ExternalIdentityCreatedAudit,
  ExternalIdentityCreateFailedAudit,
  ProviderRevisionDeniedAudit,
  ProviderRevisionPersistFailedAudit,
  ProviderRevisionSelectedAudit,
  ProviderRevisionValidationFailedAudit,
  MembershipAssignmentCreatedAudit,
  MembershipAssignmentRestoredAudit,
  SessionCreatedAudit,
  SessionEndedAudit,
  SessionRestoredAudit,
} from "../create-security-audit/types.ts"

export type ParsedSecurityAuditEvent =
  | (Omit<AuthenticationAttemptDeniedAudit, "provider"> & { provider: ProviderKey })
  | AdmissionDeniedAudit
  | BootstrapAttemptDeniedAudit
  | MembershipAssignmentCreatedAudit
  | MembershipAssignmentRestoredAudit
  | SessionCreatedAudit
  | SessionRestoredAudit
  | SessionEndedAudit
  | (Omit<ExternalIdentityCreatedAudit, "provider"> & { provider: ProviderKey })
  | (Omit<ExternalIdentityCreateFailedAudit, "provider"> & { provider: ProviderKey })
  | (Omit<ProviderRevisionValidationFailedAudit, "providerKey"> & {
      providerKey: ProviderKey
    })
  | (Omit<ProviderRevisionSelectedAudit, "providerKey"> & { providerKey: ProviderKey })
  | (Omit<ProviderRevisionDeniedAudit, "providerKey"> & { providerKey: ProviderKey })
  | (Omit<ProviderRevisionPersistFailedAudit, "providerKey"> & {
      providerKey: ProviderKey
    })
