import { Outlet, redirect } from "react-router"

import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { getWorkspace } from "@application/hub/requests/get-workspace"
import { isAdministratorRoute } from "@application/hub/is-administrator-route"

import type { Route } from "./+types/index"

export async function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  try {
    if (
      isAdministratorRoute(request) &&
      !(import.meta.env.DEV && import.meta.env.MODE === "mock")
    ) {
      const session = await getCurrentHubSession(request)
      return {
        viewer: {
          id: session.userId,
          login: session.login,
          name: session.name,
          avatarUrl: null,
        },
        repositories: [],
        capabilities: {
          createPrototypes: false,
          reviewPrototypes: false,
          manageSharing: false,
          administerHub: session.role === "ADMINISTRATOR",
        },
      }
    }
    return await getWorkspace(request)
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      throw redirect("/sign-in")
    }
    throw error
  }
}

export default function Workspace({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  return <Outlet key={loaderData.viewer.login} context={loaderData} />
}
