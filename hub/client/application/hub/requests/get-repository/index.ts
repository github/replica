import { repositoryResponseSchema } from "@application/hub/contracts"
import { readRouteQuery } from "@application/hub/read-route-query"

import { requestJson } from "../request-json"

export function getRepository(request: Request, repositoryId: string) {
  const query = readRouteQuery(request)
  const url = new URL(`/api/repositories/${repositoryId}`, request.url)
  if (query.q) url.searchParams.set("q", query.q)
  if (query.author) url.searchParams.set("author", query.author)
  if (query.page > 1) url.searchParams.set("page", String(query.page))

  return requestJson(url, repositoryResponseSchema, {
    signal: request.signal,
  })
}
