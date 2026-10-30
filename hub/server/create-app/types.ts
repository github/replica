import type { Logger } from "pino"

import type { Broadcast } from "../integrations/ws/types.ts"

export interface CreateAppOptions {
  logger?: Logger
  broadcast?: Broadcast
}
