import { z } from "zod"

import type { RealtimeLimits } from "./types.ts"

export const CHANNEL_SCHEMA = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._/-]*$/)
export const MESSAGE_SCHEMA = z.strictObject({
  type: z.enum(["subscribe", "unsubscribe"]),
  channel: CHANNEL_SCHEMA,
})
export const EVENT_SCHEMA = z.strictObject({ type: z.string().min(1).max(100), payload: z.json() })

export const DEFAULT_LIMITS: Readonly<RealtimeLimits> = {
  maxConnections: 1000,
  maxConnectionsPerAddress: 50,
  maxTrackedAddresses: 4096,
  maxUpgradeAttemptsPerMinute: 60,
  maxMessageBytes: 16 * 1024,
  maxSubscriptionsPerConnection: 32,
  maxMessagesPerSecond: 20,
  maxBufferedBytes: 256 * 1024,
  heartbeatIntervalMs: 30_000,
  upgradeTimeoutMs: 5000,
  shutdownTimeoutMs: 5000,
}
