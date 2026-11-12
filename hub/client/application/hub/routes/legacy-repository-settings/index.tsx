import { redirect } from "react-router"
import type { LoaderFunctionArgs } from "react-router"

import { recordIdentifierSchema } from "@application/hub/contracts"
import { getWorkspace } from "@application/hub/requests/get-workspace"

export async function clientLoader({
  request,
  params,
}: Pick<LoaderFunctionArgs, "request" | "params">) {
  if (params.section !== "analytics" && params.section !== "learnings") {
    throw new Response("This settings page does not exist.", { status: 404 })
  }
  const url = new URL(request.url)
  const context = url.searchParams.get("repositoryId")
  const parsed = context === null ? null : recordIdentifierSchema.safeParse(context)
  if (parsed && !parsed.success) {
    throw new Response("Invalid repository context.", { status: 400 })
  }
  const workspace = await getWorkspace(request)
  const repository = parsed?.success
    ? workspace.repositories.find(({ id }) => id === parsed.data)
    : workspace.repositories[0]
  if (!repository) {
    throw new Response("Choose an available repository before using this page.", { status: 404 })
  }
  url.pathname = `/repositories/${repository.id}/${params.section}`
  url.searchParams.delete("repositoryId")
  throw redirect(`${url.pathname}${url.search}${url.hash}`)
}
