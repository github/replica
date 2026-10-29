import type { IncomingMessage, Server } from "node:http"
import type { Logger } from "pino"

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type Broadcast = (channel: string, event: { type: string; payload: JsonValue }) => void

export interface RealtimeLimits {
  maxConnections: number
  maxConnectionsPerAddress: number
  maxTrackedAddresses: number
  maxUpgradeAttemptsPerMinute: number
  maxMessageBytes: number
  maxSubscriptionsPerConnection: number
  maxMessagesPerSecond: number
  maxBufferedBytes: number
  heartbeatIntervalMs: number
  upgradeTimeoutMs: number
  shutdownTimeoutMs: number
}

export interface RealtimeOptions<Identity> {
  server: Server
  path: string
  logger: Logger
  limits?: Partial<RealtimeLimits>
  authenticate?: (
    request: IncomingMessage,
    signal: AbortSignal,
  ) => Identity | null | Promise<Identity | null>
  authorizeSubscription?: (
    identity: Identity,
    channel: string,
    signal: AbortSignal,
  ) => boolean | Promise<boolean>
}

export interface RealtimeServer {
  broadcast: Broadcast
  close: () => Promise<void>
}
