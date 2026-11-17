import { createHash, createHmac, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../../create-app"
import { createLogger } from "../../../../integrations/pino/create-logger"
import type { GitHubWebhookRouteDependencies } from "./types.ts"

const secret = "webhook-secret-for-tests"

async function deliver(
  body: string,
  {
    delivery = randomUUID(),
    event = "member",
    handled = true,
    signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
  }: {
    delivery?: string | null
    event?: string | null
    handled?: boolean
    signature?: string | null
  } = {},
) {
  const handleEvent = vi.fn(() => Promise.resolve(handled))
  const githubWebhooks: GitHubWebhookRouteDependencies = {
    installationId: "42",
    webhookSecret: secret,
    handleEvent,
  }
  const server = createServer(
    createApp({ githubWebhooks, logger: createLogger({ level: "silent" }) }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(() => void server.close())
  const { port } = server.address() as AddressInfo
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (signature !== null) headers["x-hub-signature-256"] = signature
  if (event !== null) headers["x-github-event"] = event
  if (delivery !== null) headers["x-github-delivery"] = delivery
  const response = await fetch(`http://127.0.0.1:${port}/api/github/webhooks`, {
    method: "POST",
    headers,
    body,
  })
  return { status: response.status, handleEvent }
}

describe("POST /api/github/webhooks", () => {
  const payload = JSON.stringify({ action: "removed", installation: { id: 42 } })

  it.each([null, "sha256=bad", `sha256=${"0".repeat(64)}`])(
    "rejects deliveries without a valid signature",
    async (signature) => {
      const { status, handleEvent } = await deliver(payload, { signature })
      expect(status).toBe(401)
      expect(handleEvent).not.toHaveBeenCalled()
    },
  )

  it("ignores events from other installations", async () => {
    const { status, handleEvent } = await deliver(
      JSON.stringify({ action: "removed", installation: { id: 7 } }),
      { delivery: null, event: null },
    )
    expect(status).toBe(202)
    expect(handleEvent).not.toHaveBeenCalled()
  })

  it("checks the signature before ignoring another installation", async () => {
    const { status, handleEvent } = await deliver(
      JSON.stringify({ action: "removed", installation: { id: 7 } }),
      { delivery: null, signature: `sha256=${"0".repeat(64)}` },
    )
    expect(status).toBe(401)
    expect(handleEvent).not.toHaveBeenCalled()
  })

  it.each([
    null,
    "not-a-uuid",
    "123e4567-e89b-12d3-a456-42661417400",
    "123e4567-e89b-12d3-a456-42661417400g",
    "123e4567-e89b-12d3a-456-426614174000",
  ])("rejects a missing or invalid delivery ID (%s) for Hub's installation", async (delivery) => {
    const { status, handleEvent } = await deliver(payload, { delivery })
    expect(status).toBe(400)
    expect(handleEvent).not.toHaveBeenCalled()
  })

  it.each([
    "123e4567-e89b-12d3-a456-426614174000",
    "123e4567-e89b-f2d3-a456-426614174000",
    "123e4567-e89b-42d3-0456-426614174000",
  ])(
    "accepts a GUID-shaped delivery ID without restricting version or variant (%s)",
    async (delivery) => {
      const { status, handleEvent } = await deliver(payload, { delivery })
      expect(status).toBe(204)
      expect(handleEvent).toHaveBeenCalledWith(
        "member",
        JSON.parse(payload),
        expect.objectContaining({ id: delivery }),
      )
    },
  )

  it("passes the verified delivery ID and raw-body digest to the handler", async () => {
    const body = '{\n  "action": "removed", "installation": { "id": 42 }, "name": "é"\n}'
    const delivery = randomUUID()
    const { status, handleEvent } = await deliver(body, { delivery })
    expect(status).toBe(204)
    expect(handleEvent).toHaveBeenCalledWith("member", JSON.parse(body), {
      id: delivery,
      payloadDigest: createHash("sha256").update(body).digest("hex"),
    })
  })

  it("rejects a signed body that is not valid JSON", async () => {
    const { status, handleEvent } = await deliver("{")
    expect(status).toBe(400)
    expect(handleEvent).not.toHaveBeenCalled()
  })

  it("accepts events Hub does not act on", async () => {
    const { status } = await deliver(payload, { event: "push", handled: false })
    expect(status).toBe(202)
  })
})
