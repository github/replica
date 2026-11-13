import { copilotAuthorizationResponseSchema } from "@application/hub/copilot-connection-contracts"

import { requestJson } from "../request-json"

export function getCopilotAuthorization(request: Request, authorizationId: string) {
  return requestJson(
    new URL(`/api/copilot-connection/authorizations/${authorizationId}`, request.url),
    copilotAuthorizationResponseSchema,
    { signal: request.signal },
  )
}
