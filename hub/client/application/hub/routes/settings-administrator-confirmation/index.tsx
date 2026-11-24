import { useState } from "react"
import { z } from "zod"

import { HubAdminConfirmationPage } from "@pages/hub-admin-confirmation-page"
import { administratorErrorMessage } from "@application/hub/administrator-error-message"
import { beginAdministratorAuthorization } from "@application/hub/begin-administrator-authorization"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getAdministrators } from "@application/hub/requests/get-administrators"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { useAdministrationNavigation } from "@application/hub/use-administration-navigation"
import { administratorConfirmationPageData } from "@application/hub/view-models/administrator-confirmation-page-data"

import type { Route } from "./+types/index"
import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = {
  workspaceSection: "admins",
  independentOfRepositoryNavigation: true,
} satisfies WorkspaceRouteHandle

const parametersSchema = z.object({
  membershipId: z.uuid(),
  operation: z.literal("revoke"),
})

export async function clientLoader({
  request,
  params,
}: Pick<Route.ClientLoaderArgs, "request" | "params">) {
  const parameters = parametersSchema.safeParse(params)
  const url = new URL(request.url)
  if (!parameters.success) {
    throw new Response("This administrator role change is invalid.", { status: 400 })
  }
  const before = url.searchParams.get("before") ?? undefined
  if (before && before.length > 500) {
    throw new Response("The administrator cursor is invalid.", { status: 400 })
  }
  const session = await getCurrentHubSession(request)
  if (session.role !== "ADMINISTRATOR") {
    throw new Response("Administrator access is required.", { status: 403 })
  }
  const page = await getAdministrators(request, before)
  const target = page.administrators.find(
    (administrator) => administrator.membershipId === parameters.data.membershipId,
  )
  if (!target) {
    throw new Response("This Hub administrator is unavailable.", { status: 404 })
  }
  const finalAdministrator =
    before === undefined &&
    page.nextCursor === null &&
    page.administrators.length === 1 &&
    page.administrators[0]?.membershipId === parameters.data.membershipId
  return {
    viewerId: session.userId,
    target,
    operation: parameters.data.operation,
    blockedLabel: finalAdministrator
      ? "The final Hub administrator cannot be removed. Designate another existing Hub user first."
      : null,
  }
}

export function meta() {
  return [{ title: "Remove Hub administrator? - Replica Hub" }]
}

export default function SettingsAdministratorConfirmation({
  loaderData,
}: Pick<Route.ComponentProps, "loaderData">) {
  const navigation = useAdministrationNavigation("admins", loaderData.viewerId)
  const [submission, setSubmission] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  })
  return (
    <div
      onSubmit={(event) => {
        if (!(event.target instanceof HTMLFormElement)) return
        if (
          event.target.action !==
          new URL("/api/administrators/authorizations/start", window.location.href).href
        ) {
          return
        }
        event.preventDefault()
        if (submission.pending) return
        setSubmission({ pending: true, error: null })
        void beginAdministratorAuthorization(
          new Request(window.location.href),
          new FormData(event.target),
        ).catch((error: unknown) => {
          if (!(error instanceof ApiRequestError) && !(error instanceof ApiContractError)) {
            throw error
          }
          setSubmission({
            pending: false,
            error:
              error instanceof ApiRequestError
                ? administratorErrorMessage(error.message)
                : "The API response was invalid. Provider authorization could not start.",
          })
        })
      }}
    >
      <HubAdminConfirmationPage
        data={{
          ...administratorConfirmationPageData(
            navigation,
            loaderData.target,
            loaderData.operation,
            loaderData.blockedLabel,
          ),
          alert: submission.error,
        }}
        pending={submission.pending}
      />
    </div>
  )
}
