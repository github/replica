import { useOutletContext } from "react-router"

import type { Route } from "./+types/index"
import type { BuildResponse, WorkspaceResponse } from "../../contracts"
import { readRouteIdentifier } from "../../read-route-identifier"
import { getBuild } from "../../requests/get-build"
import { BuildScreen } from "../../screens/build-screen"

export async function clientLoader({
  request,
  params,
}: Pick<Route.ClientLoaderArgs, "request" | "params">): Promise<BuildResponse> {
  return getBuild(
    request,
    readRouteIdentifier(params.repositoryId, "repository"),
    readRouteIdentifier(params.prototypeId, "prototype"),
    readRouteIdentifier(params.buildNumber, "build"),
  )
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `Build ${loaderData.build.number} - ${loaderData.prototype.name} - Replica Hub`
        : "Replica Hub",
    },
  ]
}

export default function BuildRoute({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const workspace = useOutletContext<WorkspaceResponse>()
  return <BuildScreen workspace={workspace} data={loaderData} />
}
