import { redirect } from "react-router"
import { z } from "zod"

import { CanvasConnectionScreen } from "@application/hub/canvas-connections"
import {
  canvasActionError,
  canvasConnectionsPath,
  canvasConnectionsSchema,
  canvasFormDestination,
} from "@application/hub/canvas-connections/contract"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { requestJson } from "@application/hub/requests/request-json"
import type { CanvasPairingsPageData } from "@pages/canvas-pairings-page/types"

import type { Route } from "./+types/index"

export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<CanvasPairingsPageData | null> {
  const url = new URL(request.url)
  try {
    const { connections } = await requestJson(
      new URL("/api/canvas/connections", url),
      canvasConnectionsSchema,
      { signal: request.signal },
    )
    return {
      kind: "connections",
      productName: "Replica Hub",
      pageTitle: "Canvas connections",
      heading: "Canvas connections",
      description: "Review and revoke your Copilot canvas connections.",
      emptyLabel: "No active connections. Open the Replica canvas in Copilot to start one.",
      backLabel: "Back to repositories",
      backPath: "/repositories",
      revokeLabel: "Revoke",
      notice:
        url.searchParams.get("approved") === "1"
          ? "Connection approved. Return to Copilot to finish connecting."
          : null,
      grants: connections.map(({ id, repository, expiresAt, inactiveAt }) => ({
        id,
        repository,
        expiresLabel: inactiveAt
          ? `Ends if unused by ${new Date(inactiveAt).toLocaleString()}`
          : `Expires ${new Date(expiresAt).toLocaleString()}`,
        revokePath: `${canvasConnectionsPath}/${id}`,
      })),
    }
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null
    throw error
  }
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 })
  const form = await request.formData()
  const destination = canvasFormDestination(form, request.url)
  const id =
    destination && /^\/canvas\/connections\/([1-9]\d{0,9})$/.exec(destination.pathname)?.[1]
  if (!id || form.get("_method") !== "delete") {
    throw new Response("This Canvas connection could not be revoked.", { status: 422 })
  }
  try {
    await requestJson(new URL(`/api/canvas/connections/${id}`, request.url), z.undefined(), {
      method: "DELETE",
      signal: request.signal,
    })
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401)
      return redirect(canvasConnectionsPath)
    return canvasActionError(error)
  }
  return { notice: "Canvas connection revoked." }
}

export function meta() {
  return [{ title: "Canvas connections - Replica Hub" }]
}

export default function CanvasConnections({ loaderData }: Route.ComponentProps) {
  return <CanvasConnectionScreen page={loaderData} returnTo={canvasConnectionsPath} />
}
