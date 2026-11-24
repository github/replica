import { redirect } from "react-router"
import type { ClientLoaderFunctionArgs } from "react-router"
import { z } from "zod"

const parametersSchema = z.object({
  userId: z.uuid(),
  operation: z.enum(["designate", "revoke"]),
})

export function clientLoader({
  request,
  params,
}: Pick<ClientLoaderFunctionArgs, "request" | "params">): never {
  const parameters = parametersSchema.safeParse(params)
  if (!parameters.success) {
    throw new Response("This administrator role change is invalid.", { status: 400 })
  }
  const url = new URL(request.url)
  throw redirect(
    `/settings/administrators/${parameters.data.userId}/${parameters.data.operation}${url.search}`,
  )
}
