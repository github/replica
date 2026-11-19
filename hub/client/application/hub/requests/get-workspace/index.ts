import { z } from "zod"

import { workspaceResponseSchema } from "@application/hub/contracts"

import { requestJson } from "../request-json"

export function getWorkspace(request: Request) {
  const page = new URL(request.url)
  const target = new URL("/api/workspace", page)
  const selected = z
    .uuid()
    .safeParse(
      page.pathname.match(/^\/repositories\/([^/]+)/i)?.[1] ??
        page.searchParams.get("repositoryId"),
    )
  if (selected.success) target.searchParams.set("repositoryId", selected.data.toLowerCase())
  return requestJson(target, workspaceResponseSchema, {
    signal: request.signal,
  })
}
