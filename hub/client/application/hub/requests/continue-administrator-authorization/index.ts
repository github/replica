import { administratorContinuationResponseSchema } from "@application/hub/administrator-contracts"
import type { AdministratorOperation } from "@application/hub/administrator-contracts/types"

import { requestJson } from "../request-json"

export function continueAdministratorAuthorization(
  request: Request,
  input: {
    authorizationId: string
    operation: AdministratorOperation
    targetMembershipIds: string[]
  },
) {
  return requestJson(
    new URL("/api/administrators/authorizations/continue", request.url),
    administratorContinuationResponseSchema,
    {
      method: "POST",
      body: JSON.stringify(input),
      signal: request.signal,
    },
  )
}
