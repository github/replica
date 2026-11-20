import { data, useFetcher, useLocation } from "react-router"
import { z } from "zod"

import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getWorkspace } from "@application/hub/requests/get-workspace"
import {
  changeRepositoryAnalytics,
  finishRepositoryAnalyticsAuthorization,
  getRepositoryAnalytics,
} from "@application/hub/requests/repository-analytics"
import { SettingsFormBoundary } from "@application/hub/screens/settings-form-boundary"
import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"
import type { SettingsActionResult } from "@application/hub/settings-contracts/types"
import { repositoryWorkspace } from "@application/hub/view-models/repository-workspace"
import { resourcePath } from "@application/hub/view-models/resource-path"
import { analyticsPageData } from "@application/hub/view-models/settings-analytics"
import { AnalyticsPage } from "@pages/analytics-page"
import type { AnalyticsPageData } from "@pages/analytics-page/types"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"
import { readDestinationForm } from "./read-destination-form"

const mock = settingsController("analytics", "workspace")
type AnalyticsRouteData =
  SettingsRouteData | { surface: "repository-analytics"; page: AnalyticsPageData }
type AnalyticsActionResult =
  | SettingsActionResult
  | {
      saved: "pending"
      authorization: NonNullable<AnalyticsPageData["authorization"]>
    }

function isMockMode() {
  return import.meta.env.DEV && import.meta.env.MODE === "mock"
}

function readRepositoryId(value?: string) {
  const parsed = z.uuid().safeParse(value)
  if (!parsed.success) throw new Response("Repository not found.", { status: 404 })
  return parsed.data.toLowerCase()
}

export async function clientLoader(
  args: Parameters<typeof mock.clientLoader>[0],
): Promise<AnalyticsRouteData> {
  if (isMockMode()) return mock.clientLoader(args)
  const { request } = args
  const id = readRepositoryId(args.params.repositoryId)
  const [workspace, analytics] = await Promise.all([
    getWorkspace(request),
    getRepositoryAnalytics(request, id),
  ])
  const repository = workspace.repositories.find((entry) => entry.id === id)
  if (!repository) throw new Response("Repository not found.", { status: 404 })
  const search = new URL(request.url).searchParams
  const path = `/repositories/${id}/analytics`
  return {
    surface: "repository-analytics",
    page: {
      ...analyticsPageData(
        {
          ...repositoryWorkspace(workspace, repository, search, true),
          selectedSection: "analytics",
        },
        resourcePath(path, search),
        analytics.destinations.map((destination) => ({
          ...destination,
          path: resourcePath(path, search, { destinationId: destination.id }),
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
    },
  }
}

export async function clientAction(args: Parameters<typeof mock.clientAction>[0]) {
  if (isMockMode()) return mock.clientAction(args)
  const { request } = args
  if (request.method.toUpperCase() !== "POST") {
    throw new Response("Method not allowed.", { status: 405, headers: { Allow: "POST" } })
  }
  try {
    const repositoryId = readRepositoryId(args.params.repositoryId)
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
    return data<SettingsActionResult>({ saved: true, notice, revision: Date.now() })
  } catch (error) {
    if (error instanceof Response && error.status >= 400) {
      return data<SettingsActionResult>(
        { saved: false, error: await error.text() },
        { status: error.status },
      )
    }
    if (error instanceof ApiRequestError || error instanceof ApiContractError) {
      const status = error instanceof ApiRequestError && error.status ? error.status : 502
      return data<SettingsActionResult>(
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

export function meta({ loaderData }: { loaderData?: AnalyticsRouteData }) {
  if (loaderData?.surface === "repository-analytics") return [{ title: "Analytics - Replica Hub" }]
  return settingsMeta("analytics", loaderData)
}

export default function SettingsAnalytics({ loaderData }: { loaderData: AnalyticsRouteData }) {
  if (loaderData.surface === "repository-analytics") {
    return <ConnectedAnalytics page={loaderData.page} />
  }
  return <SettingsRouteScreen section="analytics" data={loaderData} />
}

function ConnectedAnalytics({ page }: { page: AnalyticsPageData }) {
  const location = useLocation()
  const fetcher = useFetcher<AnalyticsActionResult>()
  const result = fetcher.data
  const busy = fetcher.state !== "idle"
  return (
    <SettingsFormBoundary
      busy={busy}
      error={!busy && result?.saved === false ? result.error : null}
      notice={!busy && result?.saved === true ? result.notice : null}
      onSubmit={(input) => {
        if (busy) return
        const action = input.get("_action")
        if (
          typeof action === "string" &&
          new URL(action, window.location.href).pathname === "/session"
        ) {
          void fetcher.submit({ intent: "sign-out" }, { method: "post", action: "/session" })
        } else {
          void fetcher.submit(input, {
            method: "post",
            action: `${location.pathname}${location.search}`,
          })
        }
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
