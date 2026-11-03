import type { Logger } from "pino"

import type { Broadcast } from "../integrations/ws/types.ts"

export interface RouteDependencies {
  broadcast?: Broadcast
  isReady?: () => Promise<boolean>
  logger?: Logger
}
