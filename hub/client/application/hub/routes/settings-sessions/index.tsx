import { useState } from "react"
import { useNavigate } from "react-router"

import { SessionRevocationPage } from "@pages/session-revocation-page"
import { navigateToExternalUrl } from "@application/hub/navigate-to-external-url"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { getSessionRevocationStatus } from "@application/hub/requests/get-session-revocation-status"
import { startSessionRevocationAuthorization } from "@application/hub/requests/start-session-revocation-authorization"
import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"
import { sessionRevocationPageData } from "@application/hub/view-models/session-revocation-page-data"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

const controller = settingsController("sessions", "public")

type RealSessionRouteData = {
  surface: "session-revocation"
  page: ReturnType<typeof sessionRevocationPageData>
}

function isMockMode() {
  return import.meta.env.DEV && import.meta.env.MODE === "mock"
}

export async function clientLoader(
  args: Parameters<typeof controller.clientLoader>[0],
): Promise<SettingsRouteData | RealSessionRouteData> {
  if (isMockMode()) return controller.clientLoader(args)
  const url = new URL(args.request.url)
  const result = url.searchParams.get("result")
  if (result && result !== "cancelled") {
    throw new Response("The session revocation result is invalid.", { status: 400 })
  }
  const session = await getCurrentHubSession(args.request)
  if (session.role !== "ADMINISTRATOR") {
    throw new Response("Administrator access is required.", { status: 403 })
  }
  const { status } = await getSessionRevocationStatus(args.request)
  return {
    surface: "session-revocation",
    page: sessionRevocationPageData(session, status, {
      notice:
        result === "cancelled" ? "Session revocation was cancelled. No sessions ended." : null,
    }),
  }
}

export async function clientAction(args: Parameters<typeof controller.clientAction>[0]) {
  if (isMockMode()) return controller.clientAction(args)
  throw new Response("Use the session revocation API.", { status: 405 })
}

export function meta({ loaderData }: { loaderData?: SettingsRouteData | RealSessionRouteData }) {
  if (loaderData?.surface === "session-revocation") {
    return [{ title: `${loaderData.page.pageTitle} - Replica Hub` }]
  }
  return settingsMeta("sessions", loaderData)
}

export default function SettingsSessions({
  loaderData,
}: {
  loaderData: SettingsRouteData | RealSessionRouteData
}) {
  const navigate = useNavigate()
  const [submission, setSubmission] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  })
  if (loaderData.surface === "session-revocation") {
    return (
      <div
        onSubmit={(event) => {
          if (!(event.target instanceof HTMLFormElement)) return
          event.preventDefault()
          if (submission.pending) return
          const form = new FormData(event.target)
          if (form.get("cancelled") === "1") {
            void navigate("/settings/sessions?result=cancelled")
            return
          }
          if (form.get("confirmed") !== "1") {
            setSubmission({
              pending: false,
              error: "Confirm that everyone's Hub session will end.",
            })
            return
          }
          setSubmission({ pending: true, error: null })
          void startSessionRevocationAuthorization(new Request(window.location.href))
            .then(({ authorizationUrl }) => navigateToExternalUrl(authorizationUrl))
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
        <SessionRevocationPage
          data={{ ...loaderData.page, alert: submission.error ?? loaderData.page.alert }}
        />
      </div>
    )
  }
  return <SettingsRouteScreen section="sessions" data={loaderData} />
}
