import type { RequestHandler } from "express"

import { verifyWebhookSignature } from "../../../../../integrations/github/verify-webhook-signature/index.ts"
import type { GitHubWebhookRouteDependencies } from "../types.ts"

function readInstallationId(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return undefined
  const installation = (payload as { installation?: { id?: unknown } }).installation
  return typeof installation?.id === "number" ? String(installation.id) : undefined
}

/** Receives GitHub App events. Only events for Hub's own installation change data. */
export function post(dependencies: GitHubWebhookRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const body: unknown = request.body
      if (
        !Buffer.isBuffer(body) ||
        !verifyWebhookSignature(
          dependencies.webhookSecret,
          body,
          request.get("x-hub-signature-256"),
        )
      ) {
        response.status(401).json({ error: "invalid_signature" })
        return
      }
      let payload: unknown
      try {
        payload = JSON.parse(body.toString("utf8"))
      } catch {
        response.status(400).json({ error: "invalid_payload" })
        return
      }
      const event = request.get("x-github-event") ?? ""
      if (readInstallationId(payload) !== dependencies.installationId) {
        response.status(202).end()
        return
      }
      const handled = await dependencies.handleEvent(event, payload)
      response.status(handled ? 204 : 202).end()
    } catch (error) {
      next(error)
    }
  }
}
