import { redirect, useFetcher, useLocation } from "react-router"
import { z } from "zod"

import { HubApplication } from "@application/hub-application"
import {
  agentAuthorizationSchema,
  agentDecisionSchema,
} from "@application/hub/agent-connections/contract"
import { canvasActionError } from "@application/hub/canvas-connections/contract"
import { FormBoundary } from "@application/hub/form-boundary"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { requestJson } from "@application/hub/requests/request-json"
import { AgentConnectionsPage } from "@pages/agent-connections-page"
import type { AgentConnectionsPageData } from "@pages/agent-connections-page/types"

import type { Route } from "./+types/index"

function authorizationPath(value: string | undefined) {
  const id = z.uuid().safeParse(value)
  if (!id.success) throw new Response("This agent request is invalid.", { status: 404 })
  return { id: id.data, browserPath: `/agents/approve/${id.data}` }
}

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { id, browserPath } = authorizationPath(params.authorizationId)
  try {
    const authorization = await requestJson(
      new URL(`/api/agent-connections/authorizations/${id}`, request.url),
      agentAuthorizationSchema,
      { signal: request.signal },
    )
    const page: AgentConnectionsPageData = {
      view: "approval",
      requestingAgent: authorization.agent,
      signedInAs: authorization.signedInAs,
      expiresLabel: `This request expires at ${new Date(authorization.expiresAt).toLocaleTimeString()}.`,
      decisionPath: browserPath,
    }
    return { page, browserPath }
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return { page: null, browserPath }
    if (error instanceof ApiRequestError && error.status === 410)
      throw new Response(error.message, { status: 410 })
    throw error
  }
}

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  const { id, browserPath } = authorizationPath(params.authorizationId)
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 })
  const decision = (await request.formData()).get("decision")
  if (decision !== "approve" && decision !== "cancel")
    throw new Response("Choose whether to approve this agent.", { status: 422 })
  try {
    const { redirectUrl } = await requestJson(
      new URL(`/api/agent-connections/authorizations/${id}/${decision}`, request.url),
      agentDecisionSchema,
      { method: "POST", signal: request.signal },
    )
    // The agent listens on its own address, so the browser leaves Hub to finish.
    return redirect(redirectUrl)
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return redirect(browserPath)
    return canvasActionError(error)
  }
}

export function meta() {
  return [{ title: "Connect an agent - Replica Hub" }]
}

export default function AgentApproval({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher<{ error?: string }>()
  const { pathname } = useLocation()
  if (!loaderData.page) return <HubApplication canvasReturnTo={loaderData.browserPath} />
  const busy = fetcher.state !== "idle"
  return (
    <FormBoundary
      busy={busy}
      error={busy ? null : fetcher.data?.error}
      onSubmit={(form) => void fetcher.submit(form, { method: "post", action: pathname })}
    >
      <AgentConnectionsPage busy={busy} data={loaderData.page} />
    </FormBoundary>
  )
}
