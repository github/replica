import { copilotConnectionStatusSchema } from "@application/hub/copilot-connection-contracts"

import { requestJson } from "../request-json"

export function getCopilotConnection(request: Request) {
  return requestJson(
    new URL("/api/copilot-connection", request.url),
    copilotConnectionStatusSchema,
    { signal: request.signal },
  )
}
