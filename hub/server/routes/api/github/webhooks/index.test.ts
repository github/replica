import { createHmac } from "node:crypto"
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
    event = "member",
    handled = true,
    signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
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
  const response = await fetch(`http://127.0.0.1:${port}/api/github/webhooks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": signature,
    },
    body,
  })
  return { status: response.status, handleEvent }
}

describe("POST /api/github/webhooks", () => {
  const payload = JSON.stringify({ action: "removed", installation: { id: 42 } })

  it("rejects deliveries without a valid signature", async () => {
    const { status, handleEvent } = await deliver(payload, { signature: "sha256=bad" })
    expect(status).toBe(401)
    expect(handleEvent).not.toHaveBeenCalled()
  })

  it("ignores events from other installations", async () => {
    const { status, handleEvent } = await deliver(
      JSON.stringify({ action: "removed", installation: { id: 7 } }),
    )
    expect(status).toBe(202)
    expect(handleEvent).not.toHaveBeenCalled()
  })

  it("passes verified events for Hub's installation to the handler", async () => {
    const { status, handleEvent } = await deliver(payload)
    expect(status).toBe(204)
    expect(handleEvent).toHaveBeenCalledWith("member", JSON.parse(payload))
  })

  it("accepts events Hub does not act on", async () => {
    const { status } = await deliver(payload, { event: "push", handled: false })
    expect(status).toBe(202)
  })
})
