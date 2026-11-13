import type { Logger } from "pino"

import type { Broadcast } from "../integrations/ws/types.ts"
import type { AuthenticationRouteDependencies } from "./api/auth/types.ts"
import type { CopilotConnectionRouteDependencies } from "./api/copilot-connection/types.ts"
import type { ProductRouteDependencies } from "./api/product/types.ts"

export interface RouteDependencies {
  authentication?: AuthenticationRouteDependencies
  copilotConnection?: CopilotConnectionRouteDependencies
  product?: ProductRouteDependencies
  broadcast?: Broadcast
  isReady?: () => Promise<boolean>
  logger?: Logger
}
