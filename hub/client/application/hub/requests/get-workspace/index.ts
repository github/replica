import { workspaceResponseSchema } from "@application/hub/contracts"
import { readWorkspaceRepositoryId } from "@application/hub/read-workspace-repository-id"

import { requestJson } from "../request-json"

export function getWorkspace(request: Request, view?: "navigation") {
  const page = new URL(request.url)
  const target = new URL("/api/workspace", page)
  const selected = readWorkspaceRepositoryId(page)
  if (selected) target.searchParams.set("repositoryId", selected)
  if (view) target.searchParams.set("view", view)
  return requestJson(target, workspaceResponseSchema, {
    signal: request.signal,
  })
}
