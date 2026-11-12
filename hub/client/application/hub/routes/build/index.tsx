import { useOutletContext } from "react-router"

import type { BuildResponse, WorkspaceResponse } from "@application/hub/contracts/types"
import { readRecordIdentifier } from "@application/hub/read-record-identifier"
import { readRouteIdentifier } from "@application/hub/read-route-identifier"
import { getBuild } from "@application/hub/requests/get-build"
import { BuildScreen } from "@application/hub/screens/build-screen"

import type { Route } from "./+types/index"

export async function clientLoader({
  request,
  params,
}: Pick<Route.ClientLoaderArgs, "request" | "params">): Promise<BuildResponse> {
  return getBuild(
    request,
    readRecordIdentifier(params.repositoryId, "repository"),
    readRecordIdentifier(params.prototypeId, "prototype"),
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

export default function Build({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const workspace = useOutletContext<WorkspaceResponse>()
  return <BuildScreen workspace={workspace} data={loaderData} />
}
