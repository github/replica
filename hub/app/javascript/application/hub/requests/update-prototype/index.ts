import { prototypeDetailsSchema, prototypeResponseSchema } from "../../contracts"
import type { PrototypeDetails } from "../../contracts"
import { readRouteQuery } from "../../read-route-query"
import { mockScenarioHeaders } from "../mock-scenario-headers"
import { requestJson } from "../request-json"

export function updatePrototype(
  request: Request,
  repositoryId: number,
  prototypeId: number,
  details: PrototypeDetails,
) {
  const query = readRouteQuery(request)
  return requestJson(
    new URL(`/api/repositories/${repositoryId}/prototypes/${prototypeId}`, request.url),
    prototypeResponseSchema,
    {
      method: "PATCH",
      signal: request.signal,
      headers: mockScenarioHeaders(query.mockScenario),
      body: JSON.stringify(prototypeDetailsSchema.parse(details)),
    },
  )
}
