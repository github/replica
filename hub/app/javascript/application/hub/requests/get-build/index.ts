import { buildResponseSchema } from "../../contracts"
import { readRouteQuery } from "../../read-route-query"
import { mockScenarioHeaders } from "../mock-scenario-headers"
import { requestJson } from "../request-json"

export function getBuild(
  request: Request,
  repositoryId: number,
  prototypeId: number,
  buildNumber: number,
) {
  const query = readRouteQuery(request)
  return requestJson(
    new URL(
      `/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds/${buildNumber}`,
      request.url,
    ),
    buildResponseSchema,
    {
      signal: request.signal,
      headers: mockScenarioHeaders(query.mockScenario),
    },
  )
}
