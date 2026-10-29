import { randomUUID } from "node:crypto"
import type { WebSocket } from "ws"

import { canSend } from "../can-send/index.ts"
import { countMessage } from "../count-message/index.ts"
import { disconnect } from "../disconnect/index.ts"
import { handleMessage } from "../handle-message/index.ts"
import { removeSubscription } from "../remove-subscription/index.ts"
import type { Connection, RealtimeOptions, RealtimeState } from "../types.ts"

export function registerConnection<Identity>(
  state: RealtimeState,
  client: WebSocket,
  identity: Identity,
  authorizeSubscription: RealtimeOptions<Identity>["authorizeSubscription"],
  release: () => void,
) {
  const connection: Connection = {
    id: randomUUID(),
    subscriptions: new Set(),
    alive: true,
    busy: false,
    messages: 0,
    windowEndsAt: Date.now() + 1000,
  }
  state.connections.set(client, connection)
  state.logger.info(
    { connectionId: connection.id, activeConnections: state.connections.size },
    "WebSocket connected",
  )
  client.on("pong", () => {
    if (countMessage(state, client, connection)) connection.alive = true
  })
  client.on("ping", (data) => {
    if (
      !countMessage(state, client, connection) ||
      !canSend(state, client, connection, data.length + 2)
    ) {
      return
    }
    client.pong(data, false, (error) => {
      if (error) disconnect(state, client, connection, "send_failed")
    })
  })
  client.on("message", (data, isBinary) => {
    const buffer = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data)
    void handleMessage(state, client, connection, identity, buffer, isBinary, authorizeSubscription)
  })
  client.on("error", () => disconnect(state, client, connection, "transport_failed"))
  client.once("close", () => {
    connection.check?.abort()
    for (const channel of connection.subscriptions) {
      removeSubscription(state, client, connection, channel)
    }
    state.connections.delete(client)
    release()
    state.logger.info(
      { connectionId: connection.id, activeConnections: state.connections.size },
      "WebSocket disconnected",
    )
  })
}
