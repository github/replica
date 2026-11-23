import { useCallback, useState } from "react"

import { HubAdminsPage } from "@pages/hub-admins-page"
import { administratorErrorMessage } from "@application/hub/administrator-error-message"
import { beginAdministratorAuthorization } from "@application/hub/begin-administrator-authorization"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getAdministrators } from "@application/hub/requests/get-administrators"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { searchAdministratorCandidates } from "@application/hub/requests/search-administrator-candidates"
import { useAdministrationNavigation } from "@application/hub/use-administration-navigation"
import { administratorsPageData } from "@application/hub/view-models/administrators-page-data"

import type { Route } from "./+types/index"
import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = {
  workspaceSection: "admins",
  independentOfRepositoryNavigation: true,
} satisfies WorkspaceRouteHandle

export async function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  const url = new URL(request.url)
  const before = url.searchParams.get("before") ?? undefined
  if (before && before.length > 500) {
    throw new Response("The administrator cursor is invalid.", { status: 400 })
  }
  const session = await getCurrentHubSession(request)
  if (session.role !== "ADMINISTRATOR") {
    throw new Response("Administrator access is required.", { status: 403 })
  }
  const response = await getAdministrators(request, before)
  const result = url.searchParams.get("result")
  return {
    viewerId: session.userId,
    response,
    before,
    notice:
      result === "changed"
        ? "The Hub administrator role changed."
        : result === "cancelled"
          ? "The administrator role change was cancelled."
          : null,
  }
}

export function meta() {
  return [{ title: "Hub administrators - Replica Hub" }]
}

export default function SettingsAdministrators({
  loaderData,
}: Pick<Route.ComponentProps, "loaderData">) {
  const navigation = useAdministrationNavigation("admins", loaderData.viewerId)
  const [submission, setSubmission] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  })
  const onSearch = useCallback(async (query: string) => {
    const request = new Request(window.location.href)
    const response = await searchAdministratorCandidates(request, query)
    return {
      users: response.candidates.map((candidate) => ({
        id: candidate.membershipId,
        provider: candidate.provider,
        login: candidate.login,
        name: candidate.name,
      })),
      more: response.candidates.length === 50,
    }
  }, [])
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
      <HubAdminsPage
        data={administratorsPageData(
          navigation,
          loaderData.response,
          loaderData.before,
          loaderData.notice,
        )}
        addAdministratorError={submission.error}
        onSearch={onSearch}
        pending={submission.pending}
      />
    </div>
  )
}
