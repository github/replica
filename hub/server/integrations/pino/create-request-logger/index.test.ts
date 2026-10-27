import { once } from "node:events"
import { createServer, IncomingMessage, request } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createLogger } from "../create-logger"

import { createRequestLogger } from "."

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseRecord(line: string) {
  const value: unknown = JSON.parse(line)
  if (!isRecord(value)) throw new Error("Expected a JSON log object")
  return value
}

async function listen(app: express.Express) {
  const server = createServer(app)
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

describe("createRequestLogger()", () => {
  it("retains mounted route data after next without changing the request payload", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(parseRecord(line)) },
    })
    const app = express()
    app.use(createRequestLogger(logger))
    app.use(express.json())
    const router = express.Router({ mergeParams: true })
    router.post("/widgets/:password", (req, res, next) => {
      const body: unknown = req.body
      res.json({ params: req.params, query: req.query, body })
      next()
    })
    app.use("/teams/:teamId", router)
    const baseUrl = await listen(app)
    const body = { title: "Example", nested: [{ access_token: "body-secret" }] }

    const response = await fetch(
      `${baseUrl}/teams/design/widgets/param-secret?tag=one&tag=two&password=query-secret`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "untrusted-request-id",
          "x-private-header": "header-secret",
          authorization: "header-authorization-secret",
        },
        body: JSON.stringify(body),
      },
    )

    expect(await response.json()).toEqual({
      params: { teamId: "design", password: "param-secret" },
      query: { tag: ["one", "two"], password: "query-secret" },
      body,
    })
    await vi.waitFor(() => expect(records).toHaveLength(1))
    const reqId = response.headers.get("x-request-id")
    expect(reqId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(records[0]).toMatchObject({
      reqId,
      level: 30,
      method: "POST",
      route: "/widgets/:password",
      statusCode: 200,
      outcome: "completed",
      params: { teamId: "design", password: "[REDACTED]" },
      query: { tag: ["one", "two"], password: "[REDACTED]" },
      body: { title: "Example", nested: [{ access_token: "[REDACTED]" }] },
    })
    expect(records[0]).toHaveProperty("responseTime", expect.any(Number))
    expect(records[0]?.responseTime).toBeGreaterThanOrEqual(0)
    expect(records[0]).not.toHaveProperty("req")
    expect(records[0]).not.toHaveProperty("res")
    expect(records[0]).not.toHaveProperty("url")
    expect(JSON.stringify(records)).not.toMatch(
      /param-secret|query-secret|body-secret|header-secret|header-authorization-secret|untrusted-request-id/,
    )
  })

  it("logs a server error once at error level", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(parseRecord(line)) },
    })
    const app = express()
    app.use(createRequestLogger(logger))
    app.get("/status", (_req, res) => res.status(500).end())
    const baseUrl = await listen(app)

    const response = await fetch(`${baseUrl}/status`)
    await response.arrayBuffer()

    await vi.waitFor(() => expect(records).toHaveLength(1))
    expect(records[0]).toMatchObject({ level: 50, statusCode: 500, outcome: "completed" })
  })

  it("lets an endpoint omit all payload fields without suppressing completion metadata", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(parseRecord(line)) },
    })
    const app = express()
    app.use(createRequestLogger(logger))
    app.use(express.json())
    app.post("/private/:id", (_req, res) => {
      res.locals.omitLogPayload = true
      res.json({ private: "response-secret" })
    })
    const baseUrl = await listen(app)

    const response = await fetch(`${baseUrl}/private/param-secret?search=query-secret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "body-secret" }),
    })
    await response.arrayBuffer()

    await vi.waitFor(() => expect(records).toHaveLength(1))
    expect(records[0]).toMatchObject({
      method: "POST",
      route: "/private/:id",
      statusCode: 200,
      outcome: "completed",
    })
    for (const field of ["params", "query", "body", "req", "res"]) {
      expect(records[0]).not.toHaveProperty(field)
    }
    expect(JSON.stringify(records)).not.toMatch(
      /param-secret|query-secret|body-secret|response-secret/,
    )
  })

  it("does not log parsed binary uploads or response content", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(parseRecord(line)) },
    })
    const app = express()
    app.use(createRequestLogger(logger))
    app.use(express.raw({ type: "application/octet-stream" }))
    app.post("/upload", (req, res) => {
      expect(Buffer.isBuffer(req.body)).toBe(true)
      res.send("response-secret")
    })
    const baseUrl = await listen(app)

    const response = await fetch(`${baseUrl}/upload`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: "upload-secret",
    })
    await response.arrayBuffer()

    await vi.waitFor(() => expect(records).toHaveLength(1))
    expect(records[0]).not.toHaveProperty("body")
    expect(JSON.stringify(records)).not.toMatch(/upload-secret|response-secret/)
  })

  it("exposes a sanitized request logger correlated with the automatic record", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(parseRecord(line)) },
    })
    const app = express()
    app.use(createRequestLogger(logger))
    app.get("/work", (req, res) => {
      req.log.info({ nested: { password: "request-log-secret" } }, "Work started")
      res.end()
    })
    const baseUrl = await listen(app)

    const response = await fetch(`${baseUrl}/work`)
    await response.arrayBuffer()

    await vi.waitFor(() => expect(records).toHaveLength(2))
    expect(records.find((record) => record.msg === "Work started")).toMatchObject({
      reqId: response.headers.get("x-request-id"),
      nested: { password: "[REDACTED]" },
    })
    expect(records.filter((record) => record.outcome === "completed")).toHaveLength(1)
    expect(JSON.stringify(records)).not.toContain("request-log-secret")
  })

  it("emits one distinct error record when a streaming response is aborted", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(parseRecord(line)) },
    })
    const app = express()
    app.use(createRequestLogger(logger))
    app.get("/stream", (_req, res) => {
      res.write("private-stream-content")
    })
    const baseUrl = await listen(app)
    const client = request(`${baseUrl}/stream`)
    onTestFinished(() => {
      client.destroy()
    })
    client.end()
    const responseEvent: unknown[] = await once(client, "response")
    const response = responseEvent[0]
    if (!(response instanceof IncomingMessage)) throw new Error("Expected an HTTP response")
    await once(response, "data")

    response.destroy()
    client.destroy()

    await vi.waitFor(() => expect(records).toHaveLength(1))
    expect(records[0]).toMatchObject({
      level: 50,
      method: "GET",
      route: "/stream",
      statusCode: null,
      outcome: "aborted",
    })
    expect(records[0]).toHaveProperty("responseTime", expect.any(Number))
    expect(records[0]).not.toHaveProperty("err")
    expect(records[0]).not.toHaveProperty("req")
    expect(records[0]).not.toHaveProperty("res")
    expect(JSON.stringify(records)).not.toContain("private-stream-content")
  })
})
