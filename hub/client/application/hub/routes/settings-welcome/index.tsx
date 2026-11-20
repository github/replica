import { data, useFetcher, useLocation, useOutletContext } from "react-router"
import type { ClientActionFunctionArgs, ClientLoaderFunctionArgs } from "react-router"
import { z } from "zod"

import { WelcomePage } from "@pages/welcome-page"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { requestJson } from "@application/hub/requests/request-json"
import { SettingsFormBoundary } from "@application/hub/screens/settings-form-boundary"
import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"
import { hubWorkspace } from "@application/hub/view-models/hub-workspace"
import { welcomeData } from "@application/hub/view-models/settings-welcome"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

const mock = settingsController("welcome", "workspace")

function real() {
  return !(import.meta.env.DEV && import.meta.env.MODE === "mock")
}

export function clientLoader(args: ClientLoaderFunctionArgs) {
  return real() ? null : mock.clientLoader(args)
}

export async function clientAction(args: ClientActionFunctionArgs) {
  if (!real()) return mock.clientAction(args)
  const { request } = args
  if (request.method.toUpperCase() !== "POST") {
    throw new Response("Method not allowed.", { status: 405, headers: { Allow: "POST" } })
  }
  if ((await request.formData()).get("_method") !== "patch") {
    throw new Response("Invalid Welcome action.", { status: 400 })
  }
  try {
    await requestJson(
      new URL("/api/workspace/welcome", request.url),
      z.object({ welcomeHidden: z.literal(true) }),
      { method: "PATCH", signal: request.signal },
    )
    return data({ saved: true })
  } catch (error) {
    return data(
      { saved: false, error: "Hub could not hide Welcome. Try again." },
      { status: error instanceof ApiRequestError && error.status >= 400 ? error.status : 503 },
    )
  }
}

export function meta({ loaderData }: { loaderData?: SettingsRouteData | null }) {
  return real()
    ? [{ title: "Welcome - Replica Hub" }]
    : settingsMeta("welcome", loaderData ?? undefined)
}

export default function SettingsWelcome({ loaderData }: { loaderData: SettingsRouteData | null }) {
  return loaderData ? <SettingsRouteScreen section="welcome" data={loaderData} /> : <RealWelcome />
}

function RealWelcome() {
  const workspace = useOutletContext<WorkspaceResponse>()
  const fetcher = useFetcher<{ saved: boolean; error?: string }>()
  const search = new URLSearchParams(useLocation().search)
  const page = welcomeData(
    hubWorkspace(workspace, search, "welcome"),
    workspace.welcomeHidden ?? false,
    search,
    true,
  )
  const busy = fetcher.state !== "idle"
  return (
    <SettingsFormBoundary
      busy={busy}
      error={busy ? null : fetcher.data?.error}
      shouldIntercept={(form) => new URL(form.action).pathname === "/welcome"}
      onSubmit={(form) => {
        if (!busy && page.hidePath)
          void fetcher.submit(form, { method: "post", action: page.hidePath })
      }}
    >
      <WelcomePage data={page} />
    </SettingsFormBoundary>
  )
}
