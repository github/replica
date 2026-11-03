import type { Logger } from "pino"

import type { Broadcast } from "../integrations/ws/types.ts"
import type { AuthenticationRouteDependencies } from "./api/auth/types.ts"

export interface RouteDependencies {
  authentication?: AuthenticationRouteDependencies
  broadcast?: Broadcast
  isReady?: () => Promise<boolean>
  logger?: Logger
}
