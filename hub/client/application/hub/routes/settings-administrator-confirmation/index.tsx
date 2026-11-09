import { useState } from "react"
import { z } from "zod"

import { HubAdminConfirmationPage } from "@pages/hub-admin-confirmation-page"
import { beginAdministratorAuthorization } from "@application/hub/begin-administrator-authorization"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getAdministrators } from "@application/hub/requests/get-administrators"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { administratorConfirmationPageData } from "@application/hub/view-models/administrator-confirmation-page-data"

import type { Route } from "./+types/index"

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
    page: administratorConfirmationPageData(
      session,
      target,
      parameters.data.operation,
      finalAdministrator
        ? "The final Hub administrator cannot be removed. Designate another existing Hub user first."
        : null,
    ),
  }
}

export function meta({ loaderData }: Pick<Route.MetaArgs, "loaderData">) {
  return [{ title: `${loaderData?.page.pageTitle ?? "Administrator role change"} - Replica Hub` }]
}

export default function SettingsAdministratorConfirmation({
  loaderData,
}: Pick<Route.ComponentProps, "loaderData">) {
  const [submission, setSubmission] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  })
  return (
    <div
      onSubmit={(event) => {
        if (!(event.target instanceof HTMLFormElement)) return
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
                ? error.message
                : "The API response was invalid. Provider authorization could not start.",
          })
        })
      }}
    >
      <HubAdminConfirmationPage
        data={{ ...loaderData.page, alert: submission.error }}
        pending={submission.pending}
      />
    </div>
  )
}
