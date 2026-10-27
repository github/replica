import type {
  AuthenticationService,
  AuthenticationSettings,
} from "#server/domains/authentication/create-service/types"
import type { AdministrationService } from "#server/domains/administration/create-service/types"

export interface AuthenticationRoutes {
  service: AuthenticationService
  administration: AdministrationService
  settings: AuthenticationSettings
}
