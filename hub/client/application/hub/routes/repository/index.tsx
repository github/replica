import { useOutletContext } from "react-router"

import type { RepositoryResponse, WorkspaceResponse } from "@application/hub/contracts/types"
import { readRouteIdentifier } from "@application/hub/read-route-identifier"
import { getAuthors } from "@application/hub/requests/get-authors"
import { getRepository } from "@application/hub/requests/get-repository"
import { RepositoryScreen } from "@application/hub/screens/repository-screen"

import type { Route } from "./+types/index"

export async function clientLoader({
  request,
  params,
}: Pick<Route.ClientLoaderArgs, "request" | "params">): Promise<RepositoryResponse> {
  return getRepository(request, readRouteIdentifier(params.repositoryId, "repository"))
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData ? `${loaderData.repository.nameWithOwner} - Replica Hub` : "Replica Hub" },
  ]
}

export default function RepositoryRoute({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const workspace = useOutletContext<WorkspaceResponse>()
  return (
    <RepositoryScreen
      workspace={workspace}
      data={loaderData}
      loadAuthors={(query, cursor, signal) =>
        getAuthors({
          origin: window.location.origin,
          repositoryId: loaderData.repository.id,
          query,
          cursor,
          signal,
        })
      }
    />
  )
}
