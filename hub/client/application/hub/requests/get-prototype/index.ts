import { prototypeResponseSchema } from "../../contracts"
import { readRouteQuery } from "../../read-route-query"
import { requestJson } from "../request-json"

export function getPrototype(request: Request, repositoryId: number, prototypeId: number) {
  const query = readRouteQuery(request)
  const url = new URL(`/api/repositories/${repositoryId}/prototypes/${prototypeId}`, request.url)
  if (query.build !== undefined) url.searchParams.set("build", String(query.build))
  if (new URL(request.url).searchParams.get("view") === "minimized") {
    url.searchParams.set("view", "minimized")
  }

  return requestJson(url, prototypeResponseSchema, {
    signal: request.signal,
  })
}
