import type { RealtimeState } from "../types.ts"

export function reportRejections({ logger, rejectedUpgrades }: RealtimeState) {
  for (const [statusCode, count] of rejectedUpgrades) {
    if (count > 1) {
      logger.warn({ statusCode, count: count - 1 }, "Additional WebSocket upgrades rejected")
    }
  }
  rejectedUpgrades.clear()
}
