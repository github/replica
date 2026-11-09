import { authorResultsSchema } from "@application/hub/contracts"

import { requestJson } from "../request-json"

interface Options {
  origin: string
  repositoryId: string
  query: string
  cursor: string | null
  signal: AbortSignal
}

export function getAuthors({ origin, repositoryId, query, cursor, signal }: Options) {
  const url = new URL(`/api/repositories/${repositoryId}/authors`, origin)
  if (query) url.searchParams.set("q", query)
  if (cursor !== null) url.searchParams.set("cursor", cursor)
  return requestJson(url, authorResultsSchema, { signal })
}
