import { sessionResponseSchema } from "../../session-contracts"
import { requestJson } from "../request-json"

export function getSession(request: Request) {
  return requestJson(new URL("/api/session", request.url), sessionResponseSchema, {
    signal: request.signal,
  })
}
