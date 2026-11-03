import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { describe, expect, it, onTestFinished, vi } from "vitest"

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
  it("serves built assets and HTML navigation without masking missing API routes or assets", async () => {
    const clientDirectory = join(process.cwd(), `runtime-client-test-${randomUUID()}`)
    await mkdir(join(clientDirectory, "assets"), { recursive: true })
    onTestFinished(() => rm(clientDirectory, { recursive: true, force: true }))
    const html = "<!doctype html><title>Built Hub</title>"
    await writeFile(join(clientDirectory, "index.html"), html)
    await writeFile(join(clientDirectory, "assets", "app.js"), "export const built = true")
    const server = createServer(
      createApp({ clientDirectory, logger: createLogger({ level: "silent" }) }),
    )

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo
      const base = `http://127.0.0.1:${port}`
      const navigation = await fetch(`${base}/projects/example`, {
        headers: { accept: "text/html" },
      })
      expect(navigation.status).toBe(200)
      expect(navigation.headers.get("content-type")).toMatch(/^text\/html\b/)
      expect(await navigation.text()).toBe(html)
      const head = await fetch(`${base}/projects/example`, {
        method: "HEAD",
        headers: { accept: "text/html" },
      })
      expect(head.status).toBe(200)
      expect(head.headers.get("content-type")).toMatch(/^text\/html\b/)
      expect(await head.text()).toBe("")
      const asset = await fetch(`${base}/assets/app.js`)
      expect(asset.status).toBe(200)
      expect(await asset.text()).toBe("export const built = true")

      for (const { path, method, accept } of [
        { path: "/api/missing", method: "GET", accept: "text/html" },
        { path: "/assets/missing.js", method: "GET", accept: "text/html" },
        { path: "/projects/example", method: "POST", accept: "text/html" },
        { path: "/projects/example", method: "GET", accept: "application/json" },
        { path: "/projects/example", method: "GET", accept: "*/*" },
      ]) {
        const missing = await fetch(`${base}${path}`, { method, headers: { accept } })
        expect.soft(missing.status, `${method} ${path} accepting ${accept}`).toBe(404)
        expect.soft(missing.headers.get("content-type")).toMatch(/^application\/json\b/)
        if (missing.status === 404) {
          expect(await missing.json()).toEqual({ error: "Not found" })
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("reports unavailable dependencies safely without making process health fail", async () => {
    const isReady = vi.fn<() => Promise<boolean>>().mockResolvedValue(false)
    const server = createServer(createApp({ isReady, logger: createLogger({ level: "silent" }) }))

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo
      const base = `http://127.0.0.1:${port}`
      const unavailable = await fetch(`${base}/api/ready`)
      expect(unavailable.status).toBe(503)
      const health = await fetch(`${base}/api/health`)
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ status: "ok" })

      isReady.mockResolvedValue(true)
      expect((await fetch(`${base}/api/ready`)).status).toBe(200)
      isReady.mockRejectedValue(new Error("postgresql://test:private-readiness-marker@localhost"))
      const failed = await fetch(`${base}/api/ready`)
      expect(failed.status).toBe(503)
      expect(await failed.text()).not.toContain("private-readiness-marker")
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("accepts a broadcast dependency without changing HTTP routes", async () => {
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

  it("does not accept authentication proof from a public callback route", async () => {
    const server = createServer(createApp())
    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/github/callback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          externalIdentityId: randomUUID(),
          providerKey: "github",
          subject: "123",
        }),
      })

      expect(response.status).toBe(404)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
