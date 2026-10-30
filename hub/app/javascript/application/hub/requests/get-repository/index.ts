import { repositoryResponseSchema } from "../../contracts"
import { readRouteQuery } from "../../read-route-query"
import { mockScenarioHeaders } from "../mock-scenario-headers"
import { requestJson } from "../request-json"

export function getRepository(request: Request, repositoryId: number) {
  const query = readRouteQuery(request)
  const url = new URL(`/api/repositories/${repositoryId}`, request.url)
  if (query.q) url.searchParams.set("q", query.q)
  if (query.author) url.searchParams.set("author", query.author)
  if (query.page > 1) url.searchParams.set("page", String(query.page))

  return requestJson(url, repositoryResponseSchema, {
    signal: request.signal,
    headers: mockScenarioHeaders(query.mockScenario),
  })
}
