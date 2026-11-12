import { routeQuerySchema } from "../contracts"
import type { RouteQuery } from "../contracts/types"

export function readRouteQuery(request: Request): RouteQuery {
  const params = new URL(request.url).searchParams
  const result = routeQuerySchema.safeParse({
    q: params.get("q") ?? undefined,
    author: params.get("author") ?? undefined,
    page: params.get("page") ?? undefined,
    view: params.get("view") ?? undefined,
    build: params.get("build") ?? undefined,
  })

  if (!result.success) {
    throw new Response(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" "),
      { status: 400 },
    )
  }
  return result.data
}
