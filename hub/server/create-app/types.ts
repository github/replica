import type { Logger } from "pino"

import type { Broadcast } from "../integrations/ws/types.ts"

export interface CreateAppOptions {
  broadcast?: Broadcast
  logger?: Logger
  clientDirectory?: string
  isReady?: () => Promise<boolean>
}
