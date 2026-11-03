import { workspaceResponseSchema } from "../../contracts"
import { requestJson } from "../request-json"

export function getWorkspace(request: Request) {
  return requestJson(new URL("/api/workspace", request.url), workspaceResponseSchema, {
    signal: request.signal,
  })
}
