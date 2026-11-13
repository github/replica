import { sessionRevocationAuthorizationStartResponseSchema } from "@application/hub/session-revocation-contracts"

import { requestJson } from "../request-json"

export function startSessionRevocationAuthorization(request: Request) {
  return requestJson(
    new URL("/api/session-revocation/authorizations/start", request.url),
    sessionRevocationAuthorizationStartResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({ confirmed: true }),
      signal: request.signal,
    },
  )
}
