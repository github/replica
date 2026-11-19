import { workspaceResponseSchema } from "@application/hub/contracts"

import { requestJson } from "../request-json"

export function getWorkspace(request: Request) {
  const page = new URL(request.url)
  const target = new URL("/api/workspace", page)
  const selected = z
    .uuid()
    .safeParse(
      page.pathname.match(/^\/repositories\/([^/]+)/)?.[1] ?? page.searchParams.get("repositoryId"),
    )
  if (selected.success) target.searchParams.set("repositoryId", selected.data)
  return requestJson(target, workspaceResponseSchema, {
    signal: request.signal,
  })
}
import { z } from "zod"
