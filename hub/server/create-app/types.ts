import type { Logger } from "pino"

import type { Broadcast } from "../integrations/ws/types.ts"
import type { GitHubAuthenticationRoutesDependencies } from "../routes/api/auth/github/types.ts"

export interface CreateAppOptions {
  broadcast?: Broadcast
  githubAuthentication?: GitHubAuthenticationRoutesDependencies
  logger?: Logger
  trustedProxyHops?: number
}
