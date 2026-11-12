import { createHash, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app"
import { CopilotConnectionError } from "../../../domains/copilot-connection/errors"
import type { CopilotConnectionRouteDependencies } from "./types"

const applicationOrigin = "http://127.0.0.1:5173"
const sessionValue = "current-session"

function dependencies(): CopilotConnectionRouteDependencies {
  return {
    applicationOrigin,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    findSession: vi.fn().mockResolvedValue({ membershipId: randomUUID() }),
    status: vi.fn().mockResolvedValue({
      configured: true,
      connected: false,
      savedConnection: false,
      connectedBy: null,
      refusedAt: null,
      verifiedAt: null,
    }),
  }
}

async function withServer(
  copilotConnection: CopilotConnectionRouteDependencies,
  operation: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(createApp({ copilotConnection }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

function mutationHeaders() {
  return {
    "content-type": "application/json",
    cookie: `hub_session=${sessionValue}`,
    origin: applicationOrigin,
  }
}

describe("copilotConnectionRoutes()", () => {
  it("reports saved connection presence separately from active connected state", async () => {
    const copilotConnection = dependencies()
    vi.mocked(copilotConnection.status).mockResolvedValueOnce({
      configured: true,
      connected: false,
      savedConnection: true,
      connectedBy: null,
      refusedAt: new Date("2026-11-11T13:00:00.000Z"),
      verifiedAt: null,
    })

    await withServer(copilotConnection, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/copilot-connection`, {
        headers: { cookie: `hub_session=${sessionValue}` },
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        configured: true,
        connected: false,
        savedConnection: true,
        connectedBy: null,
        refusedAt: "2026-11-11T13:00:00.000Z",
        verifiedAt: null,
      })
    })
  })

  it.each([
    ["connect", "POST", "/api/copilot-connection/connect"],
    ["disconnect", "DELETE", "/api/copilot-connection"],
  ] as const)("requires a live administrator session before %s", async (_name, method, path) => {
    const copilotConnection = dependencies()
    vi.mocked(copilotConnection.findSession).mockResolvedValueOnce(null)

    await withServer(copilotConnection, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: mutationHeaders(),
        body: JSON.stringify({ confirmed: true }),
      })

      expect(response.status).toBe(403)
      expect(copilotConnection.findSession).toHaveBeenCalledWith(
        createHash("sha256").update(sessionValue).digest("hex"),
      )
      expect(copilotConnection.connect).not.toHaveBeenCalled()
      expect(copilotConnection.disconnect).not.toHaveBeenCalled()
    })
  })

  it.each([
    ["connect", "POST", "/api/copilot-connection/connect"],
    ["disconnect", "DELETE", "/api/copilot-connection"],
  ] as const)("requires explicit confirmation to %s", async (_name, method, path) => {
    const copilotConnection = dependencies()

    await withServer(copilotConnection, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: mutationHeaders(),
        body: JSON.stringify({ confirmed: false }),
      })

      expect(response.status).toBe(400)
      expect(copilotConnection.findSession).not.toHaveBeenCalled()
      expect(copilotConnection.connect).not.toHaveBeenCalled()
      expect(copilotConnection.disconnect).not.toHaveBeenCalled()
    })
  })

  it.each([
    ["connect", "POST", "/api/copilot-connection/connect"],
    ["disconnect", "DELETE", "/api/copilot-connection"],
  ] as const)(
    "rejects cross-origin %s before parsing its mutation body",
    async (_name, method, path) => {
      const copilotConnection = dependencies()

      await withServer(copilotConnection, async (baseUrl) => {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            "content-type": "application/json",
            cookie: `hub_session=${sessionValue}`,
            origin: "https://attacker.example",
          },
          body: "{",
        })

        expect(response.status).toBe(403)
        expect(copilotConnection.findSession).not.toHaveBeenCalled()
        expect(copilotConnection.connect).not.toHaveBeenCalled()
        expect(copilotConnection.disconnect).not.toHaveBeenCalled()
      })
    },
  )

  it("passes the live session digest to explicit connection mutations", async () => {
    const copilotConnection = dependencies()
    const digest = createHash("sha256").update(sessionValue).digest("hex")

    await withServer(copilotConnection, async (baseUrl) => {
      const connectResponse = await fetch(`${baseUrl}/api/copilot-connection/connect`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ confirmed: true }),
      })
      const disconnectResponse = await fetch(`${baseUrl}/api/copilot-connection`, {
        method: "DELETE",
        headers: mutationHeaders(),
        body: JSON.stringify({ confirmed: true }),
      })

      expect(connectResponse.status).toBe(204)
      expect(disconnectResponse.status).toBe(204)
      expect(copilotConnection.connect).toHaveBeenCalledWith({ sessionDigest: digest })
      expect(copilotConnection.disconnect).toHaveBeenCalledWith({ sessionDigest: digest })
    })
  })

  it("returns conflict when the connection changes during disconnect", async () => {
    const copilotConnection = dependencies()
    vi.mocked(copilotConnection.disconnect).mockRejectedValue(
      new CopilotConnectionError(
        "connection_changed",
        "The Copilot connection changed during this request.",
      ),
    )

    await withServer(copilotConnection, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/copilot-connection`, {
        method: "DELETE",
        headers: mutationHeaders(),
        body: JSON.stringify({ confirmed: true }),
      })

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual({
        error: "The Copilot connection changed during this request.",
      })
    })
  })

  it("returns conflict when another connection check is already running", async () => {
    const copilotConnection = dependencies()
    vi.mocked(copilotConnection.connect).mockRejectedValue(
      new CopilotConnectionError("busy", "Another Copilot connection check is still running."),
    )

    await withServer(copilotConnection, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/copilot-connection/connect`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ confirmed: true }),
      })

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual({
        error: "Another Copilot connection check is still running.",
      })
    })
  })
})
