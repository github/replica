import { data, useFetcher, useLocation, useOutletContext } from "react-router"
import type { ClientActionFunctionArgs } from "react-router"
import { z } from "zod"

import { WelcomePage } from "@pages/welcome-page"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { requestJson } from "@application/hub/requests/request-json"
import { SettingsFormBoundary } from "@application/hub/screens/settings-form-boundary"
import { hubWorkspace } from "@application/hub/view-models/hub-workspace"
import { welcomeData } from "@application/hub/view-models/welcome-data"

import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = { workspaceSection: "welcome" } satisfies WorkspaceRouteHandle

export async function clientAction({ request }: Pick<ClientActionFunctionArgs, "request">) {
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

export function meta() {
  return [{ title: "Welcome - Replica Hub" }]
}

export default function SettingsWelcome() {
  const workspace = useOutletContext<WorkspaceResponse>()
  const fetcher = useFetcher<{ saved: boolean; error?: string }>()
  const search = new URLSearchParams(useLocation().search)
  const page = welcomeData(
    hubWorkspace(workspace, search, "welcome"),
    workspace.welcomeHidden ?? false,
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
