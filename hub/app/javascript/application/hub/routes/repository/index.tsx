import { useOutletContext } from "react-router"

import type { Route } from "./+types/index"
import type { RepositoryResponse, WorkspaceResponse } from "../../contracts"
import { readRouteIdentifier } from "../../read-route-identifier"
import { getAuthors } from "../../requests/get-authors"
import { getRepository } from "../../requests/get-repository"
import { RepositoryScreen } from "../../screens/repository-screen"

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
