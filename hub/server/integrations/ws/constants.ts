import type { RealtimeLimits } from "./types.ts"

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
