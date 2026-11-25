import { useContext, useState } from "react"
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
import { sessionRevocationErrorMessage } from "@application/hub/session-revocation-error-message"
import { useAdministrationNavigation } from "@application/hub/use-administration-navigation"
import { resourcePath } from "@application/hub/view-models/resource-path"
import { sessionRevocationPageData } from "@application/hub/view-models/session-revocation-page-data"
import { WorkspaceCompletionContext } from "@application/hub/workspace-completion-context"

import type { Route } from "./+types/index"
import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = {
  workspaceSection: "sessions",
  independentOfRepositoryNavigation: true,
} satisfies WorkspaceRouteHandle

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
  const [{ status }] = await Promise.all([
    getSessionRevocationStatus(request),
    getSessionRevocationAuthorization(request, authorizationId.data),
  ])
  return {
    authorizationId: authorizationId.data,
    session,
    status,
  }
}

export function meta() {
  return [{ title: "Complete session revocation - Replica Hub" }]
}

export default function SettingsSessionRevocationAuthorization({
  loaderData,
}: Pick<Route.ComponentProps, "loaderData">) {
  const workspace = useAdministrationNavigation("sessions", loaderData.session.userId)
  const complete = useContext(WorkspaceCompletionContext)
  const page = sessionRevocationPageData(loaderData.session, loaderData.status, {
    workspace,
    authorizationId: loaderData.authorizationId,
  })
  const navigate = useNavigate()
  const [submission, setSubmission] = useState<
    { state: "idle"; error: string | null } | { state: "pending"; error: null }
  >({ state: "idle", error: null })
  if (!complete) throw new Error("Session revocation requires the signed-in layout.")
  return (
    <div
      onSubmit={(event) => {
        if (!(event.target instanceof HTMLFormElement)) return
        if (event.target.action !== new URL(page.submitPath, window.location.href).href) {
          return
        }
        event.preventDefault()
        if (submission.state === "pending") return
        const submitter =
          event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null
        const form = new FormData(
          event.target,
          submitter instanceof HTMLElement ? submitter : undefined,
        )
        const request = new Request(window.location.href)
        setSubmission({ state: "pending", error: null })
        const operation =
          form.get("cancelled") === "1"
            ? cancelSessionRevocationAuthorization(request, loaderData.authorizationId).then(() => {
                void navigate(
                  resourcePath("/settings/sessions", {
                    result: "cancelled",
                    repositoryId: workspace.repository?.selectedRepositoryId ?? null,
                  }),
                )
              })
            : continueSessionRevocationAuthorization(request, loaderData.authorizationId).then(
                () => {
                  complete(
                    <SessionRevocationPage
                      data={sessionRevocationPageData(null, null, { result: "ended" })}
                    />,
                  )
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
                ? sessionRevocationErrorMessage(error.message)
                : "The API response was invalid. Session revocation could not be confirmed.",
          })
        })
      }}
    >
      <SessionRevocationPage data={{ ...page, alert: submission.error ?? page.alert }} />
    </div>
  )
}
