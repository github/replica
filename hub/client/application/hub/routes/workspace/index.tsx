import { Outlet, redirect } from "react-router"

import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getWorkspace } from "@application/hub/requests/get-workspace"

import type { Route } from "./+types/index"

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

export default function Workspace({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  return <Outlet key={loaderData.viewer.login} context={loaderData} />
}
