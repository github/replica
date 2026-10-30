import type { Broadcast } from "../integrations/ws/types.ts"
import type { GitHubAuthenticationRoutesDependencies } from "./api/auth/github/types.ts"

export interface RouteDependencies {
  broadcast?: Broadcast
  githubAuthentication?: GitHubAuthenticationRoutesDependencies
}
