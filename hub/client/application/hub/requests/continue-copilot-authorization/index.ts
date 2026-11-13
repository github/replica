import { copilotContinuationResponseSchema } from "@application/hub/copilot-connection-contracts"

import { requestJson } from "../request-json"

export function continueCopilotAuthorization(
  request: Request,
  input: {
    authorizationId: string
    operation: "CONNECT_COPILOT" | "DISCONNECT_COPILOT"
  },
) {
  return requestJson(
    new URL("/api/copilot-connection/authorizations/continue", request.url),
    copilotContinuationResponseSchema,
    {
      body: JSON.stringify(input),
      method: "POST",
      signal: request.signal,
    },
  )
}
