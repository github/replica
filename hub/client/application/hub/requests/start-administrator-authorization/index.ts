import { administratorAuthorizationStartResponseSchema } from "@application/hub/administrator-contracts"
import type { AdministratorAuthorizationStartInput } from "@application/hub/administrator-contracts/types"

import { requestJson } from "../request-json"

export function startAdministratorAuthorization(
  request: Request,
  input: AdministratorAuthorizationStartInput,
) {
  return requestJson(
    new URL("/api/administrators/authorizations/start", request.url),
    administratorAuthorizationStartResponseSchema,
    {
      method: "POST",
      body: JSON.stringify(input),
      signal: request.signal,
    },
  )
}
