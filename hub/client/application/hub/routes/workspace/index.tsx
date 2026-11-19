import { Outlet, redirect } from "react-router"
import type { ShouldRevalidateFunctionArgs } from "react-router"

import { isAdministratorRoute } from "@application/hub/is-administrator-route"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getWorkspace } from "@application/hub/requests/get-workspace"

import type { Route } from "./+types/index"

export async function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  const mock = import.meta.env.DEV && import.meta.env.MODE === "mock"
  if (!mock && isAdministratorRoute(new URL(request.url))) return null
  try {
    return await getWorkspace(request)
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      throw redirect(mock ? "/sign-in" : "/")
    }
    throw error
  }
}

export function shouldRevalidate({
  currentParams,
  nextParams,
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  const real = !(import.meta.env.DEV && import.meta.env.MODE === "mock")
  return (
    defaultShouldRevalidate ||
    (real &&
      (currentParams.repositoryId !== nextParams.repositoryId ||
        isAdministratorRoute(currentUrl) !== isAdministratorRoute(nextUrl)))
  )
}

export default function Workspace({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  return <Outlet key={loaderData?.viewer.id} context={loaderData} />
}
