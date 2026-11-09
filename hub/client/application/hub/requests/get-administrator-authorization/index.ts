import { administratorAuthorizationResponseSchema } from "@application/hub/administrator-contracts"

import { requestJson } from "../request-json"

export function getAdministratorAuthorization(request: Request, authorizationId: string) {
  return requestJson(
    new URL(`/api/administrators/authorizations/${authorizationId}`, request.url),
    administratorAuthorizationResponseSchema,
    { signal: request.signal },
  )
}
