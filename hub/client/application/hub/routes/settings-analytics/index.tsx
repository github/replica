import { data, useFetcher, useLocation, useOutletContext } from "react-router"
import type { ClientActionFunctionArgs, ClientLoaderFunctionArgs } from "react-router"
import { z } from "zod"

import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import {
  changeRepositoryAnalytics,
  finishRepositoryAnalyticsAuthorization,
  getRepositoryAnalytics,
} from "@application/hub/requests/repository-analytics"
import { SettingsFormBoundary } from "@application/hub/screens/settings-form-boundary"
import { repositoryWorkspace } from "@application/hub/view-models/repository-workspace"
import { resourcePath } from "@application/hub/view-models/resource-path"
import { analyticsPageData } from "@application/hub/view-models/analytics-page-data"
import { AnalyticsPage } from "@pages/analytics-page"
import type { AnalyticsPageData } from "@pages/analytics-page/types"

import { readDestinationForm } from "./read-destination-form"
import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = { workspaceSection: "analytics" } satisfies WorkspaceRouteHandle

type RepositoryAnalyticsRouteData = {
  id: string
  analytics: Awaited<ReturnType<typeof getRepositoryAnalytics>>
}
type AnalyticsActionResult =
  | { saved: true; notice: string; revision: number }
  | { saved: false; error: string }
  | {
      saved: "pending"
      authorization: NonNullable<AnalyticsPageData["authorization"]>
    }

function readRepositoryId(value?: string) {
  const parsed = z.uuid().safeParse(value)
  if (!parsed.success) throw new Response("Repository not found.", { status: 404 })
  return parsed.data.toLowerCase()
}

export async function clientLoader({
  request,
  params,
}: Pick<ClientLoaderFunctionArgs, "request" | "params">): Promise<RepositoryAnalyticsRouteData> {
  const id = readRepositoryId(params.repositoryId)
  return {
    id,
    analytics: await getRepositoryAnalytics(request, id),
  }
}

export async function clientAction({
  request,
  params,
}: Pick<ClientActionFunctionArgs, "request" | "params">) {
  if (request.method.toUpperCase() !== "POST") {
    throw new Response("Method not allowed.", { status: 405, headers: { Allow: "POST" } })
  }
  try {
    const repositoryId = readRepositoryId(params.repositoryId)
    const form = await request.formData()
    const operation = form.get("analyticsAuthorization")
    if (operation === "continue" || operation === "cancel") {
      const id = z.uuid().safeParse(form.get("authorizationId"))
      if (!id.success) throw new Response("This authorization is unavailable.", { status: 404 })
      await finishRepositoryAnalyticsAuthorization(request, repositoryId, id.data, operation)
      return data<AnalyticsActionResult>({
        saved: true,
        notice: operation === "continue" ? "Destination change saved." : "Change cancelled.",
        revision: Date.now(),
      })
    }
    const change = readDestinationForm(request, repositoryId, form)
    const result = await changeRepositoryAnalytics(request, repositoryId, change)
    if ("authorization" in result)
      return data<AnalyticsActionResult>({ saved: "pending", authorization: result.authorization })
    const notice =
      change.method === "DELETE"
        ? "Destination disconnected."
        : change.path.endsWith("/pause")
          ? "Delivery paused."
          : change.path.endsWith("/resume")
            ? "Delivery resumed."
            : "Configuration saved."
    return data<AnalyticsActionResult>({ saved: true, notice, revision: Date.now() })
  } catch (error) {
    if (error instanceof Response && error.status >= 400) {
      return data<AnalyticsActionResult>(
        { saved: false, error: await error.text() },
        { status: error.status },
      )
    }
    if (error instanceof ApiRequestError || error instanceof ApiContractError) {
      const status = error instanceof ApiRequestError && error.status ? error.status : 502
      return data<AnalyticsActionResult>(
        {
          saved: false,
          error:
            error instanceof ApiRequestError ? error.message : "The change could not be confirmed.",
        },
        { status },
      )
    }
    throw error
  }
}

export function meta() {
  return [{ title: "Analytics - Replica Hub" }]
}

export default function SettingsAnalytics({
  loaderData: { id, analytics },
}: {
  loaderData: RepositoryAnalyticsRouteData
}) {
  const workspace = useOutletContext<WorkspaceResponse>()
  const location = useLocation()
  const fetcher = useFetcher<AnalyticsActionResult>()
  const repository = workspace.repositories.find((entry) => entry.id === id)
  if (!repository) throw new ApiRequestError(404, "Repository not found.")
  const search = new URLSearchParams(location.search)
  const path = `/repositories/${id}/analytics`
  const page = {
    ...analyticsPageData(
      { ...repositoryWorkspace(workspace, repository), selectedSection: "analytics" },
      path,
      analytics.destinations.map((destination) => ({
        ...destination,
        path: resourcePath(path, { destinationId: destination.id }),
      })),
      {
        readOnly: !analytics.canMutate,
        historyAvailable: analytics.canExportHistory,
        notice: !analytics.canMutate
          ? "Hosted destination changes are unavailable until Hub can verify fresh GitHub repository authorization."
          : null,
        exportNotice: !analytics.outboundEnabled
          ? "Outbound analytics delivery is disabled on this Hub."
          : undefined,
      },
    ),
    authorization: analytics.authorization,
    alert:
      search.get("authorization") === "cancelled"
        ? "GitHub authorization was cancelled. No changes were saved."
        : search.get("authorization") === "unavailable" ||
            (search.has("authorizationId") && !analytics.authorization)
          ? "This authorization is unavailable. Submit the change again if needed."
          : null,
  }
  const result = fetcher.data
  const busy = fetcher.state !== "idle"
  return (
    <SettingsFormBoundary
      busy={busy}
      error={!busy && result?.saved === false ? result.error : null}
      notice={!busy && result?.saved === true ? result.notice : null}
      onSubmit={(input) => {
        if (busy) return
        void fetcher.submit(input, {
          method: "post",
          action: `${location.pathname}${location.search}`,
        })
      }}
    >
      <AnalyticsPage
        key={`${page.selectedRepositoryId}:${result?.saved === true ? result.revision : result?.saved === "pending" ? result.authorization.id : ""}`}
        data={{
          ...page,
          alert: result?.saved === true ? null : page.alert,
          authorization: result?.saved === "pending" ? result.authorization : page.authorization,
        }}
      />
    </SettingsFormBoundary>
  )
}
