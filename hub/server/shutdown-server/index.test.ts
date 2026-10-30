import { Server } from "node:http"
import { describe, expect, it, vi } from "vitest"

import type { RealtimeServer } from "../integrations/ws/types"

import { shutdownServer } from "."

describe("shutdownServer()", () => {
  it.each(["HTTP", "realtime"])(
    "waits for both cleanup operations before rejecting a safe error after %s fails",
    async (failingService) => {
      const server = new Server()
      vi.spyOn(server, "listening", "get").mockReturnValue(true)
      const http: { finish(error?: Error): void } = { finish() {} }
      const closeHttp = vi.spyOn(server, "close").mockImplementation((callback) => {
        if (callback) http.finish = callback
        return server
      })
      const websocket: { finish(): void; fail(error: Error): void } = {
        finish() {},
        fail() {},
      }
      const realtime: RealtimeServer = {
        broadcast: vi.fn(),
        close: vi.fn(
          () =>
            new Promise<void>((resolve, reject) => {
              websocket.finish = resolve
              websocket.fail = reject
            }),
        ),
      }
      const shuttingDown = shutdownServer(server, realtime)
      void shuttingDown.catch(() => {})
      let settled = false
      void shuttingDown.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      const failure = new Error("secret-transport-error https://private.example")
      await Promise.resolve()

      try {
        expect(closeHttp).toHaveBeenCalledTimes(1)
        expect(realtime.close).toHaveBeenCalledTimes(1)
        if (failingService === "HTTP") http.finish(failure)
        else websocket.fail(failure)
        await new Promise<void>((resolve) => setImmediate(resolve))

        expect(settled).toBe(false)
      } finally {
        if (failingService === "HTTP") websocket.finish()
        else http.finish()
      }

      await expect(shuttingDown).rejects.toBeInstanceOf(Error)
      await expect(shuttingDown).rejects.not.toThrow(/secret|https:|private\.example/)
    },
  )
})
