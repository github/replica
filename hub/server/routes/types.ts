import type {
  AuthenticationService,
  AuthenticationSettings,
} from "#server/domains/authentication/create-service/types"
import type { AdministrationService } from "#server/domains/administration/create-service/types"
import type { PrototypeAuthorizationService } from "#server/domains/prototype-authorization/create-service/types"
import type { GitHubAuthorizationService } from "#server/domains/github-authorization/create-service/types"

export interface AuthenticationRoutes {
  service: AuthenticationService
  administration: AdministrationService
  prototypeAuthorization: PrototypeAuthorizationService
  githubAuthorization?: GitHubAuthorizationService
  settings: AuthenticationSettings
}
