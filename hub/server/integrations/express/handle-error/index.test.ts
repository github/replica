import { once } from "node:events"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { handleError } from "."

describe("handleError()", () => {
  it.each([
    { name: "an unknown error", status: undefined, expectedStatus: 500 },
    { name: "an explicit server error", status: 503, expectedStatus: 503 },
    { name: "an invalid success status", status: 200, expectedStatus: 500 },
  ])("returns a generic JSON failure for $name", async ({ status, expectedStatus }) => {
    vi.stubEnv("NODE_ENV", "development")
    const app = express()
    const error = Object.assign(new Error("private-error-message"), { status })
    error.stack = "private-error-stack"
    app.get("/failure", () => {
      throw error
    })
    app.use(handleError)
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const server = app.listen(0, "127.0.0.1")
    onTestFinished(
      () =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections()
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    )
    await once(server, "listening")
    const { port } = server.address() as AddressInfo

    const response = await fetch(`http://127.0.0.1:${port}/failure`)

    expect(response.status).toBe(expectedStatus)
    expect(response.headers.get("content-type")).toMatch(/^application\/json\b/)
    expect(await response.json()).toEqual({ error: "Internal server error" })
    expect(stderr).not.toHaveBeenCalled()
  })

  it("closes a started response without reporting the raw error", async () => {
    vi.stubEnv("NODE_ENV", "development")
    let failResponse: (() => void) | undefined
    const failure = new Promise<void>((resolve) => {
      failResponse = resolve
    })
    const app = express()
    app.get("/stream", async (_request, response) => {
      response.write("safe-stream-content")
      await failure
      throw new Error("private-stream-error")
    })
    app.use(handleError)
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const server = app.listen(0, "127.0.0.1")
    onTestFinished(
      () =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections()
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    )
    await once(server, "listening")
    const { port } = server.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${port}/stream`)
    if (!response.body) throw new Error("Expected a streaming response")
    const reader = response.body.getReader()

    expect(response.status).toBe(200)
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe("safe-stream-content")
    if (!failResponse) throw new Error("Expected a response failure trigger")
    failResponse()

    await expect(reader.read()).rejects.toThrow()
    expect(stderr).not.toHaveBeenCalled()
  })
})
