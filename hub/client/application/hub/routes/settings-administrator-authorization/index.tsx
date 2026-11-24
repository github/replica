import { useContext, useState } from "react"
import { useNavigate } from "react-router"
import { z } from "zod"

import { FreshAuthorizationPage } from "@pages/fresh-authorization-page"
import { HubAdminsPage } from "@pages/hub-admins-page"
import { administratorErrorMessage } from "@application/hub/administrator-error-message"
import { cancelAdministratorAuthorization } from "@application/hub/requests/cancel-administrator-authorization"
import { continueAdministratorAuthorization } from "@application/hub/requests/continue-administrator-authorization"
import { getAdministratorAuthorization } from "@application/hub/requests/get-administrator-authorization"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { useAdministrationNavigation } from "@application/hub/use-administration-navigation"
import { administratorProviderLabel } from "@application/hub/view-models/administrator-provider-label"
import { resourcePath } from "@application/hub/view-models/resource-path"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { WorkspaceCompletionContext } from "@application/hub/workspace-completion-context"

import type { Route } from "./+types/index"
import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = {
  workspaceSection: "admins",
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
  const { authorization } = await getAdministratorAuthorization(request, authorizationId.data)
  return {
    authorizationId: authorizationId.data,
    authorization,
    page: {
      productName: "Replica Hub",
      pageTitle: "Complete administrator role change",
      heading: "Complete administrator role change",
      description:
        "Your provider verified this session. Continue the exact administrator role change you confirmed, or cancel it without changing any roles.",
      submitLabel: "Continue",
      submitPath: request.url,
      cancelLabel: "Cancel",
      cancelPath: request.url,
      authenticityToken: "",
      continuation: { id: authorizationId.data, method: "post" },
      roleChange: {
        operationLabel:
          authorization.operation === "DESIGNATE_ADMINISTRATORS"
            ? "Designate Hub administrators"
            : "Remove Hub administrator",
        targets: authorization.targets.map((target) => ({
          membershipId: target.membershipId,
          providerLabel: administratorProviderLabel(target.provider),
          login: target.login,
          name: target.name,
        })),
      },
    },
    viewerId: session.userId,
  }
}

export function meta() {
  return [{ title: "Complete administrator role change - Replica Hub" }]
}

export default function SettingsAdministratorAuthorization({
  loaderData,
}: Pick<Route.ComponentProps, "loaderData">) {
  const workspace = useAdministrationNavigation("admins", loaderData.viewerId)
  const complete = useContext(WorkspaceCompletionContext)
  const navigate = useNavigate()
  const [result, setResult] = useState<
    { state: "idle" } | { state: "busy" } | { state: "error"; message: string }
  >({ state: "idle" })

  if (!complete) throw new Error("Administrator authorization requires the signed-in layout.")

  function administratorsPath(result: "cancelled" | "changed") {
    return resourcePath("/settings/administrators", new URLSearchParams(), {
      result,
      repositoryId: workspace.repository?.selectedRepositoryId ?? null,
    })
  }

  async function submit(formElement: HTMLFormElement) {
    if (result.state === "busy") return
    const form = new FormData(formElement)
    const request = new Request(window.location.href)
    setResult({ state: "busy" })
    try {
      if (form.get("_method") === "delete") {
        await cancelAdministratorAuthorization(request, loaderData.authorizationId)
        void navigate(administratorsPath("cancelled"))
        return
      }
      await continueAdministratorAuthorization(request, {
        authorizationId: loaderData.authorizationId,
        operation: loaderData.authorization.operation,
        targetMembershipIds: loaderData.authorization.targets.map((target) => target.membershipId),
      })
      let session
      try {
        session = await getCurrentHubSession(request)
      } catch (error) {
        if (
          (error instanceof ApiRequestError || error instanceof ApiContractError) &&
          error.status === 401
        ) {
          complete?.(<AdministratorAccessRemoved sessionEnded />)
          return
        }
        throw error
      }
      if (session.role !== "ADMINISTRATOR") {
        complete?.(<AdministratorAccessRemoved sessionEnded={false} />)
        return
      }
      void navigate(administratorsPath("changed"))
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setResult({ state: "error", message: administratorErrorMessage(error.message) })
        return
      }
      if (error instanceof ApiContractError) {
        setResult({
          state: "error",
          message: "The API response was invalid. The role change could not be confirmed.",
        })
        return
      }
      throw error
    }
  }

  return (
    <div
      onSubmit={(event) => {
        if (!(event.target instanceof HTMLFormElement)) return
        if (event.target.action !== loaderData.page.submitPath) return
        event.preventDefault()
        void submit(event.target)
      }}
    >
      <FreshAuthorizationPage
        data={{ ...loaderData.page, administrationWorkspace: workspace }}
        error={result.state === "error" ? result.message : null}
      />
    </div>
  )
}

function AdministratorAccessRemoved({ sessionEnded }: { sessionEnded: boolean }) {
  return (
    <HubAdminsPage
      data={{
        administrationWorkspace: null,
        authenticatedWorkspace: null,
        signedOut: sessionEnded,
        heading: "Hub administrator role changed",
        description: sessionEnded
          ? "Your account no longer has Hub administrator controls. Hub ended this browser session when the role changed."
          : "Your account no longer has Hub administrator controls. Your other Hub access is unchanged.",
        auditLabel: "Security audit",
        auditPath: null,
        repositoriesLabel: "Home",
        repositoriesPath: "/",
        signOutLabel: "Sign out",
        signOutPath: "/api/auth/session/sign-out",
        authenticityToken: "",
        notice: sessionEnded
          ? "Your Hub administrator access was removed and this session ended."
          : "Your Hub administrator access was removed. Your account is no longer a Hub administrator.",
        alert: null,
        pageTitle: "Hub administrator role changed",
        emptyLabel: "Administrator navigation has been removed from this session.",
        nextLabel: "Next page",
        nextPath: null,
        addLabel: "Add administrator",
        administratorsLabel: null,
        addAdministrator: null,
        users: [],
      }}
      onSearch={() => Promise.resolve({ users: [], more: false })}
    />
  )
}
