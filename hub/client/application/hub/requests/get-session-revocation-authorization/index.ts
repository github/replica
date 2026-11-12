import { sessionRevocationAuthorizationResponseSchema } from "@application/hub/session-revocation-contracts"

import { requestJson } from "../request-json"

export function getSessionRevocationAuthorization(request: Request, authorizationId: string) {
  return requestJson(
    new URL(`/api/session-revocation/authorizations/${authorizationId}`, request.url),
    sessionRevocationAuthorizationResponseSchema,
    { signal: request.signal },
  )
}
