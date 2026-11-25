import { useState } from "react"
import { useNavigate } from "react-router"

import { SessionRevocationPage } from "@pages/session-revocation-page"
import type { CurrentHubSession } from "@application/hub/administrator-contracts/types"
import { navigateToExternalUrl } from "@application/hub/navigate-to-external-url"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { getSessionRevocationStatus } from "@application/hub/requests/get-session-revocation-status"
import { sessionRevocationErrorMessage } from "@application/hub/session-revocation-error-message"
import { startSessionRevocationAuthorization } from "@application/hub/requests/start-session-revocation-authorization"
import { useAdministrationNavigation } from "@application/hub/use-administration-navigation"
import { resourcePath } from "@application/hub/view-models/resource-path"
import { sessionRevocationPageData } from "@application/hub/view-models/session-revocation-page-data"

import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = {
  workspaceSection: "sessions",
  independentOfRepositoryNavigation: true,
} satisfies WorkspaceRouteHandle

type SessionRevocationRouteData = {
  session: CurrentHubSession
  status: Awaited<ReturnType<typeof getSessionRevocationStatus>>["status"]
  notice: string | null
}

export async function clientLoader({
  request,
}: {
  request: Request
}): Promise<SessionRevocationRouteData> {
  const url = new URL(request.url)
  const result = url.searchParams.get("result")
  if (result && result !== "cancelled") {
    throw new Response("The session revocation result is invalid.", { status: 400 })
  }
  const session = await getCurrentHubSession(request)
  if (session.role !== "ADMINISTRATOR") {
    throw new Response("Administrator access is required.", { status: 403 })
  }
  const { status } = await getSessionRevocationStatus(request)
  return {
    session,
    status,
    notice: result === "cancelled" ? "Session revocation was cancelled. No sessions ended." : null,
  }
}

export function clientAction(): never {
  throw new Response("Use the session revocation API.", { status: 405 })
}

export function meta() {
  return [{ title: "End all Hub sessions - Replica Hub" }]
}

export default function SettingsSessions({
  loaderData: data,
}: {
  loaderData: SessionRevocationRouteData
}) {
  const workspace = useAdministrationNavigation("sessions", data.session.userId)
  const page = sessionRevocationPageData(data.session, data.status, {
    workspace,
    notice: data.notice,
  })
  const navigate = useNavigate()
  const [submission, setSubmission] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  })
  return (
    <div
      onSubmit={(event) => {
        if (!(event.target instanceof HTMLFormElement)) return
        if (event.target.action !== new URL(page.submitPath, window.location.href).href) {
          return
        }
        event.preventDefault()
        if (submission.pending) return
        const submitter =
          event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null
        const form = new FormData(
          event.target,
          submitter instanceof HTMLElement ? submitter : undefined,
        )
        if (form.get("cancelled") === "1") {
          void navigate(
            resourcePath("/settings/sessions", {
              result: "cancelled",
              repositoryId: workspace.repository?.selectedRepositoryId ?? null,
            }),
          )
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
                  ? sessionRevocationErrorMessage(error.message)
                  : "The API response was invalid. Provider authorization could not start.",
            })
          })
      }}
    >
      <SessionRevocationPage data={{ ...page, alert: submission.error ?? page.alert }} />
    </div>
  )
}
