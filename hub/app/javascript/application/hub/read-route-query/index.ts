import { routeQuerySchema } from "../contracts"
import type { RouteQuery } from "../contracts"

export function readRouteQuery(request: Request): RouteQuery {
  const params = new URL(request.url).searchParams
  const result = routeQuerySchema.safeParse({
    q: params.get("q") ?? undefined,
    author: params.get("author") ?? undefined,
    page: params.get("page") ?? undefined,
    view: params.get("view") ?? undefined,
    build: params.get("build") ?? undefined,
    mockScenario: params.get("mockScenario") ?? undefined,
  })

  if (!result.success) {
    throw new Response("Invalid route filters.", { status: 400 })
  }
  return result.data
}
