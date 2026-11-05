import { prototypeQuerySchema } from "../contracts"
import type { PrototypeQuery } from "../contracts"

export function readPrototypeQuery(request: Request): PrototypeQuery {
  const params = new URL(request.url).searchParams
  const result = prototypeQuerySchema.safeParse({
    build: params.get("build") ?? undefined,
    view: params.get("view") ?? undefined,
  })

  if (!result.success) {
    throw new Response("Invalid route filters.", { status: 400 })
  }
  return result.data
}
