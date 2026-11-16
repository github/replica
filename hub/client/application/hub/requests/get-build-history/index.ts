import { buildHistoryResponseSchema } from "@application/hub/contracts"
import { readRouteQuery } from "@application/hub/read-route-query"

import { requestJson } from "../request-json"

export function getBuildHistory(request: Request, repositoryId: string, prototypeId: string) {
  const query = readRouteQuery(request)
  const url = new URL(
    `/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds`,
    request.url,
  )
  if (query.page > 1) url.searchParams.set("page", String(query.page))
  if (query.build) url.searchParams.set("build", String(query.build))

  return requestJson(url, buildHistoryResponseSchema, {
    signal: request.signal,
  })
}
