import { useState } from "react"
import { useNavigate } from "react-router"
import { z } from "zod"

import { FreshAuthorizationPage } from "@pages/fresh-authorization-page"
import { cancelCopilotAuthorization } from "@application/hub/requests/cancel-copilot-authorization"
import { continueCopilotAuthorization } from "@application/hub/requests/continue-copilot-authorization"
import { getCopilotAuthorization } from "@application/hub/requests/get-copilot-authorization"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { administratorWorkspace } from "@application/hub/view-models/administrator-workspace"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"

import type { Route } from "./+types/index"

const authorizationIdSchema = z.uuid()

export async function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  const authorizationId = authorizationIdSchema.safeParse(
    new URL(request.url).searchParams.get("authorizationId"),
  )
  if (!authorizationId.success) {
    throw new Response("The authorization identifier is invalid.", { status: 400 })
  }
  const session = await getCurrentHubSession(request)
  if (session.role !== "ADMINISTRATOR") {
    throw new Response("Administrator access is required.", { status: 403 })
  }
  const { authorization } = await getCopilotAuthorization(request, authorizationId.data)
  const connect = authorization.operation === "CONNECT_COPILOT"
  return {
    authorization,
    authorizationId: authorizationId.data,
    page: {
      administrationWorkspace: administratorWorkspace(session, "copilot"),
      productName: "Replica Hub",
      pageTitle: connect ? "Complete Copilot connection" : "Complete Copilot disconnection",
      heading: connect ? "Complete Copilot connection" : "Complete Copilot disconnection",
      description: connect
        ? "Your provider verified this session. Continue to check the configured token and connect Copilot, or cancel without changing the connection."
        : "Your provider verified this session. Continue to disconnect Copilot, or cancel without changing the connection.",
      submitLabel: connect ? "Connect Copilot" : "Disconnect Copilot",
      submitPath: request.url,
      cancelLabel: "Cancel",
      cancelPath: request.url,
      authenticityToken: "",
      continuation: { id: authorizationId.data, method: "post" },
    },
  }
}

export function meta() {
  return [{ title: "Complete Copilot connection change - Replica Hub" }]
}

export default function SettingsCopilotAuthorization({
  loaderData,
}: Pick<Route.ComponentProps, "loaderData">) {
  const navigate = useNavigate()
  const [result, setResult] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  })
  return (
    <div
      onSubmit={(event) => {
        if (!(event.target instanceof HTMLFormElement)) return
        event.preventDefault()
        if (result.pending) return
        const form = new FormData(event.target)
        const request = new Request(window.location.href)
        setResult({ pending: true, error: null })
        const action =
          form.get("_method") === "delete"
            ? cancelCopilotAuthorization(request, loaderData.authorizationId).then(
                () => "cancelled",
              )
            : continueCopilotAuthorization(request, {
                authorizationId: loaderData.authorizationId,
                operation: loaderData.authorization.operation,
              }).then((response) => (response.connected ? "connected" : "disconnected"))
        void action
          .then((outcome) => navigate(`/settings/copilot?result=${outcome}`))
          .catch((error: unknown) => {
            if (!(error instanceof ApiRequestError) && !(error instanceof ApiContractError)) {
              throw error
            }
            setResult({
              pending: false,
              error:
                error instanceof ApiRequestError
                  ? error.message
                  : "The API response was invalid. Copilot was not changed.",
            })
          })
      }}
    >
      <FreshAuthorizationPage data={loaderData.page} error={result.error} />
    </div>
  )
}
