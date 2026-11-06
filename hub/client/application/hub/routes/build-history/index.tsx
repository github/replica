import { useOutletContext } from "react-router"

import type { BuildHistoryResponse, WorkspaceResponse } from "@application/hub/contracts/types"
import { readRouteIdentifier } from "@application/hub/read-route-identifier"
import { getBuildHistory } from "@application/hub/requests/get-build-history"
import { BuildHistoryScreen } from "@application/hub/screens/build-history-screen"

import type { Route } from "./+types/index"

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

export default function BuildHistory({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const workspace = useOutletContext<WorkspaceResponse>()
  return <BuildHistoryScreen workspace={workspace} data={loaderData} />
}
