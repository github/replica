import { Outlet, redirect, useLocation } from "react-router"
import type { ShouldRevalidateFunctionArgs } from "react-router"

import { isAdministratorRoute } from "@application/hub/is-administrator-route"
import { readWorkspaceRepositoryId } from "@application/hub/read-workspace-repository-id"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getWorkspace } from "@application/hub/requests/get-workspace"
import { useWorkspaceRepositoryPermissions } from "@application/hub/use-workspace-repository-permissions"

import type { Route } from "./+types/index"

export async function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  const mock = import.meta.env.DEV && import.meta.env.MODE === "mock"
  if (!mock && isAdministratorRoute(new URL(request.url))) return null
  try {
    return await getWorkspace(request, mock ? undefined : "navigation")
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      throw redirect(mock ? "/sign-in" : "/")
    }
    throw error
  }
}

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  const real = !(import.meta.env.DEV && import.meta.env.MODE === "mock")
  if (!real) return defaultShouldRevalidate
  if (isAdministratorRoute(currentUrl) !== isAdministratorRoute(nextUrl)) return true
  if (readWorkspaceRepositoryId(currentUrl) !== readWorkspaceRepositoryId(nextUrl)) return true
  if (formMethod && formMethod.toUpperCase() !== "GET") return defaultShouldRevalidate
  // Keep explicit retries and action revalidation, but not unrelated URL filters.
  return currentUrl.pathname === nextUrl.pathname && currentUrl.search === nextUrl.search
    ? defaultShouldRevalidate
    : false
}

export default function Workspace({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const { pathname, search } = useLocation()
  const repositoryId = readWorkspaceRepositoryId({
    pathname,
    searchParams: new URLSearchParams(search),
  })
  const workspace = useWorkspaceRepositoryPermissions(loaderData, repositoryId)
  return <Outlet key={workspace?.viewer.id} context={workspace} />
}
