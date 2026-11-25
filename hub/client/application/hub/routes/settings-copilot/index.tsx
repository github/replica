import { useState } from "react"

import { CopilotConnectionPage } from "@pages/copilot-connection-page"
import type { CopilotConnectionPageData } from "@pages/copilot-connection-page/types"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getCopilotConnection } from "@application/hub/requests/get-copilot-connection"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { startCopilotAuthorization } from "@application/hub/requests/start-copilot-authorization"
import { navigateToExternalUrl } from "@application/hub/navigate-to-external-url"
import { useAdministrationNavigation } from "@application/hub/use-administration-navigation"
import { copilotConnectionPageData } from "@application/hub/view-models/copilot-connection-page-data"

import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = {
  workspaceSection: "copilot",
  independentOfRepositoryNavigation: true,
} satisfies WorkspaceRouteHandle

type CopilotRouteData = {
  viewerId: string
  status: Awaited<ReturnType<typeof getCopilotConnection>>
}

export async function clientLoader({ request }: { request: Request }): Promise<CopilotRouteData> {
  const session = await getCurrentHubSession(request)
  if (session.role !== "ADMINISTRATOR") {
    throw new Response("Administrator access is required.", { status: 403 })
  }
  return {
    viewerId: session.userId,
    status: await getCopilotConnection(request),
  }
}

export function clientAction(): never {
  throw new Response("Use fresh authorization to change the Copilot connection.", {
    status: 405,
    headers: { Allow: "GET" },
  })
}

export function meta() {
  return [{ title: "Copilot connection - Replica Hub" }]
}

export default function SettingsCopilot({ loaderData: data }: { loaderData: CopilotRouteData }) {
  const navigation = useAdministrationNavigation("copilot", data.viewerId)
  const page: CopilotConnectionPageData = copilotConnectionPageData(navigation, data.status)
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
