import type { IdentityService, IdentitySettings } from "#server/utils/identity-contracts/types"

export interface IdentityRoutes {
  service: IdentityService
  settings: IdentitySettings
}
