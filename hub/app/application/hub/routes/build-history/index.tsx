import { useOutletContext } from "react-router"

import type { Route } from "./+types/index"
import type { BuildHistoryResponse, WorkspaceResponse } from "../../contracts"
import { readRouteIdentifier } from "../../read-route-identifier"
import { getBuildHistory } from "../../requests/get-build-history"
import { BuildHistoryScreen } from "../../screens/build-history-screen"

export async function clientLoader({
  request,
  params,
}: Pick<Route.ClientLoaderArgs, "request" | "params">): Promise<BuildHistoryResponse> {
  return getBuildHistory(
    request,
    readRouteIdentifier(params.repositoryId, "repository"),
    readRouteIdentifier(params.prototypeId, "prototype"),
  )
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData ? `Builds - ${loaderData.prototype.name} - Replica Hub` : "Replica Hub" },
  ]
}

export default function BuildHistoryRoute({
  loaderData,
}: Pick<Route.ComponentProps, "loaderData">) {
  const workspace = useOutletContext<WorkspaceResponse>()
  return <BuildHistoryScreen workspace={workspace} data={loaderData} />
}
