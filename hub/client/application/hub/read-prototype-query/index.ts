import { prototypeQuerySchema } from "../contracts"
import type { PrototypeQuery } from "../contracts/types"

export function readPrototypeQuery(request: Request): PrototypeQuery {
  const params = new URL(request.url).searchParams
  const result = prototypeQuerySchema.safeParse({
    build: params.get("build") ?? undefined,
    view: params.get("view") ?? undefined,
  })

  if (!result.success) {
    const invalidBuild = result.error.issues.some((issue) => issue.path[0] === "build")
    throw new Response(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" "),
      { status: invalidBuild ? 404 : 400 },
    )
  }
  return result.data
}
