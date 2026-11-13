import { redirect, useLocation } from "react-router"

import { RepositoriesIndexPage } from "@pages/repositories-index-page"
import { HubApplication } from "@application/hub-application"
import { isAuthenticationRoute } from "@application/hub/is-authentication-route"
import { noRepositoryAccessLocation } from "@application/hub/no-repository-access-location"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { getSession } from "@application/hub/requests/get-session"
import { getWorkspace } from "@application/hub/requests/get-workspace"
import { workspaceNavigation } from "@application/hub/view-models/workspace-navigation"

import type { Route } from "./+types/index"

export async function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  const mock = import.meta.env.DEV && import.meta.env.MODE === "mock"
  if (mock) {
    const session = await getSession(request)
    if (!session.viewer) throw redirect("/sign-in")
  } else if (isAuthenticationRoute(request)) {
    try {
      await getCurrentHubSession(request)
    } catch (error) {
      const noAccess = noRepositoryAccessLocation(error)
      if (noAccess) throw redirect(noAccess)
      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 404)) {
        return null
      }
      throw error
    }
  }
  let workspace
  try {
    workspace = await getWorkspace(request)
  } catch (error) {
    if (!mock && error instanceof ApiRequestError && error.status === 401) throw redirect("/")
    throw error
  }
  const firstRepository = workspace.repositories[0]
  if (firstRepository) throw redirect(`/repositories/${firstRepository.id}`)
  return workspace
}

export default function Home({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const location = useLocation()
  if (loaderData === null) return <HubApplication />
  const real = !(import.meta.env.DEV && import.meta.env.MODE === "mock")
  return (
    <RepositoriesIndexPage
      data={{
        ...workspaceNavigation(loaderData, null, new URLSearchParams(location.search), real),
        repository: null,
      }}
    />
  )
}
