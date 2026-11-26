import { useFetcher, useLocation, useOutletContext } from "react-router"
import { z } from "zod"

import { agentConnectionsSchema } from "@application/hub/agent-connections/contract"
import {
  canvasActionError,
  canvasFormDestination,
} from "@application/hub/canvas-connections/contract"
import { recordIdentifierSchema } from "@application/hub/contracts"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { FormBoundary } from "@application/hub/form-boundary"
import { requestJson } from "@application/hub/requests/request-json"
import { AgentConnectionsPage } from "@pages/agent-connections-page"

import type { Route } from "./+types/index"
import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = { workspaceSection: "learnings" } satisfies WorkspaceRouteHandle

function repositoryId(value: string | undefined) {
  const parsed = recordIdentifierSchema.safeParse(value)
  if (!parsed.success) throw new Response("Invalid repository identifier.", { status: 400 })
  return parsed.data
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString()
}

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const id = repositoryId(params.repositoryId)
  const { connections } = await requestJson(
    new URL("/api/agent-connections", request.url),
    agentConnectionsSchema,
    { signal: request.signal },
  )
  return {
    mcpUrl: new URL(`/mcp/repositories/${id}`, request.url).href,
    connections: connections.map((connection) => ({
      id: connection.id,
      name: connection.agent,
      connectedLabel: `Connected ${dateLabel(connection.createdAt)}`,
      lastUsedLabel: connection.lastUsedAt
        ? `Last used ${dateLabel(connection.lastUsedAt)}`
        : "Not used yet",
      revokePath: `/repositories/${id}/learnings/agents/${connection.id}`,
    })),
  }
}

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  const id = repositoryId(params.repositoryId)
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 })
  const form = await request.formData()
  const destination = canvasFormDestination(form, request.url)
  const connectionId = destination?.pathname.startsWith(`/repositories/${id}/learnings/agents/`)
    ? z.uuid().safeParse(destination.pathname.split("/").at(-1))
    : null
  if (!connectionId?.success || form.get("_method") !== "delete") {
    throw new Response("This agent connection could not be revoked.", { status: 422 })
  }
  try {
    await requestJson(
      new URL(`/api/agent-connections/${connectionId.data}`, request.url),
      z.undefined(),
      { method: "DELETE", signal: request.signal },
    )
  } catch (error) {
    return canvasActionError(error)
  }
  return { notice: "Agent access revoked." }
}

export function meta() {
  return [{ title: "Connect an agent - Replica Hub" }]
}

export default function LearningAgents({ loaderData, params }: Route.ComponentProps) {
  const workspace = useOutletContext<WorkspaceResponse | null>()
  const fetcher = useFetcher<{ error?: string; notice?: string }>()
  const { pathname } = useLocation()
  const busy = fetcher.state !== "idle"
  const repository = workspace?.repositories.find(({ id }) => id === params.repositoryId)
  return (
    <FormBoundary
      busy={busy}
      error={busy ? null : fetcher.data?.error}
      onSubmit={(form) => void fetcher.submit(form, { method: "post", action: pathname })}
    >
      <AgentConnectionsPage
        busy={busy}
        data={{
          view: "connections",
          repositoryName: repository?.nameWithOwner ?? "this repository",
          mcpUrl: loaderData.mcpUrl,
          signedInAs: workspace?.viewer.login ?? "",
          connections: loaderData.connections,
          notice: busy ? null : (fetcher.data?.notice ?? null),
        }}
      />
    </FormBoundary>
  )
}
