import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"

import { pruneAddresses } from "../prune-addresses/index.ts"
import { registerConnection } from "../register-connection/index.ts"
import { rejectUpgrade } from "../reject-upgrade/index.ts"
import type { RealtimeOptions, RealtimeState } from "../types.ts"

export async function upgradeConnection<Identity>(
  state: RealtimeState,
  { path, authenticate, authorizeSubscription }: RealtimeOptions<Identity>,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) {
  const { logger, limits } = state
  function socketError() {
    logger.warn({}, "WebSocket transport failed")
    socket.destroy()
  }
  socket.on("error", socketError)
  socket.once("close", () => socket.off("error", socketError))
  if (request.url?.split("?")[0] !== path) {
    rejectUpgrade(state, socket, 404)
    return
  }
  if (state.closing) {
    rejectUpgrade(state, socket, 503)
    return
  }

  // Use the peer address, never an untrusted forwarded header.
  const address = request.socket.remoteAddress
  if (!address) {
    rejectUpgrade(state, socket, 400)
    return
  }
  let addressState = state.addresses.get(address)
  const now = Date.now()
  if (!addressState) {
    if (state.addresses.size >= limits.maxTrackedAddresses) pruneAddresses(state)
    if (state.addresses.size >= limits.maxTrackedAddresses) {
      rejectUpgrade(state, socket, 503)
      return
    }
    addressState = { connections: 0, attempts: 0, windowEndsAt: now + 60_000 }
    state.addresses.set(address, addressState)
  }
  if (addressState.windowEndsAt <= now) {
    addressState.attempts = 0
    addressState.windowEndsAt = now + 60_000
  }
  addressState.attempts += 1
  if (
    addressState.attempts > limits.maxUpgradeAttemptsPerMinute ||
    addressState.connections >= limits.maxConnectionsPerAddress
  ) {
    rejectUpgrade(state, socket, 429)
    return
  }
  if (state.reserved >= limits.maxConnections || state.accessChecks >= limits.maxConnections) {
    rejectUpgrade(state, socket, 503)
    return
  }
  if (!authenticate || !authorizeSubscription) {
    rejectUpgrade(state, socket, 403)
    return
  }

  state.reserved += 1
  addressState.connections += 1
  const reservation = addressState
  let released = false
  let completed = false
  const controller = new AbortController()
  function release() {
    if (released) return
    released = true
    state.reserved -= 1
    reservation.connections -= 1
  }
  function cancel() {
    if (completed) return
    completed = true
    clearTimeout(timeout)
    state.pending.delete(socket)
    controller.abort()
    release()
  }
  const timeout = setTimeout(() => {
    cancel()
    rejectUpgrade(state, socket, 408)
  }, limits.upgradeTimeoutMs)
  timeout.unref()
  state.pending.set(socket, () => {
    cancel()
    socket.destroy()
  })
  socket.once("close", cancel)

  state.accessChecks += 1
  try {
    const identity = await authenticate(request, controller.signal)
    if (completed || socket.destroyed || state.closing) return
    if (identity === null || identity === undefined) {
      cancel()
      rejectUpgrade(state, socket, 401)
      return
    }
    state.wss.handleUpgrade(request, socket, head, (client) => {
      completed = true
      clearTimeout(timeout)
      state.pending.delete(socket)
      socket.off("close", cancel)
      socket.off("error", socketError)
      registerConnection(state, client, identity, authorizeSubscription, release)
    })
  } catch {
    if (completed || socket.destroyed) return
    cancel()
    logger.error({}, "WebSocket admission failed")
    rejectUpgrade(state, socket, 500)
  } finally {
    state.accessChecks -= 1
  }
}
