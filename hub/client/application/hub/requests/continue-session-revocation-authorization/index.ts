import { sessionRevocationContinuationResponseSchema } from "@application/hub/session-revocation-contracts"

import { requestJson } from "../request-json"

export function continueSessionRevocationAuthorization(request: Request, authorizationId: string) {
  return requestJson(
    new URL("/api/session-revocation/authorizations/continue", request.url),
    sessionRevocationContinuationResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({ authorizationId }),
      signal: request.signal,
    },
  )
}
