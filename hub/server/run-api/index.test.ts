import { once } from "node:events"
import type * as Http from "node:http"
import { createServer, request, Server } from "node:http"
import type { IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"
import WebSocket from "ws"

import { deferred } from "../../test/ws/deferred"
import { rejected } from "../../test/ws/rejected"
import { createApp } from "../create-app"
import { createLogger } from "../integrations/pino/create-logger"
import { attachRealtimeServer } from "../integrations/ws/attach-realtime-server"
import type * as RealtimeModule from "../integrations/ws/attach-realtime-server"
import type { RealtimeServer } from "../integrations/ws/types"

vi.mock("../create-app", { spy: true })
vi.mock("../integrations/ws/attach-realtime-server", { spy: true })

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof Http>()
  return { ...actual, createServer: vi.fn(actual.createServer) }
})

async function startApi(options: { port: number; shutdownTimeoutMs?: number }) {
  const { runApi } = await import(".")
  const logger = createLogger({ level: "silent" })
  const readiness = vi.spyOn(logger, "info")
  const signals = {
    SIGINT: process.listeners("SIGINT"),
    SIGTERM: process.listeners("SIGTERM"),
  }
  const running = runApi({ ...options, logger })
  void running.catch(() => {})
  const server = vi.mocked(createServer).mock.results.at(-1)?.value as Server

  function signal(name: "SIGINT" | "SIGTERM") {
    const handler = process.listeners(name).find((listener) => !signals[name].includes(listener))
    if (handler) Reflect.apply(handler, process, [name])
  }

  onTestFinished(async () => {
    signal("SIGTERM")
    server.closeAllConnections()
    await running.catch(() => {})
    if (server.listening) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  })

  return { server, running, signal, signals, readiness }
}

