import type { Logger } from "pino"

import type { Broadcast } from "../integrations/ws/types.ts"
import type { AuthenticationRouteRuntime } from "../routes/api/authentication/types.ts"

export interface CreateAppOptions {
  authentication?: AuthenticationRouteRuntime
  broadcast?: Broadcast
  logger?: Logger
  clientDirectory?: string
  isReady?: () => Promise<boolean>
  trustedProxyHops?: number
}
