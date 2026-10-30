import { buildHistoryResponseSchema } from "../../contracts"
import { readRouteQuery } from "../../read-route-query"
import { mockScenarioHeaders } from "../mock-scenario-headers"
import { requestJson } from "../request-json"

export function getBuildHistory(request: Request, repositoryId: number, prototypeId: number) {
  const query = readRouteQuery(request)
  const url = new URL(
    `/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds`,
    request.url,
  )
  if (query.page > 1) url.searchParams.set("page", String(query.page))

  return requestJson(url, buildHistoryResponseSchema, {
    signal: request.signal,
    headers: mockScenarioHeaders(query.mockScenario),
  })
}
