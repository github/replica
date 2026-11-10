import { administratorsResponseSchema } from "@application/hub/administrator-contracts"

import { requestJson } from "../request-json"

export function getAdministrators(request: Request, before?: string) {
  const url = new URL("/api/administrators", request.url)
  url.searchParams.set("limit", "50")
  if (before) url.searchParams.set("before", before)
  return requestJson(url, administratorsResponseSchema, { signal: request.signal })
}
