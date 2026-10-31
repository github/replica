import type { ProviderKey } from "../../../utils/parse-provider-key/index.ts"
import type {
  ExternalIdentityCreatedAudit,
  ExternalIdentityCreateFailedAudit,
  ProviderRevisionDeniedAudit,
  ProviderRevisionPersistFailedAudit,
  ProviderRevisionSelectedAudit,
  ProviderRevisionValidationFailedAudit,
} from "../create-security-audit/types.ts"

export type ParsedSecurityAuditEvent =
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
