import type { ProviderKey } from "../../../utils/parse-provider-key/types.ts"
import type {
  AuthenticationAttemptDeniedAudit,
  AdmissionDeniedAudit,
  AdmissionFailedAudit,
  BootstrapAttemptDeniedAudit,
  ExternalIdentityCreatedAudit,
  ExternalIdentityCreateFailedAudit,
  ProviderRevisionDeniedAudit,
  ProviderRevisionPersistFailedAudit,
  ProviderRevisionSelectedAudit,
  ProviderRevisionValidationFailedAudit,
  AuthenticationProviderLifecycleAudit,
  AuthenticationProvidersReconcileFailedAudit,
  SessionRevocationAdvancedAudit,
  MembershipAssignmentCreatedAudit,
  MembershipAssignmentRestoredAudit,
  MembershipCreatedAudit,
  MembershipRestoredAudit,
  ProviderMembershipAssignmentAudit,
  AdministratorMembershipAssignmentAudit,
  AdministratorManagementDeniedAudit,
  AdministratorManagementFailedAudit,
  AdministratorAuthorizationAudit,
  SessionCreatedAudit,
  SessionEndedAudit,
} from "../create-security-audit/types.ts"

export type ParsedSecurityAuditEvent =
  | (Omit<AuthenticationAttemptDeniedAudit, "provider"> & { provider: ProviderKey })
  | AdmissionDeniedAudit
  | AdmissionFailedAudit
  | BootstrapAttemptDeniedAudit
  | MembershipAssignmentCreatedAudit
  | MembershipAssignmentRestoredAudit
  | MembershipCreatedAudit
  | MembershipRestoredAudit
  | ProviderMembershipAssignmentAudit
  | AdministratorMembershipAssignmentAudit
  | AdministratorManagementDeniedAudit
  | AdministratorManagementFailedAudit
  | AdministratorAuthorizationAudit
  | SessionCreatedAudit
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
  | (Omit<AuthenticationProviderLifecycleAudit, "providerKey"> & {
      providerKey: ProviderKey
    })
  | (Omit<AuthenticationProvidersReconcileFailedAudit, "providerKeys"> & {
      providerKeys: ProviderKey[]
    })
  | SessionRevocationAdvancedAudit
