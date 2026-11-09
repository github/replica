import { administratorCandidatesResponseSchema } from "@application/hub/administrator-contracts"

import { requestJson } from "../request-json"

export function searchAdministratorCandidates(request: Request, query: string) {
  const url = new URL("/api/administrators/candidates", request.url)
  url.searchParams.set("query", query)
  url.searchParams.set("limit", "50")
  return requestJson(url, administratorCandidatesResponseSchema, { signal: request.signal })
}
