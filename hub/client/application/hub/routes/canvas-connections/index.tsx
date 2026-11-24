import { redirect, useLocation, useOutletContext, useRevalidator } from "react-router"
import { z } from "zod"

import { CanvasConnectionScreen } from "@application/hub/canvas-connections"
import {
  canvasActionError,
  canvasConnectionsPath,
  canvasConnectionsSchema,
  canvasFormDestination,
} from "@application/hub/canvas-connections/contract"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { requestJson } from "@application/hub/requests/request-json"
import { RouteFeedback } from "@application/hub/route-feedback"
import { selectWorkspaceRepository } from "@application/hub/view-models/select-workspace-repository"
import type { CanvasPairingsPageData } from "@pages/canvas-pairings-page/types"

import type { Route } from "./+types/index"
import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = {
  workspaceSection: "canvas",
  independentOfRepositoryNavigation: true,
  signedOutEntry: "canvas",
} satisfies WorkspaceRouteHandle

type ConnectionsData = {
  viewerId: string
  page: Extract<CanvasPairingsPageData, { kind: "connections" }>
}

export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<ConnectionsData | null> {
  const url = new URL(request.url)
  try {
    const { viewerId, connections } = await requestJson(
      new URL("/api/canvas/connections", url),
      canvasConnectionsSchema,
      { signal: request.signal },
    )
    const page: ConnectionsData["page"] = {
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
    return { viewerId, page }
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
  const workspace = useOutletContext<WorkspaceResponse | null>()
  const { search } = useLocation()
  const revalidator = useRevalidator()
  if (loaderData && workspace && loaderData.viewerId !== workspace.viewer.id) {
    return (
      <RouteFeedback
        kind="error"
        heading="Canvas connections unavailable"
        description="Your Hub account changed while loading connections. Try again to see your connections."
        embedded
        onRetry={() => void revalidator.revalidate()}
        retrying={revalidator.state !== "idle"}
      />
    )
  }

  const repository = workspace && selectWorkspaceRepository(workspace, new URLSearchParams(search))
  const page =
    loaderData && workspace
      ? {
          ...loaderData.page,
          backPath: repository ? `/repositories/${repository.id}` : loaderData.page.backPath,
        }
      : null
  return (
    <CanvasConnectionScreen page={page} returnTo={canvasConnectionsPath} embedded={!!workspace} />
  )
}
