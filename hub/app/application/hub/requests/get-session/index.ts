import { sessionResponseSchema } from "../../session-contracts"
import { requestJson } from "../request-json"
import { mockSessionContext } from "../mock-session-context"

let latestRead = 0

export async function getSession(request: Request) {
  const read = ++latestRead
  const session = await requestJson(new URL("/api/session", request.url), sessionResponseSchema, {
    signal: request.signal,
  })
  if (read === latestRead) mockSessionContext.revision = session.revision
  return session
}
