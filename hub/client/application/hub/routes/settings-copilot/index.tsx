import { useState } from "react"

import { CopilotConnectionPage } from "@pages/copilot-connection-page"
import type { CopilotConnectionPageData } from "@pages/copilot-connection-page/types"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getCopilotConnection } from "@application/hub/requests/get-copilot-connection"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { startCopilotAuthorization } from "@application/hub/requests/start-copilot-authorization"
import { navigateToExternalUrl } from "@application/hub/navigate-to-external-url"
import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"
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
  throw new Response("Use fresh authorization to change the Copilot connection.", {
    status: 405,
    headers: { Allow: "GET" },
  })
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
  const [submission, setSubmission] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  })
  return (
    <div
      onSubmit={(event) => {
        if (!(event.target instanceof HTMLFormElement)) return
        const action = new URL(event.target.action, window.location.href)
        if (action.pathname !== "/settings/copilot") return
        event.preventDefault()
        if (submission.pending) return
        const form = new FormData(event.target)
        if (form.get("confirmed") !== "1") {
          setSubmission({
            pending: false,
            error: "Confirm the Copilot connection change.",
          })
          return
        }
        const operation =
          form.get("_method") === "delete" ? "DISCONNECT_COPILOT" : "CONNECT_COPILOT"
        setSubmission({ pending: true, error: null })
        void startCopilotAuthorization(new Request(window.location.href), {
          confirmed: true,
          operation,
        })
          .then((started) => navigateToExternalUrl(started.authorizationUrl))
          .catch((error: unknown) => {
            if (!(error instanceof ApiRequestError) && !(error instanceof ApiContractError)) {
              throw error
            }
            setSubmission({
              pending: false,
              error:
                error instanceof ApiRequestError
                  ? error.message
                  : "The API response was invalid. Provider authorization could not start.",
            })
          })
      }}
    >
      <CopilotConnectionPage data={{ ...page, alert: submission.error }} />
    </div>
  )
}
