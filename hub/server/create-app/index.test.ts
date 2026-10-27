import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createLogger } from "../integrations/pino/create-logger"

import { createApp } from "."

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseRecord(line: string) {
  const value: unknown = JSON.parse(line)
  if (!isRecord(value)) throw new Error("Expected a JSON log object")
  return value
}

describe("createApp()", () => {
  it("automatically logs health and not-found responses with the injected logger", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(parseRecord(line)) },
    })
    const server = createServer(createApp({ logger }))

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo

      const headers = { "x-request-id": "untrusted-request-id" }
      const health = await fetch(`http://127.0.0.1:${port}/api/health`, { headers })
      expect(health.status).toBe(200)
      expect(health.headers.get("content-type")).toMatch(/^application\/json\b/)
      expect(await health.json()).toEqual({ status: "ok" })
      const missing = await fetch(
        `http://127.0.0.1:${port}/api/missing-private-path?token=query-secret`,
        { headers },
      )
      expect(missing.status).toBe(404)
      expect(missing.headers.get("content-type")).toMatch(/^application\/json\b/)
      expect(await missing.json()).toEqual({ error: "Not found" })
      expect(health.headers.get("x-request-id")).not.toBe(missing.headers.get("x-request-id"))

      await vi.waitFor(() => expect(records).toHaveLength(2))
      expect(records[0]).toMatchObject({
        reqId: health.headers.get("x-request-id"),
        method: "GET",
        route: "/api/health",
        statusCode: 200,
        level: 30,
        outcome: "completed",
      })
      expect(records[1]).toMatchObject({
        reqId: missing.headers.get("x-request-id"),
        route: null,
        statusCode: 404,
        level: 40,
        outcome: "completed",
      })
      expect(JSON.stringify(records)).not.toMatch(
        /missing-private-path|query-secret|untrusted-request-id/,
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it.each([
    { name: "malformed", body: '{"password":"malformed-body-secret"', statusCode: 400 },
    { name: "oversized", body: JSON.stringify({ text: "x".repeat(1024 * 1024) }), statusCode: 413 },
  ])("logs $name JSON safely before routing", async ({ body, statusCode }) => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(parseRecord(line)) },
    })
    const server = createServer(createApp({ logger }))
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo

      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      })

      expect(response.status).toBe(statusCode)
      expect(response.headers.get("content-type")).toMatch(/^application\/json\b/)
      expect(await response.json()).toEqual({ error: "Invalid request" })
      await vi.waitFor(() => expect(records).toHaveLength(1))
      expect(records[0]).toMatchObject({
        reqId: response.headers.get("x-request-id"),
        statusCode,
        level: 40,
        outcome: "completed",
      })
      expect(records[0]).not.toHaveProperty("body")
      expect(records[0]).not.toHaveProperty("err")
      expect(records[0]).not.toHaveProperty("req")
      expect(records[0]).not.toHaveProperty("res")
      expect(JSON.stringify(records)).not.toContain("malformed-body-secret")
      expect(stderr).not.toHaveBeenCalled()
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
