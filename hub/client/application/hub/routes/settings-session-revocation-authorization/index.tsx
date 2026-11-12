import { useState } from "react"
import { useNavigate } from "react-router"
import { z } from "zod"

import { SessionRevocationPage } from "@pages/session-revocation-page"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { cancelSessionRevocationAuthorization } from "@application/hub/requests/cancel-session-revocation-authorization"
import { continueSessionRevocationAuthorization } from "@application/hub/requests/continue-session-revocation-authorization"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { getSessionRevocationAuthorization } from "@application/hub/requests/get-session-revocation-authorization"
import { getSessionRevocationStatus } from "@application/hub/requests/get-session-revocation-status"
import { sessionRevocationPageData } from "@application/hub/view-models/session-revocation-page-data"

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
  const [{ authorization }, { status }] = await Promise.all([
    getSessionRevocationAuthorization(request, authorizationId.data),
    getSessionRevocationStatus(request),
  ])
  return {
    authorization,
    authorizationId: authorizationId.data,
    page: sessionRevocationPageData(session, status, {
      authorizationId: authorizationId.data,
    }),
  }
}

export function meta() {
  return [{ title: "Complete session revocation - Replica Hub" }]
}

export default function SettingsSessionRevocationAuthorization({
  loaderData,
}: Pick<Route.ComponentProps, "loaderData">) {
  const navigate = useNavigate()
  const [submission, setSubmission] = useState<
    | { state: "idle"; error: string | null }
    | { state: "pending"; error: null }
    | { state: "ended"; error: null }
  >({ state: "idle", error: null })
  if (submission.state === "ended") {
    return (
      <SessionRevocationPage data={sessionRevocationPageData(null, null, { result: "ended" })} />
    )
  }
  return (
    <div
      onSubmit={(event) => {
        if (!(event.target instanceof HTMLFormElement)) return
        event.preventDefault()
        if (submission.state === "pending") return
        const form = new FormData(event.target)
        const request = new Request(window.location.href)
        setSubmission({ state: "pending", error: null })
        const operation =
          form.get("cancelled") === "1"
            ? cancelSessionRevocationAuthorization(request, loaderData.authorizationId).then(() => {
                void navigate("/settings/sessions?result=cancelled")
              })
            : continueSessionRevocationAuthorization(request, loaderData.authorizationId).then(
                () => {
                  setSubmission({ state: "ended", error: null })
                },
              )
        void operation.catch((error: unknown) => {
          if (!(error instanceof ApiRequestError) && !(error instanceof ApiContractError)) {
            throw error
          }
          setSubmission({
            state: "idle",
            error:
              error instanceof ApiRequestError
                ? error.message
                : "The API response was invalid. Session revocation could not be confirmed.",
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
