import { Outlet, redirect } from "react-router"

import type { Route } from "./+types/index"
import { ApiRequestError } from "../../requests/api-request-error"
import { getWorkspace } from "../../requests/get-workspace"

export async function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  try {
    return await getWorkspace(request)
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      throw redirect("/sign-in")
    }
    throw error
  }
}

export default function WorkspaceRoute({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  return <Outlet key={loaderData.viewer.login} context={loaderData} />
}
