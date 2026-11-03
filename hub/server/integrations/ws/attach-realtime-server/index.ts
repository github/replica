import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { WebSocketServer } from "ws"

import { broadcast } from "../broadcast/index.ts"
import { checkConnections } from "../check-connections/index.ts"
import { closeRealtimeServer } from "../close-realtime-server/index.ts"
import { DEFAULT_LIMITS } from "../constants.ts"
import type { RealtimeOptions, RealtimeServer, RealtimeState } from "../types.ts"
import { upgradeConnection } from "../upgrade-connection/index.ts"

/** Own only local connections; application callbacks decide who may connect and subscribe. */
export function attachRealtimeServer<Identity>({
  ...options
}: RealtimeOptions<Identity>): RealtimeServer {
  const { server, path, limits: overrides } = options
  if (!/^\/[^?#]*$/.test(path)) throw new Error("WebSocket path must be an absolute URL path.")
  const limits = { ...DEFAULT_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(
        `WebSocket limit ${name} must be a positive integer no greater than 2147483647.`,
      )
    }
  }

  const state: RealtimeState = {
    logger: options.logger,
    limits,
    wss: new WebSocketServer({
      noServer: true,
      maxPayload: limits.maxMessageBytes,
      maxFragments: 128,
      maxBufferedChunks: 128,
      perMessageDeflate: false,
      autoPong: false,
    }),
    connections: new Map(),
    channels: new Map(),
    addresses: new Map(),
    pending: new Map(),
    rejectedUpgrades: new Map(),
    reserved: 0,
    accessChecks: 0,
    closing: false,
  }
  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    void upgradeConnection(state, options, request, socket, head)
  }
  const heartbeat = setInterval(() => checkConnections(state), limits.heartbeatIntervalMs)
  heartbeat.unref()
  server.on("upgrade", upgrade)
  state.wss.on("error", () => state.logger.error({}, "WebSocket server failed"))

  return {
    broadcast: (channel, event) => broadcast(state, channel, event),
    close: () => closeRealtimeServer(state, server, upgrade, heartbeat),
  }
}
