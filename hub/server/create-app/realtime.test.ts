import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "."

describe("createApp()", () => {
  it("accepts a broadcast dependency without adding feature routes or changing health", async () => {
    const broadcast = vi.fn()
    const server = createServer(createApp({ broadcast }))

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo
      const health = await fetch(`http://127.0.0.1:${port}/api/health`)
      const missing = await fetch(`http://127.0.0.1:${port}/api/realtime`)

      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ status: "ok" })
      expect(missing.status).toBe(404)
      expect(broadcast).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
