import { prototypeResponseSchema } from "@application/hub/contracts"
import { readPrototypeQuery } from "@application/hub/read-prototype-query"

import { requestJson } from "../request-json"

export function getPrototype(request: Request, repositoryId: number, prototypeId: number) {
  const query = readPrototypeQuery(request)
  const url = new URL(`/api/repositories/${repositoryId}/prototypes/${prototypeId}`, request.url)
  if (query.build !== undefined) url.searchParams.set("build", String(query.build))
  if (query.view === "minimized") {
    url.searchParams.set("view", "minimized")
  }

  return requestJson(url, prototypeResponseSchema, {
    signal: request.signal,
  })
}
