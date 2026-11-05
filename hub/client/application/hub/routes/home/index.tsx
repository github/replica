import { redirect, useLocation } from "react-router"

import { RepositoriesIndexPage } from "@pages/repositories-index-page"

import { HubApplication } from "../../../hub-application"
import type { Route } from "./+types/index"
import { isAuthenticationRoute } from "../../is-authentication-route"
import { getSession } from "../../requests/get-session"
import { getWorkspace } from "../../requests/get-workspace"
import { workspaceNavigation } from "../../view-models/workspace-navigation"

export async function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  if (isAuthenticationRoute(request)) return null
  const session = await getSession(request)
  if (!session.viewer) throw redirect("/sign-in")
  const workspace = await getWorkspace(request)
  const firstRepository = workspace.repositories[0]
  if (firstRepository) throw redirect(`/repositories/${firstRepository.id}`)
  return workspace
}

export default function HomeRoute({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const location = useLocation()
  if (loaderData === null) return <HubApplication />
  return (
    <RepositoriesIndexPage
      data={{
        ...workspaceNavigation(loaderData, null, new URLSearchParams(location.search)),
        repository: null,
      }}
    />
  )
}
