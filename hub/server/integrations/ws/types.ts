import type { IncomingMessage, Server } from "node:http"
import type { Duplex } from "node:stream"
import type { Logger } from "pino"
import type { WebSocket, WebSocketServer } from "ws"

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

export interface AddressState {
  connections: number
  attempts: number
  windowEndsAt: number
}

export interface Connection {
  id: string
  subscriptions: Set<string>
  alive: boolean
  busy: boolean
  messages: number
  windowEndsAt: number
  check?: AbortController
}

export interface RealtimeState {
  logger: Logger
  limits: RealtimeLimits
  wss: WebSocketServer
  connections: Map<WebSocket, Connection>
  channels: Map<string, Set<WebSocket>>
  addresses: Map<string, AddressState>
  pending: Map<Duplex, () => void>
  rejectedUpgrades: Map<number, number>
  reserved: number
  accessChecks: number
  closing: boolean
  closePromise?: Promise<void>
}

export type UpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void
