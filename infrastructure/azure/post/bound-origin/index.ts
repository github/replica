import { parseHttpsOrigin } from "../../../installer/config/https-origin/index.ts"
import type { PostDeployment } from "../types.ts"

export function isBoundPostOrigin(value: unknown, deployment: PostDeployment): value is string {
  const origin = parseHttpsOrigin(value)
  if (!origin || origin.port) return false
  return [deployment.origin, ...deployment.customHosts.map((host) => `https://${host}`)].some(
    (bound) => URL.parse(bound)?.origin === origin.origin,
  )
}
