import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"

import { createApp } from "."

describe("createApp()", () => {
  it("returns the health status as JSON", async () => {
    const server = createServer(createApp())

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo

      const response = await fetch(`http://127.0.0.1:${port}/api/health`)

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toMatch(/^application\/json\b/)
      expect(await response.json()).toEqual({ status: "ok" })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("returns a JSON not-found error for an unknown API route", async () => {
    const server = createServer(createApp())

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo

      const response = await fetch(`http://127.0.0.1:${port}/api/not-a-route`)

      expect(response.status).toBe(404)
      expect(response.headers.get("content-type")).toMatch(/^application\/json\b/)
      expect(await response.json()).toEqual({ error: "Not found" })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it.each([
    { method: "GET", path: "/repositories" },
    { method: "POST", path: "/auth/github" },
  ])("does not port the former $method $path endpoint", async ({ method, path }) => {
    const server = createServer(createApp())

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo

      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        redirect: "manual",
      })

      expect(response.status).toBe(404)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
