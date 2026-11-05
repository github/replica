import type { Logger } from "pino"

import type { RouteDependencies } from "../routes/types.ts"

export interface CreateAppOptions extends RouteDependencies {
  logger?: Logger
  clientDirectory?: string
  isReady?: () => Promise<boolean>
  trustedProxyHops?: number
}
