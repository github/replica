import { sessionRevocationStatusResponseSchema } from "@application/hub/session-revocation-contracts"

import { requestJson } from "../request-json"

export function getSessionRevocationStatus(request: Request) {
  return requestJson(
    new URL("/api/session-revocation", request.url),
    sessionRevocationStatusResponseSchema,
    { signal: request.signal },
  )
}
