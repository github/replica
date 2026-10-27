import type {
  AuthenticationService,
  AuthenticationSettings,
} from "#server/domains/authentication/create-service/types"

export interface AuthenticationRoutes {
  service: AuthenticationService
  settings: AuthenticationSettings
}
