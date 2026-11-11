import { useEffect, useRef } from "react"
import { data, useFetcher, useLocation, useRevalidator } from "react-router"

import { CopilotConnectionPage } from "@pages/copilot-connection-page"
import type { CopilotConnectionPageData } from "@pages/copilot-connection-page/types"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { changeCopilotConnection } from "@application/hub/requests/change-copilot-connection"
import { getCopilotConnection } from "@application/hub/requests/get-copilot-connection"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"
import { SettingsFormBoundary } from "@application/hub/screens/settings-form-boundary"
import type { SettingsActionResult } from "@application/hub/settings-contracts/types"
import { copilotConnectionPageData } from "@application/hub/view-models/copilot-connection-page-data"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

const controller = settingsController("copilot", "workspace")

type RealCopilotRouteData = {
  surface: "copilot-connection"
  page: CopilotConnectionPageData
}

function isMockMode() {
  return import.meta.env.DEV && import.meta.env.MODE === "mock"
}

export async function clientLoader(
  args: Parameters<typeof controller.clientLoader>[0],
): Promise<SettingsRouteData | RealCopilotRouteData> {
  if (isMockMode()) return controller.clientLoader(args)
  const session = await getCurrentHubSession(args.request)
  if (session.role !== "ADMINISTRATOR") {
    throw new Response("Administrator access is required.", { status: 403 })
  }
  const status = await getCopilotConnection(args.request)
  return { surface: "copilot-connection", page: copilotConnectionPageData(session, status) }
}

export async function clientAction(args: Parameters<typeof controller.clientAction>[0]) {
  if (isMockMode()) return controller.clientAction(args)
  if (args.request.method.toUpperCase() !== "POST") {
    throw new Response("Method not allowed.", { status: 405, headers: { Allow: "POST" } })
  }
  try {
    const form = await args.request.formData()
    if (form.get("confirmed") !== "1") {
      return data<SettingsActionResult>(
        { saved: false, error: "Confirm the Copilot connection change." },
        { status: 400 },
      )
    }
    const operation = form.get("_method") === "delete" ? "disconnect" : "connect"
    await changeCopilotConnection(args.request, operation)
    return data<SettingsActionResult>({
      saved: true,
      notice: `Copilot ${operation === "connect" ? "connected" : "disconnected"}.`,
      revision: 0,
    })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return data<SettingsActionResult>(
        { saved: false, error: error.message },
        { status: error.status >= 400 && error.status <= 599 ? error.status : 503 },
      )
    }
    if (error instanceof ApiContractError) {
      return data<SettingsActionResult>(
        { saved: false, error: "The API response was invalid. No change was saved." },
        { status: 502 },
      )
    }
    throw error
  }
}

export function meta({ loaderData }: { loaderData?: SettingsRouteData | RealCopilotRouteData }) {
  if (loaderData?.surface === "copilot-connection") {
    return [{ title: "Copilot connection - Replica Hub" }]
  }
  return settingsMeta("copilot", loaderData)
}

export default function SettingsCopilot({
  loaderData,
}: {
  loaderData: SettingsRouteData | RealCopilotRouteData
}) {
  if (loaderData.surface === "copilot-connection") {
    return <RealCopilotConnection page={loaderData.page} />
  }
  return <SettingsRouteScreen section="copilot" data={loaderData} />
}

function RealCopilotConnection({ page }: { page: CopilotConnectionPageData }) {
  const fetcher = useFetcher<SettingsActionResult>()
  const location = useLocation()
  const revalidator = useRevalidator()
  const revalidatedResult = useRef<SettingsActionResult | undefined>(undefined)
  const busy = fetcher.state !== "idle" || revalidator.state !== "idle"
  const result = fetcher.data
  useEffect(() => {
    if (result?.saved !== true || revalidatedResult.current === result) return
    revalidatedResult.current = result
    void revalidator.revalidate()
  }, [result, revalidator])
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
      <CopilotConnectionPage data={page} />
    </SettingsFormBoundary>
  )
}
