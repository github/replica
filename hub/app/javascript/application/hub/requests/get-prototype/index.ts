import { prototypeResponseSchema } from "../../contracts"
import { readRouteQuery } from "../../read-route-query"
import { mockScenarioHeaders } from "../mock-scenario-headers"
import { requestJson } from "../request-json"

export function getPrototype(request: Request, repositoryId: number, prototypeId: number) {
  const query = readRouteQuery(request)
  const url = new URL(`/api/repositories/${repositoryId}/prototypes/${prototypeId}`, request.url)
  if (query.build !== undefined) url.searchParams.set("build", String(query.build))

  return requestJson(url, prototypeResponseSchema, {
    signal: request.signal,
    headers: mockScenarioHeaders(query.mockScenario),
  })
}
