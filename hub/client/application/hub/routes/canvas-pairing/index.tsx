import { redirect } from "react-router"

import { CanvasConnectionScreen } from "@application/hub/canvas-connections"
import {
  canvasActionError,
  canvasApprovalSchema,
  canvasCodeSchema,
  canvasConnectionsPath,
  canvasFormDestination,
} from "@application/hub/canvas-connections/contract"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { requestJson } from "@application/hub/requests/request-json"
import type { CanvasPairingsPageData } from "@pages/canvas-pairings-page/types"

import type { Route } from "./+types/index"
import { requireFormDestination } from "../require-form-destination"

function pairingPath(value: string) {
  const code = canvasCodeSchema.safeParse(value)
  if (!code.success) throw new Response("This Canvas connection code is invalid.", { status: 404 })
  return { code: code.data, browserPath: `/canvas/pair/${code.data}` }
}

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { code, browserPath } = pairingPath(params.userCode)
  try {
    const approval = await requestJson(
      new URL(`/api/canvas/approvals/${code}`, request.url),
      canvasApprovalSchema,
      { signal: request.signal },
    )
    if (approval.code !== code) throw new Error("Hub returned a different Canvas connection code.")
    const page: CanvasPairingsPageData = {
      kind: "approval",
      productName: "Replica Hub",
      pageTitle: "Connect Replica canvas",
      heading: "Connect Replica canvas",
      description: "Confirm the repository before connecting your Copilot canvas to Hub.",
      codeLabel: "Connection code",
      codeInstruction: "Only approve if this code matches the one shown in Copilot.",
      codeExpiresLabel: `This code expires at ${new Date(approval.expiresAt).toLocaleTimeString()}.`,
      code,
      repository: approval.repository,
      repositoryLabel: "Repository",
      permissions:
        "This connection lets the canvas read prototype and Build status for this repository. Hub checks your current repository access.",
      expiration: "You can revoke the connection at any time from",
      connectionsLabel: "Canvas connections",
      connectionsPath: canvasConnectionsPath,
      approveLabel: "Approve connection",
      approvePath: browserPath,
      cancelLabel: "Cancel",
      cancelPath: canvasConnectionsPath,
    }
    return { page, browserPath }
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      return { page: null, browserPath }
    }
    throw error
  }
}

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  const { code, browserPath } = pairingPath(params.userCode)
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 })
  const form = await request.formData()
  const destination = canvasFormDestination(form, request.url)
  if (!destination) throw new Response("This Canvas form does not match the page.", { status: 422 })
  requireFormDestination(destination, "post", browserPath, ["post"])
  try {
    await requestJson(new URL(`/api/canvas/approvals/${code}`, request.url), canvasApprovalSchema, {
      method: "POST",
      signal: request.signal,
    })
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return redirect(browserPath)
    return canvasActionError(error)
  }
  return redirect(`${canvasConnectionsPath}?approved=1`)
}

export function meta() {
  return [{ title: "Connect Replica canvas - Replica Hub" }]
}

export default function CanvasPairing({ loaderData }: Route.ComponentProps) {
  return <CanvasConnectionScreen page={loaderData.page} returnTo={loaderData.browserPath} />
}
