import { copilotAuthorizationStartResponseSchema } from "@application/hub/copilot-connection-contracts"

import { requestJson } from "../request-json"

export function startCopilotAuthorization(
  request: Request,
  input: {
    confirmed: true
    operation: "CONNECT_COPILOT" | "DISCONNECT_COPILOT"
  },
) {
  return requestJson(
    new URL("/api/copilot-connection/authorizations/start", request.url),
    copilotAuthorizationStartResponseSchema,
    {
      body: JSON.stringify(input),
      method: "POST",
      signal: request.signal,
    },
  )
}