describe("runApi()", () => {
  it("attaches realtime to the HTTP server, injects broadcast, and forbids upgrades without access policies", async () => {
    const { server, running, signal } = await startApi({ port: 0 })
    await once(server, "listening")
    const { port } = server.address() as AddressInfo
    const options = vi.mocked(attachRealtimeServer).mock.calls.at(-1)?.[0]
    const realtime = vi.mocked(attachRealtimeServer).mock.results.at(-1)?.value as RealtimeServer
    expect(options).toMatchObject({ server, path: "/api/realtime" })
    expect(options?.authenticate).toBeUndefined()
    expect(options?.authorizeSubscription).toBeUndefined()
    expect(createApp).toHaveBeenCalledWith(
      expect.objectContaining({ broadcast: realtime.broadcast }),
    )
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/realtime`)
    socket.on("error", () => {})
    onTestFinished(() => {
      socket.terminate()
    })

    expect(await rejected(socket)).toBe(403)
    signal("SIGTERM")
    await running

    expect(server.listenerCount("upgrade")).toBe(0)
  })

  it("stops upgrades and waits for realtime cleanup before resolving", async () => {
    const finished = deferred<void>()
    const { attachRealtimeServer: attach } = await vi.importActual<typeof RealtimeModule>(
      "../integrations/ws/attach-realtime-server",
    )
    const close = vi.fn<RealtimeServer["close"]>()
    vi.mocked(attachRealtimeServer).mockImplementationOnce((options) => {
      const realtime = attach(options)
      close.mockImplementation(async () => {
        await realtime.close()
        await finished.promise
      })
      return { broadcast: realtime.broadcast, close }
    })
    const { server, running, signal } = await startApi({ port: 0 })
    await once(server, "listening")
    let settled = false
    void running.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    try {
      signal("SIGTERM")
      await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(settled).toBe(false)
      expect(server.listenerCount("upgrade")).toBe(0)
      expect(server.listening).toBe(false)
    } finally {
      finished.resolve()
      await running
    }

    expect(settled).toBe(true)
  })

  it.each(["SIGINT", "SIGTERM"] as const)(
    "serves health and drains an active request before resolving on %s",
    async (signalName) => {
      const { server, running, signal, signals, readiness } = await startApi({ port: 0 })
      await once(server, "listening")
      const { port, address } = server.address() as AddressInfo
      expect(address).toBe("127.0.0.1")
      expect(readiness).toHaveBeenCalledWith(
        expect.objectContaining({ host: "127.0.0.1", port }),
        expect.any(String),
      )
      const health = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { connection: "close" },
      })
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ status: "ok" })

      const incoming = once(server, "request")
      const client = request({
        host: "127.0.0.1",
        port,
        path: "/api/health",
        method: "POST",
        headers: {
          connection: "close",
          "content-type": "application/json",
          "content-length": 2,
        },
      })
      client.on("error", () => {})
      onTestFinished(() => {
        client.destroy()
      })
      const response = new Promise<IncomingMessage>((resolve, reject) => {
        client.once("response", resolve)
        client.once("error", reject)
      })
      void response.catch(() => {})
      client.write("{")
      await incoming
      let settled = false
      void running.then(() => {
        settled = true
      })

      signal(signalName)
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      client.end("}")
      const received = await response
      expect(received.statusCode).toBe(404)
      received.resume()
      await once(received, "end")
      await running

      expect(settled).toBe(true)
      expect(server.listening).toBe(false)
      expect(process.listeners("SIGINT")).toEqual(signals.SIGINT)
      expect(process.listeners("SIGTERM")).toEqual(signals.SIGTERM)
    },
  )

  it("rejects bind failure and removes its signal listeners", async () => {
    const occupied = createServer()
    onTestFinished(
      () =>
        new Promise<void>((resolve) => {
          occupied.close(() => resolve())
        }),
    )
    occupied.listen(0, "127.0.0.1")
    await once(occupied, "listening")
    const { port } = occupied.address() as AddressInfo
    const { running, server, signals } = await startApi({ port })

    await expect(running).rejects.toMatchObject({ code: "EADDRINUSE" })

    expect(server.listening).toBe(false)
    expect(server.listenerCount("upgrade")).toBe(0)
    expect(process.listeners("SIGINT")).toEqual(signals.SIGINT)
    expect(process.listeners("SIGTERM")).toEqual(signals.SIGTERM)
  })

  it("bounds draining, rejects the timeout, and closes unfinished connections", async () => {
    const { running, server, signal, signals } = await startApi({
      port: 0,
      shutdownTimeoutMs: 30,
    })
    await once(server, "listening")
    const { port } = server.address() as AddressInfo
    const incoming = once(server, "request")
    const client = request({
      host: "127.0.0.1",
      port,
      path: "/api/health",
      method: "POST",
      headers: { connection: "close", "content-type": "application/json", "content-length": 2 },
    })
    client.on("error", () => {})
    onTestFinished(() => {
      client.destroy()
    })
    const disconnected = new Promise<void>((resolve) => {
      client.once("close", () => resolve())
    })
    const serverClosed = once(server, "close")
    client.write("{")
    await incoming

    signal("SIGTERM")
    await expect(running).rejects.toThrow(/shutdown|deadline|timeout/i)
    await Promise.all([disconnected, serverClosed])

    expect(server.listening).toBe(false)
    expect(process.listeners("SIGINT")).toEqual(signals.SIGINT)
    expect(process.listeners("SIGTERM")).toEqual(signals.SIGTERM)
  })

  it("does not leave a server listening when a signal arrives before binding completes", async () => {
    const server = new Server()
    let listening = false
    vi.spyOn(server, "listening", "get").mockImplementation(() => listening)
    const listen = vi.spyOn(server, "listen").mockImplementation(() => server)
    const close = vi.spyOn(server, "close").mockImplementation((callback) => {
      listening = false
      queueMicrotask(() => {
        server.emit("close")
        callback?.()
      })
      return server
    })
    vi.mocked(createServer).mockReturnValueOnce(server)
    const { running, signal, signals } = await startApi({ port: 0 })
    let settled = false
    void running.then(() => {
      settled = true
    })

    signal("SIGINT")
    await new Promise<void>((resolve) => setImmediate(resolve))
    const returnedWithoutCancelling = settled && close.mock.calls.length === 0
    if (close.mock.calls.length === 0) {
      listening = true
      server.emit("listening")
      const callback: unknown = listen.mock.calls[0]?.find(
        (argument) => typeof argument === "function",
      )
      if (typeof callback === "function") Reflect.apply(callback, server, [])
    }
    await running

    expect(returnedWithoutCancelling).toBe(false)
    expect(server.listening).toBe(false)
    expect(process.listeners("SIGINT")).toEqual(signals.SIGINT)
    expect(process.listeners("SIGTERM")).toEqual(signals.SIGTERM)
  })
})
